'use strict';

/*
 * Payroll month lock + manual adjustments + carry-forward that respects locks.
 *
 * NOTE: no destructuring / spread in this file. It is shared with the CRA
 * frontend build, and Babel would inject ESM helpers that break module.exports.
 *
 * Words used here:
 *   dataTotal   - what the uploaded commission rows add up to for payee+period
 *   adjustments - manual adjustment lines (payroll_adjustments) for payee+period
 *   periodTotal - dataTotal + adjustments (the month's own balance)
 *   carryIn     - negative balance carried in from earlier months (<= 0)
 *   net         - carryIn + periodTotal
 *   payable     - max(0, net)  (what you actually pay)
 *   carryOut    - min(0, net)  (negative balance carried to next month)
 *
 * A LOCKED month (marked paid or month closed) is frozen: its figures come
 * from the stored snapshot, never from today's data. Carry into later months
 * uses the locked month's frozen carryOut. If the data under a locked month
 * changes, the difference is offered as a "prior-period correction" that the
 * user can post as an adjustment in an open month (suggestCorrection).
 */

var ADJUSTMENT_CATEGORIES = [
  { key: 'clawback_not_on_file', label: 'Clawback not yet on file' },
  { key: 'correction', label: 'Correction' },
  { key: 'advance', label: 'Advance' },
  { key: 'prior_period_correction', label: 'Prior-period correction' },
  // Agent paid back a balance due (chargebacks bigger than earnings). Positive: it cancels
  // the negative balance in the month it is posted (or the negative carried into it).
  { key: 'agent_repayment', label: 'Repayment from agent' },
  { key: 'other', label: 'Other' },
];

var LABEL_PAYABLE = 'Amount payable to agent';
var LABEL_BALANCE_DUE = 'Balance due from agent';

var PAYMENT_METHODS = [
  { key: 'check', label: 'Check' },
  { key: 'ach', label: 'ACH' },
  { key: 'zelle', label: 'Zelle' },
  { key: 'other', label: 'Other' },
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isCategory(key) {
  return ADJUSTMENT_CATEGORIES.some(function (c) { return c.key === key; });
}

function categoryLabel(key) {
  var c = ADJUSTMENT_CATEGORIES.find(function (x) { return x.key === key; });
  return c ? c.label : String(key || '');
}

function isMethod(key) {
  return PAYMENT_METHODS.some(function (m) { return m.key === key; });
}

/** Active (not voided) adjustments only. */
function activeAdjustments(adjs) {
  return (adjs || []).filter(function (a) { return !a.voided_at && a.status !== 'void'; });
}

/** { period: sum } of active adjustment amounts. */
function adjustmentTotalsByPeriod(adjs) {
  var out = {};
  activeAdjustments(adjs).forEach(function (a) {
    var p = String(a.payment_period || a.period || '');
    out[p] = round2((out[p] || 0) + (Number(a.amount) || 0));
  });
  return out;
}

/**
 * Validate an adjustment request. Returns an error string or null.
 * locked: true when payee+period is locked or the month is closed.
 */
function validateAdjustment(input, locked) {
  var a = input || {};
  if (!/^\d{6}$/.test(String(a.period || ''))) return 'period must be YYYYMM';
  if (!String(a.agent || '').trim()) return 'agent is required';
  var amt = Number(a.amount);
  if (!Number.isFinite(amt) || amt === 0) return 'amount must be a non-zero number';
  if (!String(a.reason || '').trim()) return 'reason is required';
  if (!isCategory(a.category)) return 'unknown category';
  if (a.category === 'prior_period_correction' && !/^\d{6}$/.test(String(a.correctsPeriod || ''))) {
    return 'a prior-period correction needs the period it corrects';
  }
  if (a.category === 'agent_repayment' && !(amt > 0)) return 'a repayment from the agent is a positive amount';
  if (locked) return 'this month is locked for that payee (paid or closed) — post it in an open month';
  return null;
}

/**
 * Bottom line of an agent statement / payout row from the month's net (carry-forward
 * included when known). net < 0 → the agent owes it back.
 *   { net, isBalanceDue, label, amount }  amount is always >= 0
 */
function bottomLine(net) {
  var n = round2(net);
  if (n < 0) return { net: n, isBalanceDue: true, label: LABEL_BALANCE_DUE, amount: round2(-n) };
  return { net: n, isBalanceDue: false, label: LABEL_PAYABLE, amount: n };
}

/**
 * Carry-forward that honors locks.
 * @param {Object<string,number>} dataTotals  { YYYYMM: data total }
 * @param {Object<string,number>} adjTotals   { YYYYMM: adjustment total }
 * @param {Object<string,Object>} locks       { YYYYMM: lock snapshot {period_total, carry_in, net, payable, carry_out} }
 * @param {string} period
 * @param {string} startPeriod  first carry month (earlier months never carry)
 */
function computeCarryWithLocks(dataTotals, adjTotals, locks, period, startPeriod) {
  dataTotals = dataTotals || {};
  adjTotals = adjTotals || {};
  locks = locks || {};
  var start = startPeriod || '202609';
  var set = {};
  [dataTotals, adjTotals, locks].forEach(function (o) {
    Object.keys(o).forEach(function (p) {
      if (/^\d{6}$/.test(p) && p >= start && p <= period) set[p] = true;
    });
  });
  set[period] = true;
  var periods = Object.keys(set).sort();

  function liveTotals(p) {
    var d = round2(dataTotals[p] || 0);
    var a = round2(adjTotals[p] || 0);
    return { dataTotal: d, adjustmentsTotal: a, periodTotal: round2(d + a) };
  }

  if (period < start) {
    var lt = liveTotals(period);
    if (locks[period]) return fromLock(locks[period], period, start, lt);
    return {
      period: period, startPeriod: start, locked: false,
      dataTotal: lt.dataTotal, adjustmentsTotal: lt.adjustmentsTotal, periodTotal: lt.periodTotal,
      carryIn: 0, net: lt.periodTotal, payable: Math.max(0, lt.periodTotal), carryOut: 0,
    };
  }

  var carry = 0;
  var out = null;
  periods.forEach(function (p) {
    var live = liveTotals(p);
    if (locks[p]) {
      out = fromLock(locks[p], p, start, live);
    } else {
      var net = round2(carry + live.periodTotal);
      out = {
        period: p, startPeriod: start, locked: false,
        dataTotal: live.dataTotal, adjustmentsTotal: live.adjustmentsTotal, periodTotal: live.periodTotal,
        carryIn: round2(carry), net: net, payable: Math.max(0, net), carryOut: Math.min(0, net),
      };
    }
    carry = out.carryOut;
  });
  return out;
}

function fromLock(lock, p, start, live) {
  var lockedData = round2(lock.data_total);
  return {
    period: p, startPeriod: start, locked: true, lockId: lock.id || null,
    dataTotal: lockedData,
    adjustmentsTotal: round2(lock.adjustments_total),
    periodTotal: round2(lock.period_total),
    carryIn: round2(lock.carry_in),
    net: round2(lock.net),
    payable: round2(lock.payable),
    carryOut: round2(lock.carry_out),
    liveDataTotal: live ? live.dataTotal : null,
    dataDrift: live ? round2(live.dataTotal - lockedData) : 0,
  };
}

/**
 * Suggested prior-period correction for one locked payee+period.
 * liveDataTotal: what the rows add up to now. postedCorrections: active
 * 'prior_period_correction' adjustments already posted for this locked period.
 * Returns 0 when nothing is left to correct.
 */
function suggestCorrection(lockedDataTotal, liveDataTotal, postedCorrections) {
  var posted = round2((postedCorrections || []).reduce(function (s, a) { return s + (Number(a.amount) || 0); }, 0));
  var diff = round2((Number(liveDataTotal) || 0) - (Number(lockedDataTotal) || 0) - posted);
  return Math.abs(diff) < 0.005 ? 0 : diff;
}

/** Build the lock snapshot row from a carry result + payment info. */
function lockSnapshot(carry, extra) {
  var e = extra || {};
  return {
    data_total: round2(carry.dataTotal),
    adjustments_total: round2(carry.adjustmentsTotal),
    period_total: round2(carry.periodTotal),
    carry_in: round2(carry.carryIn),
    net: round2(carry.net),
    payable: round2(carry.payable),
    carry_out: round2(carry.carryOut),
    paid_amount: e.paidAmount != null ? round2(e.paidAmount) : null,
    statement_total: e.statementTotal != null ? round2(e.statementTotal) : null,
  };
}

module.exports = {
  ADJUSTMENT_CATEGORIES: ADJUSTMENT_CATEGORIES,
  PAYMENT_METHODS: PAYMENT_METHODS,
  round2: round2,
  isCategory: isCategory,
  categoryLabel: categoryLabel,
  isMethod: isMethod,
  activeAdjustments: activeAdjustments,
  adjustmentTotalsByPeriod: adjustmentTotalsByPeriod,
  validateAdjustment: validateAdjustment,
  computeCarryWithLocks: computeCarryWithLocks,
  suggestCorrection: suggestCorrection,
  lockSnapshot: lockSnapshot,
  bottomLine: bottomLine,
  LABEL_PAYABLE: LABEL_PAYABLE,
  LABEL_BALANCE_DUE: LABEL_BALANCE_DUE,
};

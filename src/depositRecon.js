'use strict';

/*
 * THEI bank deposit reconciliation (pure logic, shared with the frontend).
 * NOTE: no destructuring / spread — see src/bsiStatementTitle.js.
 *
 * HOW "EXPECTED" IS DERIVED (kept deliberately simple — see routes/payroll-close.js
 * expectedByPayer() for the SQL):
 *   - Payer "BSI": every BSI statement upload (uploads.category = 'bsi_statement')
 *     for the period. Expected = SUM(commission - bsi_share) over those rows, i.e.
 *     everything on the statement except BSI's own cut. That is THEI's share plus the
 *     producer pay THEI now passes through to agents (Lina / Integrity / ACA).
 *     Licensing/appointment fees are not stored as rows, so if BSI nets fees out of
 *     the wire the difference will show here.
 *   - Direct carrier statements paid straight to THEI (category commission_statement
 *     or NULL): payer = the upload's carrier, expected = SUM(commission).
 *   - Agent payout uploads are excluded (money THEI pays out, not receives).
 * Received = deposits allocated to that payer + period. A deposit can be split across
 * several periods (allocations) and a period can have several deposits.
 */

var PAYERS = ['BSI', 'UnitedHealthcare', 'Humana', 'Devoted', 'Aetna', 'Freedom', 'Wellcare', 'Ambetter', 'Oscar', 'Florida Blue', 'Other'];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Payer label for a deposit ("Other" + free text -> the free text). */
function depositPayer(d) {
  if (!d) return '';
  if (d.payer === 'Other' && String(d.payer_other || '').trim()) return String(d.payer_other).trim();
  return String(d.payer || '').trim();
}

function payerKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Check that allocations add up to no more than the deposit. Returns error or null. */
function validateDeposit(input) {
  var d = input || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.depositDate || ''))) return 'deposit date (YYYY-MM-DD) is required';
  if (!String(d.payer || '').trim()) return 'payer is required';
  if (d.payer === 'Other' && !String(d.payerOther || '').trim()) return 'type the payer name for Other';
  var amt = Number(d.amount);
  if (!Number.isFinite(amt) || amt <= 0) return 'amount must be greater than 0';
  var allocs = d.allocations || [];
  var sum = 0;
  for (var i = 0; i < allocs.length; i += 1) {
    if (!/^\d{6}$/.test(String(allocs[i].period || ''))) return 'each allocation needs a YYYYMM period';
    var a = Number(allocs[i].amount);
    if (!Number.isFinite(a) || a <= 0) return 'each allocation amount must be greater than 0';
    sum += a;
  }
  if (round2(sum) - round2(amt) > 0.005) return 'allocations add up to more than the deposit';
  return null;
}

/**
 * @param {Object} opts
 *   period
 *   expected: [{payer, expected, uploads?}]
 *   deposits: [{id, payer, payer_other, amount, deposit_date, reference, allocations:[{payment_period, amount}]}]
 * @returns {{rows, unmatched, totals}}
 */
function reconcileDeposits(opts) {
  var o = opts || {};
  var period = String(o.period || '');
  var rows = {};
  function row(name) {
    var k = payerKey(name);
    if (!rows[k]) rows[k] = { payer: name, expected: 0, received: 0, deposits: [], uploads: [] };
    return rows[k];
  }
  (o.expected || []).forEach(function (e) {
    var r = row(e.payer);
    r.expected = round2(r.expected + (Number(e.expected) || 0));
    r.uploads = r.uploads.concat(e.uploads || []);
  });

  var unmatched = [];
  (o.deposits || []).forEach(function (d) {
    var allocs = d.allocations || [];
    var allocated = round2(allocs.reduce(function (s, a) { return s + (Number(a.amount) || 0); }, 0));
    var here = round2(allocs.filter(function (a) { return String(a.payment_period) === period; })
      .reduce(function (s, a) { return s + (Number(a.amount) || 0); }, 0));
    if (here !== 0) {
      var r = row(depositPayer(d));
      r.received = round2(r.received + here);
      r.deposits.push({ id: d.id, date: d.deposit_date, reference: d.reference || '', amount: here });
    }
    var remainder = round2((Number(d.amount) || 0) - allocated);
    if (remainder > 0.005) {
      unmatched.push({ id: d.id, payer: depositPayer(d), date: d.deposit_date, reference: d.reference || '', amount: round2(d.amount), unallocated: remainder });
    }
  });

  var list = Object.keys(rows).map(function (k) {
    var r = rows[k];
    r.difference = round2(r.received - r.expected);
    r.ok = Math.abs(r.difference) < 0.005;
    return r;
  }).sort(function (a, b) {
    if (a.payer === 'BSI') return -1;
    if (b.payer === 'BSI') return 1;
    return a.payer.localeCompare(b.payer);
  });

  return {
    period: period,
    rows: list,
    unmatched: unmatched,
    totals: {
      expected: round2(list.reduce(function (s, r) { return s + r.expected; }, 0)),
      received: round2(list.reduce(function (s, r) { return s + r.received; }, 0)),
      difference: round2(list.reduce(function (s, r) { return s + r.difference; }, 0)),
    },
  };
}

/** Rows that should show up as checklist warnings. */
function depositWarnings(recon) {
  return ((recon && recon.rows) || []).filter(function (r) { return !r.ok; })
    .map(function (r) { return { payer: r.payer, expected: r.expected, received: r.received, difference: r.difference }; });
}

module.exports = {
  PAYERS: PAYERS,
  depositPayer: depositPayer,
  payerKey: payerKey,
  validateDeposit: validateDeposit,
  reconcileDeposits: reconcileDeposits,
  depositWarnings: depositWarnings,
};

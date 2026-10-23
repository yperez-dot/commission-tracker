'use strict';

/**
 * Carry-forward of negative balances (chargebacks bigger than the month's earnings).
 *
 * Rule: a month's net = this month's balance + negative balance carried in.
 *   - net > 0  -> pay it, nothing carries
 *   - net < 0  -> pay $0, the negative carries into next month
 * Positive balances are assumed paid and never carry.
 * Carry starts at CARRY_START (first on-time month) so old, late-processed BSI
 * months can't create phantom debts.
 */

const DEFAULT_CARRY_START = process.env.CARRY_START_PERIOD || '202609';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * @param {Object<string,number>} totalsByPeriod  { '202609': 1200.5, ... } period balances
 * @param {string} period  YYYYMM being issued/paid
 * @returns {{carryIn, periodTotal, net, payable, carryOut, startPeriod}}
 */
function computeCarry(totalsByPeriod, period, startPeriod = DEFAULT_CARRY_START) {
  const periods = Object.keys(totalsByPeriod || {})
    .filter((p) => /^\d{6}$/.test(p) && p >= startPeriod && p <= period)
    .sort();
  if (!periods.includes(period)) periods.push(period);
  periods.sort();
  let carry = 0;
  let out = { carryIn: 0, periodTotal: 0, net: 0, payable: 0, carryOut: 0, startPeriod };
  for (const p of periods) {
    const total = round2((totalsByPeriod || {})[p] || 0);
    const net = round2(carry + total);
    out = {
      carryIn: round2(carry),
      periodTotal: total,
      net,
      payable: Math.max(0, net),
      carryOut: Math.min(0, net),
      startPeriod,
    };
    carry = out.carryOut;
  }
  if (period < startPeriod) {
    return { carryIn: 0, periodTotal: round2((totalsByPeriod || {})[period] || 0), net: round2((totalsByPeriod || {})[period] || 0), payable: Math.max(0, round2((totalsByPeriod || {})[period] || 0)), carryOut: 0, startPeriod };
  }
  return out;
}

function totalsByPeriodFromLines(lines, field = 'commission') {
  const t = {};
  for (const l of lines || []) {
    const p = String(l.paymentPeriod || '');
    t[p] = round2((t[p] || 0) + (Number(l[field]) || 0));
  }
  return t;
}

module.exports = { computeCarry, totalsByPeriodFromLines, DEFAULT_CARRY_START };

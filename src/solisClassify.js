'use strict';

/**
 * Solis / Doctors "Commissions Ledger" Payment Type → OliComm classification.
 *
 * The carrier's explicit Payment Type wins over the enrollment-month heuristic.
 * "Agent Renewal Compensation" for a 1/1/2026 enrollment paid with Commission Eff.
 * 1/1/2026 is a renewal ($347), not new business — the heuristic alone mislabeled the
 * four $347 renewals on YP_SOLIS_STATEMENT_01.2026_10.2026.
 *
 * "Negative Charge from Previous Month" (and blank-member prior negatives) are
 * statement carryovers of unpaid balance, not new chargebacks — see solisCarryover.js.
 *
 * @param {string} paymentType lower-cased, whitespace-collapsed Payment Type
 * @param {number} commission Payment Amt
 * @param {boolean} enrolledInCommissionMonth enrollment YYYYMM === commission eff YYYYMM
 * @param {{ isPriorMonthNegative?: boolean, paymentTypeRaw?: string }} [opts]
 */
const {
  CARRYOVER_CLASSIFICATION,
  isPriorMonthNegativePaymentType,
} = require('./solisCarryover');

function solisClassification(paymentType, commission, enrolledInCommissionMonth, opts) {
  const options = opts || {};
  const pt = String(paymentType || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const raw = options.paymentTypeRaw != null ? options.paymentTypeRaw : paymentType;
  if (options.isPriorMonthNegative || isPriorMonthNegativePaymentType(raw)) {
    return CARRYOVER_CLASSIFICATION;
  }
  if (commission < 0) return 'Chargeback';
  if (pt.includes('chargeback')) return 'Chargeback';
  if (pt.includes('initial')) return 'New Business';
  if (pt.includes('renewal') || pt.includes('retention')) return 'Renewal';
  if (enrolledInCommissionMonth) return 'New Business';
  if (pt.includes('new')) return 'New Business';
  return 'Renewal';
}

module.exports = { solisClassification, CARRYOVER_CLASSIFICATION };

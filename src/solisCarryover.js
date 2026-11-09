'use strict';

/**
 * Doctors / Solis "Negative Charge from Previous Month" is a statement carry of
 * the prior month's unpaid negative balance — not a new chargeback. Real
 * chargebacks are the original negative member lines that created the balance;
 * each later statement reprints the leftover as this policy-less row.
 *
 * Keep the amount in commission / statement totals (so the file net still
 * matches), but exclude it from Chargeback KPIs, chargeback ratios, and
 * agent-statement chargeback sections so the same leftover is not counted
 * again every month.
 */

const CARRYOVER_CLASSIFICATION = 'Carryover from previous month';

function isCarryoverClassification(classification) {
  const c = String(classification || '').toLowerCase();
  return c.includes('carryover from previous') || c === 'carryover';
}

function isPriorMonthNegativePaymentType(paymentTypeRaw) {
  return /negative|previous\s*month|prior\s*month|carry\s*over|carryover/i.test(
    String(paymentTypeRaw || '')
  );
}

/** SQL fragment: true when classification is a Doctors/Solis prior-month carry. */
function isCarryoverClassSql(alias) {
  const col = alias ? `${alias}.classification` : 'classification';
  return `(COALESCE(${col},'') ILIKE '%carryover from previous%' OR LOWER(COALESCE(${col},'')) = 'carryover')`;
}

module.exports = {
  CARRYOVER_CLASSIFICATION,
  isCarryoverClassification,
  isPriorMonthNegativePaymentType,
  isCarryoverClassSql,
};

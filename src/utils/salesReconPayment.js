'use strict';

/** Within $1 = paid in full (carrier rounding). */
export const PAYMENT_TOLERANCE = 1.0;

/** Full-year Medicare NB rate used in Sales Recon (Jan effective). Mid-year is prorated. */
export const FULL_YEAR_NB = 347;

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Parse effective date → calendar month 1–12. */
export function parseEffectiveMonth(effectiveDate) {
  if (!effectiveDate) return null;
  const s = String(effectiveDate).trim();
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return parseInt(iso[2], 10);
  const mdY = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (mdY) return parseInt(mdY[1], 10);
  return null;
}

/** Remaining months in the calendar year from effective month (Jan=12 … Dec=1). */
export function remainingCalendarMonths(effectiveDate) {
  const m = parseEffectiveMonth(effectiveDate);
  if (!m || m < 1 || m > 12) return 12;
  return 13 - m;
}

/**
 * Expected agent commission for a MedicarePro sale.
 * New business is calendar-prorated: July = 6/12 of $347, not $347.
 * Renewals use the monthly floor ($347/12).
 */
export function expectedSaleCommission(sale) {
  const blob = `${sale?.policy_type || ''} ${sale?.transaction_type || ''} ${sale?.sale_type || ''}`.toLowerCase();
  const renewal = blob.includes('renewal');
  const remaining = remainingCalendarMonths(sale?.effective_date);
  const months = renewal ? 1 : remaining;
  const amount = round2((FULL_YEAR_NB * months) / 12);
  return {
    amount,
    remainingMonths: months,
    fullYear: FULL_YEAR_NB,
    prorated: !renewal && remaining < 12,
    kind: renewal ? 'renewal' : 'new_business',
  };
}

export function isSaleCommissionRow(record) {
  const c = String(record?.classification || '').toLowerCase();
  if (c.includes('override')) return false;
  if (c.includes('agency override')) return false;
  return true;
}

export function sumCommissionNet(matches, { saleSideOnly = true } = {}) {
  const rows = saleSideOnly ? (matches || []).filter(isSaleCommissionRow) : matches || [];
  return rows.reduce((s, m) => s + (parseFloat(m.commission) || 0), 0);
}

/**
 * @param {Array<{ commission?: number|string, payment_period?: string, statement_month?: string, classification?: string }>} matches
 */
export function buildDepositTimeline(matches, { saleSideOnly = true } = {}) {
  const rows = saleSideOnly ? (matches || []).filter(isSaleCommissionRow) : matches || [];
  return rows
    .map((m) => ({
      amount: parseFloat(m.commission) || 0,
      period: m.payment_period || m.statement_month || '—',
      classification: m.classification || '',
    }))
    .filter((d) => d.amount !== 0)
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));
}

/**
 * @returns {{ id: 'unpaid'|'partial'|'paid'|'overpaid'|'manual'|'reversed', label: string, remaining?: number }}
 */
export function resolveSalePaymentStatus({ expected, actualNet, isManual, fullYear = FULL_YEAR_NB }) {
  if (isManual) {
    return { id: 'manual', label: 'Marked paid' };
  }

  const exp = parseFloat(expected) || 0;
  const act = parseFloat(actualNet) || 0;
  const cap = parseFloat(fullYear) || FULL_YEAR_NB;

  if (act <= 0) {
    return { id: 'unpaid', label: 'Unpaid' };
  }

  if (exp <= 0) {
    return { id: 'paid', label: act > 0 ? 'Paid' : 'Unpaid' };
  }

  const remaining = round2(exp - act);
  if (remaining > PAYMENT_TOLERANCE) {
    return { id: 'partial', label: 'Partial', remaining };
  }
  // Met prorated expected. Amounts between prorated and full-year $347 are paid, not overpaid.
  if (act > cap + PAYMENT_TOLERANCE) {
    return { id: 'overpaid', label: 'Overpaid' };
  }
  return { id: 'paid', label: 'Paid in full' };
}

/** Group payout lines by client for multi-deposit views (e.g. Lina). */
export function groupClientDeposits(records, amountFn) {
  const fn = amountFn || ((r) => parseFloat(r.producer_payable ?? r.commission ?? 0) || 0);
  const byKey = {};
  for (const r of records || []) {
    const client = r.client_full_name || r.client_name || 'Unknown';
    const key = `${client}|${r.policy_number || ''}|${r.carrier || ''}`;
    if (!byKey[key]) {
      byKey[key] = { client, policy: r.policy_number, carrier: r.carrier, deposits: [], total: 0 };
    }
    const amount = fn(r);
    byKey[key].deposits.push({
      amount,
      period: r.payment_period || r.statement_month || '—',
      classification: r.classification || '',
    });
    byKey[key].total += amount;
  }
  return Object.values(byKey);
}

export function countSplitDepositClients(records, amountFn) {
  return groupClientDeposits(records, amountFn).filter((g) => g.deposits.length > 1).length;
}

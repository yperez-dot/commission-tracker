'use strict';

/** Within $1 = paid in full (carrier rounding). */
export const PAYMENT_TOLERANCE = 1.0;

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
export function resolveSalePaymentStatus({ expected, actualNet, isManual }) {
  if (isManual) {
    return { id: 'manual', label: 'Marked paid' };
  }

  const exp = parseFloat(expected) || 0;
  const act = parseFloat(actualNet) || 0;

  if (act <= 0) {
    return { id: 'unpaid', label: 'Unpaid' };
  }

  if (exp <= 0) {
    return { id: 'paid', label: act > 0 ? 'Paid' : 'Unpaid' };
  }

  const remaining = exp - act;
  if (remaining > PAYMENT_TOLERANCE) {
    return { id: 'partial', label: 'Partial', remaining };
  }
  if (act > exp + PAYMENT_TOLERANCE) {
    return { id: 'overpaid', label: 'Overpaid' };
  }
  if (Math.abs(act) < PAYMENT_TOLERANCE && act !== 0) {
    return { id: 'reversed', label: 'Net zero' };
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

'use strict';

/** Within $1 = paid in full (carrier rounding). */
export const PAYMENT_TOLERANCE = 1.0;

/** Full-year Medicare NB rate used in Sales Recon (Jan effective). Mid-year is prorated.
 *  2026 industry residual FMV. Aetna 2027+ uses aetnaCommissionSchedule.js instead. */
export const FULL_YEAR_NB = 347;

const { lookupMedSuppYear1 } = require('../medSuppCommissionSchedule');
const {
  isAetnaCarrier,
  lookupAetnaMaRate,
  lookupAetnaPdpRate,
} = require('../aetnaCommissionSchedule');

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
 * Product family for a MedicarePro sale.
 * MA/MAPD uses the $347 calendar-prorated NB schedule.
 * Med Supp / PDP do not — those tables are separate.
 */
export function detectSaleProductFamily(sale) {
  const s = `${sale?.policy_type || ''} ${sale?.plan_name || ''} ${sale?.product || ''} ${sale?.lob || ''} ${sale?.marketing_name || ''} ${sale?.carrier || ''}`.toLowerCase();
  if (/med\s*supp|medsup|medigap|supplement/.test(s)) return 'MED_SUPP';
  if (/mapd|medicare\s+advantage|(^|\s)ma(\s|$)/.test(s)) return 'MA_MAPD';
  if (/\bpdp\b|prescription\s+drug/.test(s)) return 'PDP';
  return 'UNKNOWN';
}

/**
 * Expected agent commission for a MedicarePro sale.
 * Medicare Advantage NB: calendar-prorated $347 (July = 6/12, not $347).
 * Med Supp: UHC AARP Year-1 by state/area/plan, or HealthSpring/CNHIC
 * AgentView-derived as-earned Year-1 (not $347).
 */
export function expectedSaleCommission(sale) {
  const family = detectSaleProductFamily(sale);
  const blob = `${sale?.policy_type || ''} ${sale?.transaction_type || ''} ${sale?.sale_type || ''}`.toLowerCase();
  const renewal = blob.includes('renewal');

  if (family === 'MED_SUPP') {
    // Renewals use years 2–6+ bands later; for now Year-1 table is NB expected only.
    if (renewal) {
      return {
        amount: null,
        remainingMonths: remainingCalendarMonths(sale?.effective_date),
        fullYear: null,
        prorated: false,
        kind: 'med_supp',
        family,
        note: 'Med Supp renewal bands not applied yet — Year-1 table is NB only',
        medSupp: null,
      };
    }
    const med = lookupMedSuppYear1(sale);
    return {
      amount: med.amount,
      remainingMonths: remainingCalendarMonths(sale?.effective_date),
      fullYear: med.amount,
      prorated: false,
      kind: 'med_supp',
      family,
      note: med.note,
      medSupp: med,
    };
  }

  if (family === 'PDP') {
    if (isAetnaCarrier(sale?.carrier)) {
      const pdp = lookupAetnaPdpRate({
        effectiveDate: sale?.effective_date,
        contractLevel: sale?.contract_level || sale?.hierarchy_level || 'AG4',
      });
      if (pdp.found) {
        const remaining = remainingCalendarMonths(sale?.effective_date);
        if (pdp.nonCommissionable) {
          return {
            amount: 0,
            remainingMonths: remaining,
            fullYear: 0,
            prorated: false,
            kind: 'pdp',
            family,
            note: pdp.note,
            aetna: pdp,
          };
        }
        return {
          amount: round2((pdp.renewal || 0) / 12),
          remainingMonths: 1,
          fullYear: pdp.renewal,
          prorated: false,
          kind: 'pdp',
          family,
          note: pdp.note,
          aetna: pdp,
        };
      }
    }
    return {
      amount: null,
      remainingMonths: remainingCalendarMonths(sale?.effective_date),
      fullYear: null,
      prorated: false,
      kind: 'pdp',
      family,
      note: 'PDP schedule not applied',
    };
  }

  const remaining = remainingCalendarMonths(sale?.effective_date);
  const months = renewal ? 1 : remaining;

  // 2027 Aetna Agent 4: Base is the Sales Recon expected (same role as 2026 $347).
  // CMS New is the overpay cap so a true new-to-Medicare lump sum is not "Overpaid".
  if (isAetnaCarrier(sale?.carrier)) {
    const ma = lookupAetnaMaRate({
      effectiveDate: sale?.effective_date,
      state: sale?.state || sale?.member_state,
      contractLevel: sale?.contract_level || sale?.hierarchy_level || 'AG4',
    });
    if (ma.found) {
      const expectedAnnual = renewal ? ma.renewal : ma.base;
      const amount = round2((expectedAnnual * months) / 12);
      return {
        amount,
        remainingMonths: months,
        fullYear: renewal ? ma.renewal : ma.cmsNew,
        prorated: !renewal && remaining < 12,
        kind: renewal ? 'renewal' : 'new_business',
        family: family === 'UNKNOWN' ? 'MA_MAPD' : family,
        note: `${ma.stateGroup} AG4 ${renewal ? 'Renewal' : 'Base'} $${expectedAnnual}` +
          (renewal ? '' : ` · CMS New cap $${ma.cmsNew}`),
        aetna: ma,
      };
    }
  }

  const amount = round2((FULL_YEAR_NB * months) / 12);
  return {
    amount,
    remainingMonths: months,
    fullYear: FULL_YEAR_NB,
    prorated: !renewal && remaining < 12,
    kind: renewal ? 'renewal' : 'new_business',
    family: family === 'UNKNOWN' ? 'MA_MAPD' : family,
    note: null,
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

  const act = parseFloat(actualNet) || 0;
  const hasSchedule = expected != null && expected !== '' && Number.isFinite(parseFloat(expected));

  if (act <= 0) {
    return { id: 'unpaid', label: 'Unpaid' };
  }

  if (!hasSchedule) {
    return { id: 'paid', label: 'Received' };
  }

  const exp = parseFloat(expected);
  const cap = parseFloat(fullYear) || FULL_YEAR_NB;
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

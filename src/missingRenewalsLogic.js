'use strict';

const { isTheiPrincipalAgent } = require('./theiPrincipalAgents');
const { clientNameKey } = require('./clientNameKey');
const {
  normName,
  nameVariants,
  namesLooseMatch,
  normCarrier,
  normalizeCarrier,
} = require('./matchingNormalize.cjs');

/**
 * Shared Missing Renewals matching + row build logic (server-side).
 * BOB (Yahoska/Katy active) × commission_records for one statement month.
 */

function formatPeriodLabel(p) {
  if (!p) return null;
  const s = String(p).trim();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (s.match(/^\d{6}$/)) return `${months[parseInt(s.slice(4, 6), 10) - 1]} ${s.slice(0, 4)}`;
  return null;
}

function normPeriod(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (s.match(/^\d{6}$/) && parseInt(s.slice(0, 4), 10) > 1900) return s;
  const m1 = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m1) return m1[2] + m1[1].padStart(2, '0');
  const m2 = s.match(/^(\d{1,2})\/\d{2}\/(\d{4})$/);
  if (m2) return m2[2] + m2[1].padStart(2, '0');
  return null;
}

function periodToDate(p) {
  const n = normPeriod(p);
  if (!n) return null;
  return new Date(parseInt(n.slice(0, 4), 10), parseInt(n.slice(4, 6), 10) - 1, 1);
}

function parseEffDate(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (s.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
    const [m, , y] = s.split('/');
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  }
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) {
    const [y, m] = s.split('-');
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  }
  if (s.match(/^\d{8}$/)) {
    return new Date(parseInt(s.slice(0, 4), 10), parseInt(s.slice(4, 6), 10) - 1, 1);
  }
  return null;
}

function monthsBetweenPeriods(fromPeriod, toPeriod) {
  const a = normPeriod(fromPeriod);
  const b = normPeriod(toPeriod);
  if (!a || !b) return 0;
  const ay = parseInt(a.slice(0, 4), 10);
  const am = parseInt(a.slice(4, 6), 10);
  const by = parseInt(b.slice(0, 4), 10);
  const bm = parseInt(b.slice(4, 6), 10);
  const diff = (by - ay) * 12 + (bm - am);
  return diff > 0 ? diff : 0;
}

function isHeldClassification(classification) {
  return String(classification || '').toLowerCase() === 'held';
}

/** Stub months (1–2 stray rows) are not real statement months for renewals. */
const MIN_STATEMENT_MONTH_RECORDS = 50;

/**
 * Collapse raw payment_period strings into YYYYMM counts and pick a default.
 * @param {Array<{ payment_period?: string, period?: string, record_count?: number, count?: number, n?: number }>} rows
 * @returns {{ periods: Array<{ period: string, label: string, recordCount: number, viable: boolean }>, defaultPeriod: string|null }}
 */
function buildMissingRenewalsPeriodOptions(rows) {
  const counts = new Map();
  for (const row of rows || []) {
    const raw = row.payment_period || row.period;
    const period = normPeriod(raw);
    if (!period) continue;
    const n = Number(row.record_count ?? row.count ?? row.n ?? 0) || 0;
    counts.set(period, (counts.get(period) || 0) + n);
  }

  const periods = [...counts.entries()]
    .map(([period, recordCount]) => ({
      period,
      label: formatPeriodLabel(period),
      recordCount,
      viable: recordCount >= MIN_STATEMENT_MONTH_RECORDS,
    }))
    .sort((a, b) => b.period.localeCompare(a.period));

  const viable = periods.filter((p) => p.viable);
  const defaultPeriod = viable.length
    ? viable[0].period
    : periods.length
      ? [...periods].sort((a, b) => b.recordCount - a.recordCount)[0].period
      : null;

  return { periods, defaultPeriod, minRecords: MIN_STATEMENT_MONTH_RECORDS };
}

/**
 * @param {object} opts
 * @param {Array} opts.bobClients - active BOB rows (already scoped)
 * @param {Array} opts.periodRecords - commission_records for target period
 * @param {string} opts.period - YYYYMM (or displayable period)
 * @param {Set<string>} opts.heldKeySet - `${normName}|${normCarrier}` for licensing holds
 * @param {object} opts.policyStatusMap - key `${normName}|${normCarrier}|${normName(agent)}` → status row
 */
function buildMissingRenewalRows({
  bobClients,
  periodRecords,
  period,
  heldKeySet = new Set(),
  policyStatusMap = {},
}) {
  const targetNorm = normPeriod(period);
  const checkDate = periodToDate(period);

  const recMap = new Map(); // exact variant key → records
  const recByNameKey = new Map(); // clientNameKey|carrier → records (All Data style)
  for (const r of periodRecords) {
    const ck = normCarrier(r.carrier);
    for (const v of nameVariants(r.client_full_name)) {
      const key = `${v}|${ck}`;
      if (!recMap.has(key)) recMap.set(key, []);
      recMap.get(key).push(r);
    }
    const nk = `${clientNameKey(r.client_full_name)}|${ck}`;
    if (nk.startsWith('|')) continue;
    if (!recByNameKey.has(nk)) recByNameKey.set(nk, []);
    recByNameKey.get(nk).push(r);
  }

  const byCarrier = new Map();
  for (const r of periodRecords) {
    const ck = normCarrier(r.carrier);
    if (!byCarrier.has(ck)) byCarrier.set(ck, []);
    byCarrier.get(ck).push(r);
  }

  const built = [];

  for (const client of bobClients) {
    const nc = normCarrier(client.carrier);
    const effDate = parseEffDate(client.effective_date);
    if (effDate && checkDate) {
      const monthsDiff =
        (checkDate.getFullYear() - effDate.getFullYear()) * 12 +
        (checkDate.getMonth() - effDate.getMonth());
      // Renewals only — skip first-year members
      if (monthsDiff < 12) continue;
    }

    let matchedRecs = [];
    const bobNameKey = `${clientNameKey(client.client_full_name)}|${nc}`;
    if (bobNameKey && recByNameKey.has(bobNameKey)) {
      matchedRecs = recByNameKey.get(bobNameKey);
    }

    if (!matchedRecs.length) {
      for (const v of nameVariants(client.client_full_name)) {
        const k = `${v}|${nc}`;
        if (recMap.has(k) && recMap.get(k).length) {
          matchedRecs = recMap.get(k);
          break;
        }
      }
    }

    if (!matchedRecs.length) {
      const pool = byCarrier.get(nc) || [];
      matchedRecs = pool.filter((r) => namesLooseMatch(client.client_full_name, r.client_full_name));
    }

    // Deduplicate by id if present
    if (matchedRecs.length) {
      const seen = new Set();
      matchedRecs = matchedRecs.filter((r) => {
        const id = r.id != null ? String(r.id) : `${r.client_full_name}|${r.commission}|${r.classification}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    const paidRecs = matchedRecs.filter((r) => !isHeldClassification(r.classification));
    const heldRecs = matchedRecs.filter((r) => isHeldClassification(r.classification));
    const commission = paidRecs.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);

    const lastPeriodNorm = normPeriod(client.last_commission_date);
    const hasPaidThisPeriod = paidRecs.length > 0;
    const lastPaidCaughtUp = lastPeriodNorm && targetNorm && lastPeriodNorm >= targetNorm;
    const isMissing = !hasPaidThisPeriod && !lastPaidCaughtUp;

    const heldKey = `${normName(client.client_full_name)}|${nc}`;
    const isHeld =
      isMissing && (heldKeySet.has(heldKey) || (heldRecs.length > 0 && paidRecs.length === 0));

    const psKey = `${normName(client.client_full_name)}|${nc}|${normName(client.agent_name)}`;
    const psData = policyStatusMap[psKey] || null;

    const monthsMissing = client.last_commission_date
      ? monthsBetweenPeriods(client.last_commission_date, targetNorm)
      : 0;

    built.push({
      client: client.client_full_name,
      agent: client.agent_name || '—',
      carrier: client.carrier,
      effectiveDate: client.effective_date,
      lastPaidPeriod: client.last_commission_date,
      commission,
      lastKnownCommission: parseFloat(client.last_commission_amount) || 0,
      isMissing,
      isHeld: !!isHeld,
      monthsMissing,
      bobId: client.id,
      lob: paidRecs[0]?.lob || heldRecs[0]?.lob || '',
      policyStatus: psData?.status || null,
      termedDate: psData?.termed_date || null,
      policyNotes: psData?.notes || null,
      matchCount: matchedRecs.length,
    });
  }

  built.sort((a, b) => {
    if (a.isMissing !== b.isMissing) return a.isMissing ? -1 : 1;
    if (a.isMissing && b.isMissing && a.monthsMissing !== b.monthsMissing) {
      return b.monthsMissing - a.monthsMissing;
    }
    return a.agent.localeCompare(b.agent) || a.client.localeCompare(b.client);
  });

  return {
    period: targetNorm,
    periodLabel: formatPeriodLabel(targetNorm),
    checkedClients: bobClients.length,
    periodRecordCount: periodRecords.length,
    rows: built,
    summary: {
      total: built.length,
      missing: built.filter((r) => r.isMissing && !r.isHeld).length,
      held: built.filter((r) => r.isHeld).length,
      paid: built.filter((r) => !r.isMissing).length,
      // One-period estimate from BOB last_commission_amount (not current-period $0)
      estimatedMissing: built
        .filter((r) => r.isMissing && !r.isHeld)
        .reduce((s, r) => s + (parseFloat(r.lastKnownCommission) || 0), 0),
      paidCommission: built
        .filter((r) => !r.isMissing)
        .reduce((s, r) => s + (parseFloat(r.commission) || 0), 0),
    },
  };
}

module.exports = {
  normName,
  normCarrier,
  normalizeCarrier,
  normPeriod,
  nameVariants,
  namesLooseMatch,
  buildMissingRenewalRows,
  buildMissingRenewalsPeriodOptions,
  isTheiPrincipalAgent,
  monthsBetweenPeriods,
  formatPeriodLabel,
  MIN_STATEMENT_MONTH_RECORDS,
};

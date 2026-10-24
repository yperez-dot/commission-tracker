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
  const n = normPeriod(p);
  if (!n) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(n.slice(4, 6), 10) - 1]} ${n.slice(0, 4)}`;
}

/**
 * Normalize payment / last-paid periods to YYYYMM.
 * Accepts YYYYMM, MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, Date, and "May 2026".
 */
function normPeriod(p) {
  if (p == null || p === '') return null;
  if (p instanceof Date && !Number.isNaN(p.getTime())) {
    const y = p.getUTCFullYear();
    const m = p.getUTCMonth() + 1;
    if (y > 1900 && m >= 1 && m <= 12) return `${y}${String(m).padStart(2, '0')}`;
    return null;
  }
  const s = String(p).trim();
  if (s.match(/^\d{6}$/) && parseInt(s.slice(0, 4), 10) > 1900) return s;
  const m1 = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m1) return m1[2] + m1[1].padStart(2, '0');
  const m2 = s.match(/^(\d{1,2})\/\d{2}\/(\d{4})$/);
  if (m2) return m2[2] + m2[1].padStart(2, '0');
  const iso = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?(?:T.*)?$/);
  if (iso && parseInt(iso[1], 10) > 1900) return iso[1] + iso[2];
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const named = s.toLowerCase().match(/^([a-z]{3})[a-z]*\s+(\d{4})$/);
  if (named && months[named[1]]) return named[2] + months[named[1]];
  return null;
}

function periodToDate(p) {
  const n = normPeriod(p);
  if (!n) return null;
  return new Date(parseInt(n.slice(0, 4), 10), parseInt(n.slice(4, 6), 10) - 1, 1);
}

function parseEffDate(d) {
  if (!d) return null;
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
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

/**
 * Rows that prove the agent renewal was paid for Missing Renewals.
 * Agency Override / Chargebacks / Held do NOT clear a missing renewal.
 */
function countsAsRenewalPaid(classification) {
  const c = String(classification || '').toLowerCase().trim();
  if (!c) return true;
  if (c === 'held') return false;
  if (c.includes('agency override') || c === 'override') return false;
  if (c.includes('chargeback')) return false;
  return true;
}

/** Identity key shared with All Data Client File. */
function clientCarrierKey(clientName, carrier) {
  const nk = clientNameKey(clientName);
  const ck = normCarrier(carrier);
  if (!nk || !ck) return '';
  return `${nk}|${ck}`;
}

function heldIdentityKey(clientName, carrier) {
  return clientCarrierKey(clientName, carrier);
}

function policyStatusKey(clientName, carrier, agentName) {
  const base = clientCarrierKey(clientName, carrier);
  if (!base) return '';
  return `${base}|${clientNameKey(agentName || '') || normName(agentName || '')}`;
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
 * Prefer the BOB row with usable last-paid, else older effective date, else lower id.
 * Collapses WOODCOCK TIM M / TIM WOODCOCK duplicates into one check row.
 */
function preferBobClient(a, b) {
  const aPaid = normPeriod(a.last_commission_date);
  const bPaid = normPeriod(b.last_commission_date);
  if (aPaid && !bPaid) return a;
  if (bPaid && !aPaid) return b;
  if (aPaid && bPaid && aPaid !== bPaid) return aPaid >= bPaid ? a : b;

  const aAmt = parseFloat(a.last_commission_amount) || 0;
  const bAmt = parseFloat(b.last_commission_amount) || 0;
  if (aAmt !== bAmt) return aAmt >= bAmt ? a : b;

  const aEff = parseEffDate(a.effective_date);
  const bEff = parseEffDate(b.effective_date);
  if (aEff && bEff && aEff.getTime() !== bEff.getTime()) {
    return aEff.getTime() <= bEff.getTime() ? a : b;
  }
  if (aEff && !bEff) return a;
  if (bEff && !aEff) return b;

  const aId = a.id != null ? Number(a.id) : Infinity;
  const bId = b.id != null ? Number(b.id) : Infinity;
  return aId <= bId ? a : b;
}

function dedupeBobClients(bobClients) {
  const byKey = new Map();
  let collapsed = 0;
  for (const client of bobClients || []) {
    const key = clientCarrierKey(client.client_full_name, client.carrier);
    if (!key) {
      byKey.set(`raw:${client.id || Math.random()}`, client);
      continue;
    }
    if (!byKey.has(key)) {
      byKey.set(key, client);
      continue;
    }
    collapsed += 1;
    byKey.set(key, preferBobClient(byKey.get(key), client));
  }
  return { clients: [...byKey.values()], collapsedDuplicates: collapsed };
}

/**
 * Build last-paid lookup from commission history rows.
 * @returns {Map<string, { period: string, amount: number }>}
 */
function buildLastPaidLookup(historyRows) {
  const byKey = new Map(); // key → Map(period → amount)
  for (const r of historyRows || []) {
    if (!countsAsRenewalPaid(r.classification)) continue;
    const amount = parseFloat(r.commission);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const period = normPeriod(r.payment_period);
    const key = clientCarrierKey(r.client_full_name, r.carrier);
    if (!period || !key) continue;
    if (!byKey.has(key)) byKey.set(key, new Map());
    const periods = byKey.get(key);
    periods.set(period, (periods.get(period) || 0) + amount);
  }

  const out = new Map();
  for (const [key, periods] of byKey.entries()) {
    let bestPeriod = null;
    let bestAmount = 0;
    for (const [period, amount] of periods.entries()) {
      if (!bestPeriod || period > bestPeriod) {
        bestPeriod = period;
        bestAmount = amount;
      }
    }
    if (bestPeriod) out.set(key, { period: bestPeriod, amount: bestAmount });
  }
  return out;
}

/**
 * @param {object} opts
 * @param {Array} opts.bobClients - active BOB rows (already scoped)
 * @param {Array} opts.periodRecords - commission_records for target period
 * @param {string} opts.period - YYYYMM (or displayable period)
 * @param {Set<string>} opts.heldKeySet - `${clientNameKey}|${normCarrier}` for licensing holds
 * @param {object} opts.policyStatusMap - key `${clientNameKey}|${normCarrier}|${agentKey}` → status row
 * @param {Map|object} [opts.lastPaidByKey] - live history enrichment `${clientNameKey}|${normCarrier}` → {period,amount}
 * @param {boolean} [opts.dedupeBob=true] - collapse duplicate BOB identities
 */
function buildMissingRenewalRows({
  bobClients,
  periodRecords,
  period,
  heldKeySet = new Set(),
  policyStatusMap = {},
  lastPaidByKey = null,
  dedupeBob = true,
}) {
  const targetNorm = normPeriod(period);
  const checkDate = periodToDate(period);

  const deduped = dedupeBob
    ? dedupeBobClients(bobClients)
    : { clients: bobClients || [], collapsedDuplicates: 0 };
  const clients = deduped.clients;

  const lastPaidMap =
    lastPaidByKey instanceof Map
      ? lastPaidByKey
      : lastPaidByKey
        ? new Map(Object.entries(lastPaidByKey))
        : null;

  const recMap = new Map(); // exact variant key → records
  const recByNameKey = new Map(); // clientNameKey|carrier → records (All Data style)
  for (const r of periodRecords) {
    const ck = normCarrier(r.carrier);
    for (const v of nameVariants(r.client_full_name)) {
      const key = `${v}|${ck}`;
      if (!recMap.has(key)) recMap.set(key, []);
      recMap.get(key).push(r);
    }
    const nk = clientCarrierKey(r.client_full_name, r.carrier);
    if (!nk) continue;
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

  for (const client of clients) {
    const nc = normCarrier(client.carrier);
    const identityKey = clientCarrierKey(client.client_full_name, client.carrier);
    const effDate = parseEffDate(client.effective_date);
    if (effDate && checkDate) {
      const monthsDiff =
        (checkDate.getFullYear() - effDate.getFullYear()) * 12 +
        (checkDate.getMonth() - effDate.getMonth());
      // Renewals only — skip first-year members
      if (monthsDiff < 12) continue;
    }

    let matchedRecs = [];
    if (identityKey && recByNameKey.has(identityKey)) {
      matchedRecs = recByNameKey.get(identityKey);
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

    const paidRecs = matchedRecs.filter((r) => countsAsRenewalPaid(r.classification));
    const heldRecs = matchedRecs.filter((r) => isHeldClassification(r.classification));
    const commission = paidRecs.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);

    // Paid only when this statement month has a renewal-class payment.
    // Do NOT clear historical gaps because BOB last_paid is a later month.
    const hasPaidThisPeriod = paidRecs.length > 0;
    const isMissing = !hasPaidThisPeriod;

    const heldKey = heldIdentityKey(client.client_full_name, client.carrier);
    const isHeld =
      isMissing &&
      ((heldKey && heldKeySet.has(heldKey)) || (heldRecs.length > 0 && paidRecs.length === 0));

    const psKey = policyStatusKey(client.client_full_name, client.carrier, client.agent_name);
    let psData = (psKey && policyStatusMap[psKey]) || null;
    if (!psData && identityKey) {
      // Agent-format mismatch fallback: any status for this client|carrier
      const prefix = `${identityKey}|`;
      for (const [k, v] of Object.entries(policyStatusMap)) {
        if (k.startsWith(prefix)) {
          psData = v;
          break;
        }
      }
    }

    // Prefer live commission history over stale BOB last_commission_* fields
    const live = identityKey && lastPaidMap ? lastPaidMap.get(identityKey) : null;
    const bobPeriod = normPeriod(client.last_commission_date);
    const bobAmount = parseFloat(client.last_commission_amount) || 0;
    let lastPaidPeriod = bobPeriod;
    let lastKnownCommission = bobAmount;
    if (live) {
      if (!lastPaidPeriod || live.period > lastPaidPeriod) {
        lastPaidPeriod = live.period;
        lastKnownCommission = live.amount;
      } else if (live.period === lastPaidPeriod && live.amount > lastKnownCommission) {
        lastKnownCommission = live.amount;
      } else if (!lastKnownCommission && live.amount) {
        lastKnownCommission = live.amount;
      }
    }

    const monthsMissing = lastPaidPeriod
      ? monthsBetweenPeriods(lastPaidPeriod, targetNorm)
      : 0;

    built.push({
      client: client.client_full_name,
      agent: client.agent_name || '—',
      carrier: client.carrier,
      effectiveDate: client.effective_date,
      lastPaidPeriod: lastPaidPeriod || null,
      commission,
      lastKnownCommission,
      isMissing,
      isHeld: !!isHeld,
      monthsMissing,
      bobId: client.id,
      lob: paidRecs[0]?.lob || heldRecs[0]?.lob || '',
      policyStatus: psData?.status || null,
      termedDate: psData?.termed_date || null,
      policyNotes: psData?.notes || null,
      matchCount: matchedRecs.length,
      identityKey,
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
    checkedClients: clients.length,
    collapsedDuplicates: deduped.collapsedDuplicates,
    periodRecordCount: periodRecords.length,
    rows: built,
    summary: {
      total: built.length,
      missing: built.filter((r) => r.isMissing && !r.isHeld).length,
      held: built.filter((r) => r.isHeld).length,
      paid: built.filter((r) => !r.isMissing).length,
      // One-period estimate from last-known commission (BOB and/or live history)
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
  clientNameKey,
  clientCarrierKey,
  heldIdentityKey,
  policyStatusKey,
  countsAsRenewalPaid,
  isHeldClassification,
  buildLastPaidLookup,
  dedupeBobClients,
  preferBobClient,
  buildMissingRenewalRows,
  buildMissingRenewalsPeriodOptions,
  isTheiPrincipalAgent,
  monthsBetweenPeriods,
  formatPeriodLabel,
  MIN_STATEMENT_MONTH_RECORDS,
};

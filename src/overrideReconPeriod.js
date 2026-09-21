'use strict';

/**
 * Period gating for Agency Override Recon.
 *
 * Commission payment_period is YYYYMM. Agency production upload_batch is
 * typically YYYY-MM (upload calendar month). Effective dates are YYYY-MM-DD.
 * Matching stays the same JS engine (netting / lifecycle / Held); this module
 * only bounds the SQL corpuses and drops 90-day leftovers that have no
 * activity in the selected payment period (avoids false Missing).
 */

const YYYYMM = /^\d{6}$/;
const YYYY_MM = /^\d{4}-\d{2}$/;

function normalizeReconPeriod(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (YYYYMM.test(s)) {
    const month = parseInt(s.slice(4, 6), 10);
    if (month >= 1 && month <= 12) return s;
    return '';
  }
  if (YYYY_MM.test(s)) return normalizeReconPeriod(s.replace('-', ''));
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return normalizeReconPeriod(s.slice(0, 7));
  return '';
}

function periodBatchVariants(period) {
  const p = normalizeReconPeriod(period);
  if (!p) return [];
  return [p, `${p.slice(0, 4)}-${p.slice(4, 6)}`];
}

function periodDateBounds(period) {
  const p = normalizeReconPeriod(period);
  if (!p) return null;
  const year = parseInt(p.slice(0, 4), 10);
  const month = parseInt(p.slice(4, 6), 10);
  const start = `${p.slice(0, 4)}-${p.slice(4, 6)}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endExclusive = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
  return { start, endExclusive };
}

function formatReconPeriodLabel(period) {
  const p = normalizeReconPeriod(period);
  if (!p) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(p.slice(4, 6), 10) - 1]} ${p.slice(0, 4)}`;
}

function collectReconPeriods(rows) {
  const set = new Set();
  for (const row of rows || []) {
    const n = normalizeReconPeriod(row.period || row.payment_period || row.upload_batch);
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}

function isSelectedPeriodSale(prod, period) {
  const p = normalizeReconPeriod(period);
  if (!p || !prod) return false;
  const eff = normalizeReconPeriod(prod.effective_date);
  if (eff) return eff === p;
  const batch = String(prod.upload_batch || '').trim();
  return periodBatchVariants(p).includes(batch);
}

/**
 * After period-scoped matching, keep:
 *  - any row with this period's override / BSI / held activity
 *  - paid / chargeback lifecycle rows (this period's remittance)
 *  - Missing only when the sale itself belongs to the selected period
 *
 * Drops rolling-90-day production leftovers that were paid in an earlier
 * month and have no remittance activity this period (they would otherwise
 * look like new Missing).
 */
function keepPeriodScopedMatch(row, period) {
  const p = normalizeReconPeriod(period);
  if (!p) return true;
  if (row?.override) return true;
  if (row?.carrierBSI) return true;
  if (row?.heldRecord) return true;
  if (row?.lifecycle === 'paid' || row?.lifecycle === 'chargeback') return true;
  return isSelectedPeriodSale(row?.production, p);
}

function stampProductionForPeriod(production, period) {
  const p = normalizeReconPeriod(period);
  if (!p) return production || [];
  return (production || []).map((row) => ({ ...row, payment_period: p }));
}

function appendPaymentPeriodSql(conds, params, period, column = 'cr.payment_period') {
  const variants = periodBatchVariants(period);
  if (!variants.length) {
    throw new Error('A YYYYMM payment period is required');
  }
  params.push(variants);
  conds.push(`${column} = ANY($${params.length})`);
}

function appendProductionPeriodSql(conds, params, period, alias = 'ap') {
  const variants = periodBatchVariants(period);
  const bounds = periodDateBounds(period);
  if (!variants.length || !bounds) {
    throw new Error('A YYYYMM payment period is required');
  }
  params.push(variants);
  const batchIdx = params.length;
  params.push(bounds.start);
  const startIdx = params.length;
  params.push(bounds.endExclusive);
  const endIdx = params.length;
  conds.push(`(
    ${alias}.upload_batch = ANY($${batchIdx})
    OR (${alias}.effective_date >= $${startIdx}::date AND ${alias}.effective_date < $${endIdx}::date)
  )`);
}

const CORPUS_TTL_MS = 45 * 1000;
const corpusCache = new Map();

function corpusCacheKey({ period, batch, carrier, agent }) {
  return [normalizeReconPeriod(period), batch || '', carrier || '', agent || ''].join('|');
}

function getCachedCorpus(key) {
  const hit = corpusCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    corpusCache.delete(key);
    return null;
  }
  return hit;
}

function setCachedCorpus(key, value) {
  corpusCache.set(key, { ...value, expires: Date.now() + CORPUS_TTL_MS });
}

function clearOverrideReconCorpusCache() {
  corpusCache.clear();
}

module.exports = {
  normalizeReconPeriod,
  periodBatchVariants,
  periodDateBounds,
  formatReconPeriodLabel,
  collectReconPeriods,
  isSelectedPeriodSale,
  keepPeriodScopedMatch,
  stampProductionForPeriod,
  appendPaymentPeriodSql,
  appendProductionPeriodSql,
  corpusCacheKey,
  getCachedCorpus,
  setCachedCorpus,
  clearOverrideReconCorpusCache,
  CORPUS_TTL_MS,
};

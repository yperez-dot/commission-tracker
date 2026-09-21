'use strict';

/**
 * Server-side Agency Override Recon assembly.
 * Same match semantics as AgencyProductionRecon (buildOverrideMatches),
 * then filter / sort / page so the browser only receives one slim slice.
 */

const {
  buildOverrideMatches,
  getThreeWayOverrideStatus,
  getOverrideReconCategory,
  getHoldDetail,
} = require('./agencyOverrideReconMatch.cjs');
const { normalizeCarrier } = require('./matchingNormalize.cjs');
const { expectedAgencyOverride, expectedOverrideLabel } = require('./utils/agencyOverrideExpected');

const CATEGORIES = ['missing', 'planchange', 'plandenied', 'cancelled', 'paid'];
const MAX_PAGE = 500;
const MAX_EXPORT = 20000;

function safeExpected(production) {
  try {
    const meta = expectedAgencyOverride(production || {});
    return {
      amount: meta.amount,
      note: meta.note || '',
      label: expectedOverrideLabel(meta) || meta.note || '',
      kind: meta.kind || 'unknown',
    };
  } catch {
    return { amount: null, note: 'Rate lookup failed', label: 'Rate lookup failed', kind: 'unknown' };
  }
}

function slimCommission(rec) {
  if (!rec) return null;
  return {
    id: rec.id,
    client_full_name: rec.client_full_name,
    agent_name: rec.agent_name,
    carrier: rec.carrier,
    plan_type: rec.plan_type,
    classification: rec.classification,
    commission: rec.commission,
    commission_amount: rec.commission_amount,
    payment_period: rec.payment_period,
    policy_number: rec.policy_number,
    payee: rec.payee,
    source: rec.source,
    override_net: rec.override_net,
    matchCount: rec.matchCount,
    hasChargeback: rec.hasChargeback,
    hold_reason: rec.hold_reason,
    member_state: rec.member_state,
    member_county: rec.member_county,
    upload_name: rec.upload_name,
  };
}

function isoDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function slimProduction(p) {
  if (!p) return null;
  return {
    id: p.id,
    agent_name: p.agent_name,
    client_name: p.client_name,
    carrier: p.carrier,
    plan_name: p.plan_name,
    policy_number: p.policy_number,
    effective_date: isoDate(p.effective_date) || p.effective_date,
    status: p.status,
    policy_type: p.policy_type,
    enrollment_type: p.enrollment_type,
    state: p.state,
    county: p.county,
    upload_batch: p.upload_batch,
    upload_filename: p.upload_filename,
    upload_date: p.upload_date,
    uploaded_by_user: p.uploaded_by_user,
    manual_override_status: p.manual_override_status,
    manual_override_by: p.manual_override_by,
    manual_override_at: p.manual_override_at,
  };
}

function slimRow(m) {
  const hold = getHoldDetail(m);
  return {
    rowKey: m.rowKey,
    lifecycle: m.lifecycle,
    category: m.category,
    status: m.status,
    isHistory: !!m.isHistory,
    carrierUploaded: !!m.carrierUploaded,
    production: slimProduction(m.production),
    override: slimCommission(m.override),
    carrierBSI: slimCommission(m.carrierBSI),
    heldRecord: slimCommission(m.heldRecord),
    expected: m.expected || safeExpected(m.production),
    hold,
  };
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function applyUserFilters(rows, filters) {
  const agents = parseList(filters.agents);
  const carriers = parseList(filters.carriers).map((c) => normalizeCarrier(c)).filter(Boolean);
  const dates = parseList(filters.effective_dates || filters.effectiveDates);
  const statuses = parseList(filters.override_status || filters.overrideStatus);
  const search = String(filters.search || '').trim().toLowerCase();

  return rows.filter((m) => {
    const prod = m.production || {};
    if (agents.length && !agents.includes(prod.agent_name)) return false;
    if (carriers.length && !carriers.includes(normalizeCarrier(prod.carrier))) return false;
    if (dates.length && !dates.includes(isoDate(prod.effective_date) || String(prod.effective_date || ''))) return false;
    if (statuses.length && !statuses.includes(m.status)) return false;
    if (search) {
      const hay = `${prod.client_name || ''} ${prod.agent_name || ''} ${prod.carrier || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function sortRows(rows, sortCol, sortDir) {
  if (!sortCol) return rows;
  const dir = String(sortDir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    let va;
    let vb;
    if (sortCol === 'agent') {
      va = a.production?.agent_name || '';
      vb = b.production?.agent_name || '';
    } else if (sortCol === 'member') {
      va = a.production?.client_name || '';
      vb = b.production?.client_name || '';
    } else if (sortCol === 'carrier') {
      va = a.production?.carrier || '';
      vb = b.production?.carrier || '';
    } else if (sortCol === 'bsi_thei') {
      va = parseFloat(a.override?.commission || 0);
      vb = parseFloat(b.override?.commission || 0);
    } else if (sortCol === 'c_bsi') {
      va = parseFloat(a.carrierBSI?.commission || 0);
      vb = parseFloat(b.carrierBSI?.commission || 0);
    } else if (sortCol === 'eff_date') {
      va = a.production?.effective_date || '';
      vb = b.production?.effective_date || '';
    } else if (sortCol === 'expected') {
      va = a.expected?.amount;
      vb = b.expected?.amount;
      va = va == null ? -1 : va;
      vb = vb == null ? -1 : vb;
    } else if (sortCol === 'status') {
      va = a.status || '';
      vb = b.status || '';
    } else {
      va = '';
      vb = '';
    }
    if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb);
    return dir * String(va).localeCompare(String(vb));
  });
}

function emptyCounts() {
  return { missing: 0, planchange: 0, plandenied: 0, cancelled: 0, paid: 0 };
}

function countCategories(rows) {
  const counts = emptyCounts();
  for (const m of rows) {
    const cat = CATEGORIES.includes(m.category) ? m.category : 'missing';
    counts[cat] += 1;
  }
  return counts;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

/**
 * Build paginated Override Recon payload from already-loaded slim corpuses.
 */
function normalizeProductionRow(p) {
  if (!p) return p;
  return {
    ...p,
    effective_date: isoDate(p.effective_date) || p.effective_date,
    upload_date: p.upload_date instanceof Date ? p.upload_date.toISOString() : p.upload_date,
    uploaded_at: p.uploaded_at instanceof Date ? p.uploaded_at.toISOString() : p.uploaded_at,
  };
}

function assembleOverrideRecon(production, overrides, carrierBSIRecords, bsiUploadedKeys, filters = {}) {
  const normalizedProduction = (production || []).map(normalizeProductionRow);
  const matches = buildOverrideMatches(normalizedProduction, overrides, carrierBSIRecords, bsiUploadedKeys);
  const decorated = matches.map((m) => ({
    ...m,
    category: getOverrideReconCategory(m),
    status: getThreeWayOverrideStatus(m),
    expected: safeExpected(m.production),
  }));

  const filtered = applyUserFilters(decorated, filters);
  const counts = countCategories(filtered);

  const category = String(filters.category || filters.tab || 'missing').toLowerCase();
  const listed = category && category !== 'all'
    ? filtered.filter((m) => m.category === category)
    : filtered;

  const sorted = sortRows(listed, filters.sortCol, filters.sortDir);
  const isExport = filters.export === '1' || filters.export === 1 || filters.export === true;
  const limit = isExport
    ? Math.min(MAX_EXPORT, parseInt(filters.limit, 10) || MAX_EXPORT)
    : Math.min(MAX_PAGE, Math.max(1, parseInt(filters.limit, 10) || 100));
  const offset = Math.max(0, parseInt(filters.offset, 10) || 0);
  const page = sorted.slice(offset, offset + limit);

  const uniqueProduction = normalizedProduction;
  return {
    rows: page.map(slimRow),
    total: sorted.length,
    counts,
    limit,
    offset,
    meta: {
      agents: uniqueSorted(uniqueProduction.map((p) => p.agent_name)),
      carriers: uniqueSorted(uniqueProduction.map((p) => p.carrier)),
      effectiveDates: uniqueSorted(uniqueProduction.map((p) => isoDate(p.effective_date) || p.effective_date)).sort((a, b) =>
        String(b).localeCompare(String(a))
      ),
      batches: uniqueSorted(uniqueProduction.map((p) => p.upload_batch)).sort((a, b) =>
        String(b).localeCompare(String(a))
      ),
    },
    scanned: {
      production: normalizedProduction.length,
      overrides: (overrides || []).length,
      carrierBSI: (carrierBSIRecords || []).length,
    },
  };
}

module.exports = {
  assembleOverrideRecon,
  applyUserFilters,
  slimRow,
  slimProduction,
  slimCommission,
  parseList,
  CATEGORIES,
  MAX_PAGE,
  MAX_EXPORT,
};

'use strict';

const { parseList, slimRow, MAX_PAGE, MAX_EXPORT } = require('./overrideReconAssemble');

// This endpoint is a Held work queue, not an all-time reconciliation corpus.
// Only BSI Held rows with the existing licensing reasons enter the CTE.
async function loadHeldLicensingRecon(pool, filters = {}) {
  const params = [];
  const conditions = [];
  function bind(value) { params.push(value); return `$${params.length}`; }
  const agents = parseList(filters.agents || filters.agent);
  const carriers = parseList(filters.carriers || filters.carrier);
  const dates = parseList(filters.effective_dates);
  if (agents.length) conditions.push(`agent_name = ANY(${bind(agents)}::text[])`);
  if (carriers.length) conditions.push(`LOWER(TRIM(carrier)) = ANY(${bind(carriers.map((c) => c.toLowerCase().trim()))}::text[])`);
  if (dates.length) conditions.push(`effective_date::text = ANY(${bind(dates)}::text[])`);
  if (filters.search && String(filters.search).trim()) {
    const p = bind(`%${String(filters.search).trim()}%`);
    conditions.push(`(client_full_name ILIKE ${p} OR agent_name ILIKE ${p} OR carrier ILIKE ${p})`);
  }
  const statuses = parseList(filters.override_status);
  if (statuses.length && !statuses.includes('held_licensing')) conditions.push('FALSE');
  const category = String(filters.category || 'missing').toLowerCase();
  const visibleCategory = ['missing', 'all'].includes(category);
  const exporting = String(filters.export) === '1';
  const cap = exporting ? MAX_EXPORT : MAX_PAGE;
  const limit = Math.min(cap, Math.max(1, parseInt(filters.limit, 10) || (exporting ? MAX_EXPORT : 100)));
  const offset = Math.max(0, parseInt(filters.offset, 10) || 0);
  const sortColumns = { agent: 'agent_name', member: 'client_full_name', carrier: 'carrier',
    eff_date: 'effective_date', state: 'member_state', c_bsi: 'commission' };
  const sort = sortColumns[filters.sortCol] || 'payment_period';
  const direction = String(filters.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const sql = `WITH held AS MATERIALIZED (
    SELECT cr.id, cr.client_full_name, cr.carrier, cr.commission, cr.classification,
           cr.payment_period, cr.policy_number, cr.agent_name AS held_agent_name,
           cr.plan_type, NULLIF(TRIM(cr.raw_data::text), '')::jsonb->>'Hold Reason' AS hold_reason,
           NULLIF(TRIM(NULLIF(TRIM(cr.raw_data::text), '')::jsonb->>'Member State'), '') AS member_state,
           NULLIF(TRIM(cr.raw_data::text), '')::jsonb->>'Member County' AS member_county
      FROM commission_records cr JOIN uploads u ON u.id = cr.upload_id
     WHERE u.category = 'bsi_statement' AND cr.classification = 'Held'
       AND (NULLIF(TRIM(cr.raw_data::text), '')::jsonb->>'Hold Reason' ILIKE '%not licensed%'
         OR NULLIF(TRIM(cr.raw_data::text), '')::jsonb->>'Hold Reason' ILIKE '%not appointed%')
  ), candidates AS (
    SELECT h.*, ap.id AS production_id, COALESCE(ap.agent_name, h.held_agent_name) AS agent_name,
           ap.effective_date, ap.state AS production_state, ap.status AS production_status,
           ap.upload_batch, ap.plan_name, ap.policy_type, ap.enrollment_type
      FROM held h
      LEFT JOIN LATERAL (
        SELECT p.id, p.agent_name, p.effective_date, p.state, p.status, p.upload_batch,
               p.plan_name, p.policy_type, p.enrollment_type FROM agency_production p
         WHERE LOWER(TRIM(p.carrier)) = LOWER(TRIM(h.carrier))
           AND ((NULLIF(TRIM(h.policy_number), '') IS NOT NULL AND p.policy_number = h.policy_number)
             OR (NULLIF(TRIM(h.policy_number), '') IS NULL
               AND LOWER(TRIM(p.client_name)) = LOWER(TRIM(h.client_full_name))))
         ORDER BY p.uploaded_at DESC NULLS LAST, p.id DESC LIMIT 1
      ) ap ON true
  ), filtered AS (
    SELECT * FROM candidates ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
  ), page AS (
    SELECT * FROM filtered ${visibleCategory ? '' : 'WHERE FALSE'}
     ORDER BY ${sort} ${direction} NULLS LAST, id DESC
     LIMIT ${bind(limit)} OFFSET ${bind(offset)}
  )
  SELECT COALESCE((SELECT jsonb_agg(p ORDER BY p.${sort} ${direction} NULLS LAST, p.id DESC) FROM page p), '[]'::jsonb) AS rows,
         (SELECT COUNT(*) FROM filtered) AS held_total,
         (SELECT COUNT(*) FROM held) AS held_scanned,
         (SELECT jsonb_build_object(
           'agents', COALESCE(jsonb_agg(DISTINCT agent_name) FILTER (WHERE agent_name IS NOT NULL), '[]'::jsonb),
           'carriers', COALESCE(jsonb_agg(DISTINCT carrier) FILTER (WHERE carrier IS NOT NULL), '[]'::jsonb),
           'effectiveDates', COALESCE(jsonb_agg(DISTINCT effective_date) FILTER (WHERE effective_date IS NOT NULL), '[]'::jsonb),
           'batches', COALESCE(jsonb_agg(DISTINCT upload_batch) FILTER (WHERE upload_batch IS NOT NULL), '[]'::jsonb)
         ) FROM candidates) AS meta`;
  const { rows: result } = await pool.query(sql, params);
  const data = result[0] || {};
  const rows = (data.rows || []).map((h) => slimRow({
    rowKey: `held-${h.id}`, lifecycle: 'missing', category: 'missing', status: 'held_licensing',
    carrierUploaded: true, carrierBSI: h, heldRecord: h,
    production: { id: h.production_id || null, client_name: h.client_full_name,
      agent_name: h.agent_name, carrier: h.carrier, policy_number: h.policy_number,
      effective_date: h.effective_date, state: h.production_state, status: h.production_status,
      upload_batch: h.upload_batch, plan_name: h.plan_name, policy_type: h.policy_type,
      enrollment_type: h.enrollment_type },
  }));
  const meta = data.meta || { agents: [], carriers: [], effectiveDates: [], batches: [] };
  for (const key of ['agents', 'carriers']) meta[key].sort();
  for (const key of ['effectiveDates', 'batches']) meta[key].sort().reverse();
  return { rows, total: visibleCategory ? Number(data.held_total || 0) : 0,
    counts: { missing: Number(data.held_total || 0), planchange: 0, plandenied: 0, cancelled: 0, paid: 0 },
    limit, offset, meta, scanned: { production: rows.filter((r) => r.production.id).length,
      overrides: 0, carrierBSI: Number(data.held_scanned || 0) }, period: 'all', needsPeriod: false };
}

module.exports = { loadHeldLicensingRecon };

const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { normalizeAllRecords, normalizeAgentName } = require('./normalize');
const { normalizeCarrierKey } = require('../src/matchingNormalize.cjs');
const { clientNameKey, clientNameKeySql } = require('../src/clientNameKey');
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ─── GET / — list records with filters ───────────────────────────────────────
// Resolve effective agency — JWT agency OR X-Agency-Override header (admin only)
function getAgency(req) {
  if (req.user.role !== 'admin') return null;
  const override = req.headers['x-agency-override'];
  const agency = override !== undefined ? (override || null) : (req.user.agency || null);
  return agency;
}

// Returns SQL filter clause for agency isolation — based on carrier
// BSI carriers: Mutual of Omaha, United of Omaha
// THEI carriers: everything else
function agencyFilter(req, alias) {
  const agency = getAgency(req);
  const col = alias ? alias + '.carrier' : 'carrier';
  if (!agency) return null;
  if (agency.toLowerCase().includes('broker society')) {
    return col + " IN ('Mutual of Omaha', 'United of Omaha', 'Fidelity Life', 'Instabrain', 'F&G', 'Fidelity & Guaranty', 'American Amicable', 'Transamerica', 'Ethos', 'American Home Life', 'National Life Group')";
  }
  // Health Experts: exclude all BSI carriers
  return col + " NOT IN ('Mutual of Omaha', 'United of Omaha', 'Fidelity Life', 'Instabrain', 'F&G', 'Fidelity & Guaranty', 'American Amicable', 'Transamerica', 'Ethos', 'American Home Life', 'National Life Group')";
}

/** Agency dashboard: drop NHP commission-column ACA rows (agent pass-through). Keep override column. */
const AGENCY_ACA_AGENT_EXCLUDE = `NOT (lob = 'ACA' AND COALESCE(producer_payable, 0) <> 0 AND COALESCE(thei_share, 0) = 0)`;

// Smart Matching v2 helpers — deterministic keys only, no fuzzy/Levenshtein.

// normalizeNameKey: accent-strip + uppercase + token-sort.
// Handles "Perez, Maria" ↔ "Maria Perez", "José" ↔ "Jose",
// "Tate, Joseph M." ↔ "Joseph Tate" (middle initials stripped), etc.
// Single-char tokens are dropped before sort — same class of fix as normReconClient
// comma-path stripping in agencyproduction.js (Commit 9199248).
// Known edge case: solo-initial first names ("A Smith") collapse to just the surname;
// acceptable risk — not present in Medicare commission statement data.
function normalizeNameKey(name) {
  return clientNameKey(name);
}

// normalizeAgentKey: alias resolution (from normalize.js) then token-sort.
// Handles "ROBLES, KATY" ↔ "Katy Robles", middle-name variants, etc.
function normalizeAgentKey(name) {
  if (!name) return '';
  return normalizeNameKey(normalizeAgentName(name));
}

// normalizeCarrierKey imported from src/matchingNormalize (Omaha carve-out)

/** Shared WHERE builder for /records list filters (payment + by-client). */
function buildRecordListFilters(req) {
  const {
    agent, agents, carrier, carriers, period, periods, classification, classifications,
    classificationLike,
    lob, lobs, planType, payee, search, upload_id, upload_category, exclude_upload_category,
    amountSign,
  } = req.query;
  const where = [];
  const params = [];
  let idx = 1;

  if (req.user.role === 'agent') {
    where.push(`cr.agent_name ILIKE $${idx++}`);
    params.push(`%${req.user.name}%`);
  } else if (req.user.role === 'admin') {
    const af = agencyFilter(req, 'cr');
    if (af) where.push(af);
  }
  if (agents) {
    const list = agents.split(',').map((a) => a.trim()).filter(Boolean);
    if (list.length) { where.push(`cr.agent_name = ANY($${idx++})`); params.push(list); }
  } else if (agent) {
    where.push(`cr.agent_name = $${idx++}`);
    params.push(agent);
  }
  if (carriers) {
    const list = carriers.split(',').map((c) => c.trim()).filter(Boolean);
    if (list.length) { where.push(`cr.carrier = ANY($${idx++})`); params.push(list); }
  } else if (carrier) {
    where.push(`cr.carrier = $${idx++}`);
    params.push(carrier);
  }
  if (periods) {
    const list = periods.split(',').map((p) => p.trim()).filter(Boolean);
    if (list.length) { where.push(`cr.payment_period = ANY($${idx++})`); params.push(list); }
  } else if (period) {
    where.push(`cr.payment_period = $${idx++}`);
    params.push(period);
  }
  if (classifications) {
    const list = classifications.split(',').map((c) => c.trim()).filter(Boolean);
    if (list.length) { where.push(`cr.classification = ANY($${idx++})`); params.push(list); }
  } else if (classification) {
    where.push(`cr.classification = $${idx++}`);
    params.push(classification);
  }
  if (lobs) {
    const list = lobs.split(',').map((l) => l.trim()).filter(Boolean);
    if (list.length) { where.push(`cr.lob = ANY($${idx++})`); params.push(list); }
  } else if (lob) {
    where.push(`cr.lob = $${idx++}`);
    params.push(lob);
  }
  if (planType) { where.push(`COALESCE(cr.plan_type,'') = $${idx++}`); params.push(planType); }
  if (upload_id) { where.push(`cr.upload_id = $${idx++}`); params.push(parseInt(upload_id, 10)); }
  if (upload_category) { where.push(`u.category = $${idx++}`); params.push(upload_category); }
  if (exclude_upload_category) {
    where.push(`(u.category IS NULL OR u.category != $${idx++})`);
    params.push(exclude_upload_category);
  }
  if (classificationLike) {
    // Comma-separated substrings, matched case-insensitively (e.g. "override,chargeback").
    // Lets a caller narrow to a small family of classifications server-side instead of
    // downloading every row and filtering in JS.
    const terms = classificationLike.split(',').map((t) => t.trim()).filter(Boolean);
    if (terms.length) {
      const clauses = terms.map((t) => {
        params.push(`%${t}%`);
        return `cr.classification ILIKE $${idx++}`;
      });
      where.push(`(${clauses.join(' OR ')})`);
    }
  }
  if (payee) { where.push(`cr.payee = $${idx++}`); params.push(payee); }
  if (amountSign === 'negative') where.push('cr.commission < 0');
  else if (amountSign === 'positive') where.push('cr.commission >= 0');
  if (search) {
    // Plain substring match (partial, order-sensitive) OR'd with a full-name,
    // order/format-independent match on client_full_name via the same
    // normalized key /records/by-client and /client-history already use
    // (clientNameKey/clientNameKeySql above) — so a name typed "Maria Perez"
    // still matches a record stored "Perez, Maria". Only added when the term
    // has real name tokens (skipped for a 1-2 char partial, where the key
    // would be too loose to compare).
    const clauses = [
      `cr.client_full_name ILIKE $${idx}`,
      `cr.agent_name ILIKE $${idx}`,
      `cr.carrier ILIKE $${idx}`,
    ];
    params.push(`%${search}%`);
    idx += 1;
    const searchKey = clientNameKey(search);
    if (searchKey) {
      clauses.push(`${clientNameKeySql('cr', 'client_full_name')} = $${idx}`);
      params.push(searchKey);
      idx += 1;
    }
    where.push(`(${clauses.join(' OR ')})`);
  }

  const needsUploadJoin = Boolean(upload_category || exclude_upload_category);
  return { where, params, idx, needsUploadJoin };
}

const IS_TERMED_SQL = `CASE WHEN
  EXISTS (
    SELECT 1 FROM policy_status ps
    WHERE LOWER(TRIM(cr.client_full_name)) = LOWER(TRIM(ps.client_full_name))
      AND LOWER(TRIM(cr.carrier)) = LOWER(TRIM(ps.carrier))
      AND LOWER(TRIM(cr.agent_name)) = LOWER(TRIM(ps.agent_name))
      AND ps.status = 'termed'
  ) OR EXISTS (
    SELECT 1 FROM book_of_business bob
    WHERE LOWER(TRIM(cr.client_full_name)) = LOWER(TRIM(bob.client_full_name))
      AND LOWER(TRIM(cr.carrier)) = LOWER(TRIM(bob.carrier))
      AND LOWER(TRIM(cr.agent_name)) = LOWER(TRIM(bob.agent_name))
      AND bob.status = 'termed'
  )
THEN true ELSE false END`;

router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { sortCol, sortDir = 'asc', limit = 100, offset = 0, light } = req.query;
    // light=1: skip the per-row termed-policy EXISTS check and the full-set SUM query,
    // and only run the full-set COUNT on the first page. Callers that only need the raw
    // rows (e.g. Agency Override Recon, which recomputes its own status client-side)
    // opt in with light=1 — default behavior (is_termed + sums + count every page) is
    // unchanged for callers like AllData / Reconciliation that rely on them.
    const isLight = light === '1' || light === 'true';
    const { where, params, idx: startIdx, needsUploadJoin } = buildRecordListFilters(req);
    let idx = startIdx;
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Build ORDER BY clause - validate sortCol to prevent SQL injection
    const validCols = {
      'agent_name': 'cr.agent_name',
      'carrier': 'cr.carrier',
      'client_full_name': 'cr.client_full_name',
      'effective_date': 'cr.effective_date',
      'premium': 'cr.premium',
      'commission': 'cr.commission',
      'classification': 'cr.classification',
      'payment_period': 'cr.payment_period',
      'policy_number': 'cr.policy_number',
      'lob': 'cr.lob',
      'gross_commission': 'cr.gross_commission',
      'thei_share': 'cr.thei_share',
      'bsi_share': 'cr.bsi_share',
      'producer_payable': 'cr.producer_payable',
      'sub_agent_override': 'cr.sub_agent_override',
      'created_at': 'cr.created_at'
    };
    const orderCol = sortCol && validCols[sortCol] ? validCols[sortCol] : 'cr.created_at';
    const orderDir = sortDir.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const orderBy = `ORDER BY ${orderCol} ${orderDir}`;

    const records = await pool.query(
      `SELECT cr.id, cr.agent_name, cr.carrier,
        COALESCE(cr.plan_type, '') as plan_type,
        cr.client_full_name, cr.effective_date, cr.premium, cr.commission,
        cr.classification, cr.payment_period, cr.policy_number, cr.created_at,
        cr.upload_id, cr.payee, cr.source, COALESCE(cr.mga, '') as mga,
        cr.raw_data, u.original_name as upload_name, u.category as upload_category,
        u.uploaded_at as upload_uploaded_at,
        cr.lob, cr.gross_commission, cr.thei_share, cr.bsi_share,
        cr.producer_payable, cr.sub_agent_override,
        cr.members, cr.statement_month,
        ${isLight ? 'false' : IS_TERMED_SQL} as is_termed
       FROM commission_records cr 
       LEFT JOIN uploads u ON cr.upload_id = u.id
       ${wc} ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit, 10), parseInt(offset, 10)]
    );

    const uploadJoin = needsUploadJoin ? ' LEFT JOIN uploads u ON cr.upload_id = u.id' : '';
    const offsetNum = parseInt(offset, 10) || 0;

    // Full-set COUNT is only needed once — fetchAllPages terminates on a short page
    // regardless, so a light caller skips recomputing it on every subsequent page.
    let total = null;
    if (!isLight || offsetNum === 0) {
      const totalResult = await pool.query(
        `SELECT COUNT(*) as count FROM commission_records cr${uploadJoin} ${wc}`,
        params
      );
      total = parseInt(totalResult.rows[0].count, 10);
    }
    let sums = null;
    if (!isLight) {
      const sumsResult = await pool.query(
        `SELECT
           COALESCE(SUM(cr.commission), 0)::float AS commission,
           COALESCE(SUM(cr.gross_commission), 0)::float AS gross_commission,
           COALESCE(SUM(cr.thei_share), 0)::float AS thei_share,
           COALESCE(SUM(cr.bsi_share), 0)::float AS bsi_share,
           COALESCE(SUM(cr.producer_payable), 0)::float AS producer_payable,
           COALESCE(SUM(cr.sub_agent_override), 0)::float AS sub_agent_override,
           COALESCE(SUM(cr.premium), 0)::float AS premium
         FROM commission_records cr${uploadJoin} ${wc}`,
        params
      );
      sums = sumsResult.rows[0] || null;
    }
    res.json({
      records: records.rows,
      total,
      sums,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /by-client — one row per client+carrier (All Data "client file" list)
router.get('/by-client', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { sortCol, sortDir = 'asc', limit = 100, offset = 0, hideTermed } = req.query;
    const { where, params, idx: startIdx, needsUploadJoin } = buildRecordListFilters(req);
    let idx = startIdx;
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const uploadJoin = ' LEFT JOIN uploads u ON cr.upload_id = u.id';

    const validCols = {
      client_full_name: 'client_full_name',
      carrier: 'carrier',
      agent_name: 'agent_name',
      payment_count: 'payment_count',
      commission_total: 'commission_total',
      latest_period: 'latest_period',
      first_period: 'first_period',
      policy_number: 'policy_number',
      lob: 'lob',
    };
    const orderCol = sortCol && validCols[sortCol] ? validCols[sortCol] : 'client_full_name';
    const orderDir = String(sortDir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const nameKeyExpr = clientNameKeySql('cr');
    const grouped = await pool.query(
      `SELECT * FROM (
         SELECT
           (ARRAY_AGG(cr.client_full_name ORDER BY
             CASE WHEN cr.client_full_name ~ '[a-z]' THEN 0 ELSE 1 END,
             cr.payment_period DESC NULLS LAST,
             cr.id DESC
           ))[1] AS client_full_name,
           MAX(cr.carrier) AS carrier,
           COUNT(*)::int AS payment_count,
           COALESCE(SUM(cr.commission), 0)::float AS commission_total,
           COALESCE(SUM(cr.producer_payable), 0)::float AS producer_payable_total,
           MAX(cr.payment_period) AS latest_period,
           MIN(cr.payment_period) AS first_period,
           (ARRAY_AGG(cr.agent_name ORDER BY cr.payment_period DESC NULLS LAST, cr.id DESC))[1] AS agent_name,
           (ARRAY_AGG(cr.policy_number ORDER BY cr.payment_period DESC NULLS LAST, cr.id DESC))[1] AS policy_number,
           (ARRAY_AGG(cr.lob ORDER BY
             CASE WHEN NULLIF(TRIM(COALESCE(cr.lob, '')), '') IS NULL THEN 1 ELSE 0 END,
             cr.payment_period DESC NULLS LAST,
             cr.id DESC
           ))[1] AS lob,
           BOOL_OR(${IS_TERMED_SQL}) AS is_termed
         FROM commission_records cr
         ${uploadJoin}
         ${wc}
         GROUP BY ${nameKeyExpr}, LOWER(TRIM(cr.carrier))
       ) g
       ${hideTermed === 'true' || hideTermed === '1' ? 'WHERE g.is_termed IS NOT TRUE' : ''}
       ORDER BY ${orderCol} ${orderDir}, client_full_name ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit, 10), parseInt(offset, 10)]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT 1
         FROM commission_records cr
         ${uploadJoin}
         ${wc}
         GROUP BY ${nameKeyExpr}, LOWER(TRIM(cr.carrier))
         ${hideTermed === 'true' || hideTermed === '1' ? `HAVING BOOL_OR(${IS_TERMED_SQL}) IS NOT TRUE` : ''}
       ) g`,
      params
    );

    // Full filtered totals (all pages) — not just the LIMIT page
    const sumsResult = await pool.query(
      `SELECT
         COALESCE(SUM(g.commission_total), 0)::float AS commission,
         COALESCE(SUM(g.producer_payable_total), 0)::float AS producer_payable,
         COALESCE(SUM(g.payment_count), 0)::int AS payment_count
       FROM (
         SELECT
           COALESCE(SUM(cr.commission), 0)::float AS commission_total,
           COALESCE(SUM(cr.producer_payable), 0)::float AS producer_payable_total,
           COUNT(*)::int AS payment_count,
           BOOL_OR(${IS_TERMED_SQL}) AS is_termed
         FROM commission_records cr
         ${uploadJoin}
         ${wc}
         GROUP BY ${nameKeyExpr}, LOWER(TRIM(cr.carrier))
       ) g
       ${hideTermed === 'true' || hideTermed === '1' ? 'WHERE g.is_termed IS NOT TRUE' : ''}`,
      params
    );

    res.json({
      clients: grouped.rows,
      total: countResult.rows[0]?.count || 0,
      sums: sumsResult.rows[0] || null,
    });
  } catch (err) {
    console.error('by-client error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /client-history — commission trend for one client (All Data drill-down)
router.get('/client-history', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { client, carrier, agent } = req.query;
    if (!client || !carrier) {
      return res.status(400).json({ error: 'client and carrier are required' });
    }

    const where = [
      `${clientNameKeySql('cr')} = $1`,
      `LOWER(TRIM(cr.carrier)) = LOWER(TRIM($2))`,
    ];
    const params = [clientNameKey(client), carrier];
    let idx = 3;

    if (agent) {
      where.push(`LOWER(TRIM(cr.agent_name)) = LOWER(TRIM($${idx++}))`);
      params.push(agent);
    }

    if (req.user.role === 'agent') {
      where.push(`cr.agent_name ILIKE $${idx++}`);
      params.push(`%${req.user.name}%`);
    } else if (req.user.role === 'admin') {
      const af = agencyFilter(req, 'cr');
      if (af) where.push(af);
    }

    const result = await pool.query(
      `SELECT cr.id, cr.payment_period, cr.classification, cr.commission, cr.producer_payable,
              cr.thei_share, cr.bsi_share, cr.policy_number, cr.effective_date, cr.lob,
              cr.agent_name, cr.carrier, cr.source, cr.upload_id,
              u.original_name AS upload_name, u.category AS upload_category,
              u.uploaded_at AS upload_uploaded_at
       FROM commission_records cr
       LEFT JOIN uploads u ON u.id = cr.upload_id
       WHERE ${where.join(' AND ')}
       ORDER BY cr.payment_period ASC NULLS LAST, cr.id ASC`,
      params
    );

    const rows = result.rows;
    let commissionTotal = 0;
    let payableTotal = 0;
    for (const r of rows) {
      commissionTotal += parseFloat(r.commission) || 0;
      payableTotal += parseFloat(r.producer_payable) || 0;
    }

    res.json({
      client,
      carrier,
      agent: agent || null,
      rows,
      totals: {
        count: rows.length,
        commission: Math.round(commissionTotal * 100) / 100,
        producer_payable: Math.round(payableTotal * 100) / 100,
      },
    });
  } catch (err) {
    console.error('client-history error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM commission_records WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bulk-delete', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const { ids, deleteAll, confirm, agent, carrier, period, classification } = req.body;
    if (deleteAll) {
      if (confirm !== 'DELETE ALL') {
        return res.status(400).json({ error: 'Must pass confirm: "DELETE ALL" to wipe all records.' });
      }
      await pool.query('DELETE FROM commission_records');
      await pool.query('DELETE FROM uploads');
      res.json({ success: true, deleted: 'all', message: 'All records deleted' });
      return;
    }
    if (ids && ids.length > 0) {
      await pool.query('DELETE FROM commission_records WHERE id = ANY($1)', [ids]);
      res.json({ success: true, deleted: ids.length });
      return;
    }
    let where = [], params = [], idx = 1;
    if (agent) { where.push(`agent_name = $${idx++}`); params.push(agent); }
    if (carrier) { where.push(`carrier = $${idx++}`); params.push(carrier); }
    if (period) { where.push(`payment_period = $${idx++}`); params.push(period); }
    if (classification) { where.push(`classification = $${idx++}`); params.push(classification); }
    if (!where.length) return res.status(400).json({ error: 'No filters specified' });
    const result = await pool.query(`DELETE FROM commission_records WHERE ${where.join(' AND ')}`, params);
    res.json({ success: true, deleted: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Summary ──────────────────────────────────────────────────────────────────
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agents, carriers, periods, classifications, planTypes, lobs, view } = req.query;
    let where = [], params = [], idx = 1;

    if (req.user.role === 'agent') {
      where.push(`agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`);
    } else if (req.user.role === 'admin') {
      const af = agencyFilter(req, null);
      if (af) { where.push(af); }
    }
    if (agents) { const list = agents.split(',').map(a=>a.trim()).filter(Boolean); if (list.length) { where.push(`agent_name = ANY($${idx++})`); params.push(list); } }
    if (carriers) { const list = carriers.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`carrier = ANY($${idx++})`); params.push(list); } }
    if (periods) { const list = periods.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`payment_period = ANY($${idx++})`); params.push(list); } }
    if (classifications) { const list = classifications.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`classification = ANY($${idx++})`); params.push(list); } }
    if (planTypes) { const list = planTypes.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`COALESCE(plan_type,'') = ANY($${idx++})`); params.push(list); } }
    if (lobs) { const list = lobs.split(',').map(l=>l.trim()).filter(Boolean); if (list.length) { where.push(`lob = ANY($${idx++})`); params.push(list); } }

    // Agency view: ACA house override only (NHP override column). Agent view: include pass-through.
    if (view !== 'agent') {
      where.push(AGENCY_ACA_AGENT_EXCLUDE);
    }

    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [totalComm, totalRec, agentCnt, carrierCnt, byAgent, byCarrier, byPeriod, byLOB] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(commission),0) as total FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(*) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(DISTINCT agent_name) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(DISTINCT carrier) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT agent_name, SUM(commission) as total, COUNT(*) as count FROM commission_records ${wc} GROUP BY agent_name ORDER BY total DESC`, params),
      pool.query(`SELECT carrier, SUM(commission) as total, COUNT(*) as count FROM commission_records ${wc} GROUP BY carrier ORDER BY total DESC`, params),
      pool.query(`SELECT payment_period as period, SUM(commission) as total, COUNT(*) as count, ABS(SUM(CASE WHEN commission < 0 THEN commission ELSE 0 END)) as chargebacks FROM commission_records ${wc} GROUP BY payment_period ORDER BY payment_period ASC`, params),
      pool.query(`SELECT lob,
        SUM(commission) as total,
        SUM(COALESCE(producer_payable,0)) as agent_payable,
        SUM(COALESCE(thei_share,0)) as thei_total,
        SUM(CASE WHEN COALESCE(producer_payable, 0) <> 0 THEN producer_payable ELSE commission END) as agent_production,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE COALESCE(thei_share, 0) <> 0) as override_count
        FROM commission_records ${wc} GROUP BY lob ORDER BY lob`, params),
    ]);

    res.json({
      totalCommission: parseFloat(totalComm.rows[0].total),
      totalRecords: parseInt(totalRec.rows[0].count),
      agentCount: parseInt(agentCnt.rows[0].count),
      carrierCount: parseInt(carrierCnt.rows[0].count),
      byAgent: byAgent.rows,
      byCarrier: byCarrier.rows,
      byPeriod: byPeriod.rows,
      byLOB: byLOB.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── KPI ──────────────────────────────────────────────────────────────────────
router.get('/kpi', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agents, carriers, periods, classifications, planTypes, lobs, view } = req.query;
    let where = [], params = [], idx = 1;

    if (req.user.role === 'agent') {
      where.push(`agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`);
    } else if (req.user.role === 'admin') {
      const af = agencyFilter(req, null);
      if (af) { where.push(af); }
    }
    if (agents) { const list = agents.split(',').map(a=>a.trim()).filter(Boolean); if (list.length) { where.push(`agent_name = ANY($${idx++})`); params.push(list); } }
    if (carriers) { const list = carriers.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`carrier = ANY($${idx++})`); params.push(list); } }
    if (periods) { const list = periods.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`payment_period = ANY($${idx++})`); params.push(list); } }
    if (classifications) { const list = classifications.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`classification = ANY($${idx++})`); params.push(list); } }
    if (planTypes) { const list = planTypes.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`COALESCE(plan_type,'') = ANY($${idx++})`); params.push(list); } }
    if (lobs) { const list = lobs.split(',').map(l=>l.trim()).filter(Boolean); if (list.length) { where.push(`lob = ANY($${idx++})`); params.push(list); } }

    // Agency view: ACA house override only (NHP override column). Agent view: include pass-through.
    if (view !== 'agent') {
      where.push(AGENCY_ACA_AGENT_EXCLUDE);
    }

    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = await pool.query(`
      SELECT agent_name,
        COUNT(*) as total_count,
        COALESCE(SUM(commission), 0) as total_commission,
        COALESCE(SUM(CASE WHEN commission < 0 THEN ABS(commission) ELSE 0 END), 0) as chargeback_amount,
        COUNT(CASE WHEN commission < 0 THEN 1 END) as chargeback_count,
        COALESCE(SUM(CASE WHEN classification ILIKE '%advance%' THEN commission ELSE 0 END), 0) as advance_amount,
        COUNT(CASE WHEN classification ILIKE '%advance%' THEN 1 END) as advance_count,
        COUNT(CASE WHEN classification IN ('New Business','Renewal') THEN 1 END) as new_apps
      FROM commission_records ${wc}
      GROUP BY agent_name ORDER BY total_commission DESC
    `, params);

    const totals = rows.rows.reduce((acc, r) => {
      acc.total_commission += parseFloat(r.total_commission) || 0;
      acc.total_count += parseInt(r.total_count) || 0;
      acc.chargeback_amount += parseFloat(r.chargeback_amount) || 0;
      acc.chargeback_count += parseInt(r.chargeback_count) || 0;
      acc.advance_amount += parseFloat(r.advance_amount) || 0;
      acc.advance_count += parseInt(r.advance_count) || 0;
      acc.new_apps += parseInt(r.new_apps) || 0;
      return acc;
    }, { total_commission:0, total_count:0, chargeback_amount:0, chargeback_count:0, advance_amount:0, advance_count:0, new_apps:0 });

    const agentsOut = rows.rows.map(r => {
      const total = parseFloat(r.total_commission) || 0;
      const cb = parseFloat(r.chargeback_amount) || 0;
      return {
        agent_name: r.agent_name,
        total_commission: total,
        total_count: parseInt(r.total_count) || 0,
        distribution_pct: totals.total_commission > 0 ? (total / totals.total_commission * 100) : 0,
        advance_amount: parseFloat(r.advance_amount) || 0,
        chargeback_amount: cb,
        chargeback_count: parseInt(r.chargeback_count) || 0,
        chargeback_ratio: Math.abs(total) > 0 ? (cb / Math.abs(total) * 100) : 0,
        net_sales: total - cb,
        new_apps: parseInt(r.new_apps) || 0,
        advance_count: parseInt(r.advance_count) || 0,
      };
    });

    res.json({ agents: agentsOut, totals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/missing-renewals', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { lastPeriod, thisPeriod, scope } = req.query;
    if (!lastPeriod || !thisPeriod) return res.status(400).json({ error: 'lastPeriod and thisPeriod required' });
    const _af = agencyFilter(req, null);

    const THEI_PRINCIPAL_FILTER = `AND (
      LOWER(agent_name) LIKE '%yahoska%'
      OR LOWER(agent_name) LIKE '%katy%'
      OR LOWER(agent_name) LIKE '%perez, yahoska%'
      OR LOWER(agent_name) LIKE '%robles, katy%'
    )`;

    // 1a — parameterized af filter (no string interpolation of user data)
    let afClause = '';
    let afParams = [];
    if (req.user.role === 'agent') {
      afClause = `AND agent_name ILIKE $2`;
      afParams = [`%${req.user.name}%`];
    } else if (_af) {
      afClause = `AND ${_af}`; // _af uses hardcoded carrier lists only — safe
      afParams = [];
    } else if (scope === 'all') {
      afClause = '';
      afParams = [];
    } else {
      afClause = THEI_PRINCIPAL_FILTER; // hardcoded literals — safe
      afParams = [];
    }
    const [lastMonth, thisMonth] = await Promise.all([
      pool.query(`SELECT agent_name, carrier, client_full_name, commission FROM commission_records WHERE payment_period = $1 ${afClause}`, [lastPeriod, ...afParams]),
      pool.query(`SELECT agent_name, carrier, client_full_name, commission FROM commission_records WHERE payment_period = $1 ${afClause}`, [thisPeriod, ...afParams])
    ]);

    // CRITICAL: Match on client_name|carrier ONLY - do NOT include effective_date
    // Effective dates vary across different statement sources (BSI, NHP, direct carrier)
    // and would cause false "missing" flags for the same client

    // Legacy exact-match keys (preserved for instrumentation baseline)
    const toLegacyKey = r => `${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase();
    const thisExactKeys = new Set(thisMonth.rows.map(toLegacyKey));
    const lastExactKeys = new Set(lastMonth.rows.map(toLegacyKey));

    // 1c — Smart Matching v2: all three fields normalized, deterministic keys only.
    // agent: alias resolution + token-sort | carrier: family normalization | client: accent-strip + token-sort
    const toV2Key = r => `${normalizeAgentKey(r.agent_name)}|${normalizeCarrierKey(r.carrier)}|${normalizeNameKey(r.client_full_name)}`;
    const thisV2Map = new Map();
    for (const r of thisMonth.rows) {
      const k = toV2Key(r);
      if (!thisV2Map.has(k)) thisV2Map.set(k, r); // first match wins
    }

    // Compute legacy missing first (exact match) for instrumentation
    const legacyMissing = lastMonth.rows.filter(r => !thisExactKeys.has(toLegacyKey(r)));
    const legacyMissingCount = legacyMissing.length;

    // v2: rescue records whose name just changed format
    const rescuedByV2 = [];
    const afterV2 = legacyMissing.filter(r => {
      const matchedRow = thisV2Map.get(toV2Key(r));
      if (matchedRow) {
        rescuedByV2.push({
          last_period_name: r.client_full_name,
          this_period_name: matchedRow.client_full_name,
          carrier: r.carrier,
          agent: r.agent_name,
        });
        return false; // rescued — not truly missing
      }
      return true;
    });

    // Fix: held_licensing detection.
    // Before flagging a renewal missing, check whether a bsi_statement Held record
    // exists for this name+carrier with a licensing/appointment hold reason — same
    // logic as /reconcile held_licensing. Match is format-tolerant via normalizeNameKey.
    //
    // TODO: remove carrier = 'UnitedHealthcare' guard once normClient() in
    // agencyproduction.js is fixed to strip trailing single-letter initials
    // (e.g. "ALAN KITCHMAN L" → "alan kitchman"). Until then, Humana Held records
    // use a non-comma name format that normalizeNameKey() cannot reliably match,
    // so we scope detection to UHC only (all 56 current held rows are UHC anyway).
    const heldResult = await pool.query(`
      SELECT cr.client_full_name, cr.carrier
      FROM commission_records cr
      JOIN uploads u ON cr.upload_id = u.id
      WHERE u.category = 'bsi_statement'
        AND cr.classification = 'Held'
        AND (
          cr.raw_data::jsonb->>'Hold Reason' ILIKE '%not licensed%'
          OR cr.raw_data::jsonb->>'Hold Reason' ILIKE '%not appointed%'
        )
        AND cr.client_full_name IS NOT NULL
        AND cr.carrier = 'UnitedHealthcare'
    `);
    const heldKeys = new Set();
    for (const h of heldResult.rows) {
      heldKeys.add(`${normalizeNameKey(h.client_full_name)}|${normalizeCarrierKey(h.carrier)}`);
    }

    const heldLicensing = [];
    const missing = afterV2.filter(r => {
      const hk = `${normalizeNameKey(r.client_full_name)}|${normalizeCarrierKey(r.carrier)}`;
      if (heldKeys.has(hk)) { heldLicensing.push(r); return false; }
      return true;
    });

    const newClients = thisMonth.rows.filter(r => !lastExactKeys.has(toLegacyKey(r)));
    res.json({
      lastPeriodCount: lastMonth.rows.length,
      thisPeriodCount: thisMonth.rows.length,
      missing,
      newClients,
      lostRevenue: missing.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0),
      legacyMissingCount,
      rescuedByV2Count: rescuedByV2.length,
      rescuedByV2,
      heldLicensing,
      heldLicensingCount: heldLicensing.length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /records/held-licensing-keys
// Returns {client_full_name, carrier} pairs for bsi_statement Held records
// whose hold_reason indicates a licensing/appointment issue.
// Filtered server-side because:
//   (a) raw_data is not exposed to the frontend via GET /records, and
//   (b) not all Held records are licensing holds — "Payment Type Paper Check"
//       (30 rows) and "Future Transaction" (11 rows) also exist and must not
//       trigger the badge.
// Only 56 rows currently match the licensing filter (all UnitedHealthcare).
router.get('/held-licensing-keys', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    // TODO: remove carrier = 'UnitedHealthcare' guard once normClient() in
    // agencyproduction.js strips trailing single-letter initials. See matching
    // comment in the held_licensing detection block above.
    const result = await pool.query(`
      SELECT cr.client_full_name, cr.carrier
      FROM commission_records cr
      JOIN uploads u ON cr.upload_id = u.id
      WHERE u.category = 'bsi_statement'
        AND cr.classification = 'Held'
        AND (
          cr.raw_data::jsonb->>'Hold Reason' ILIKE '%not licensed%'
          OR cr.raw_data::jsonb->>'Hold Reason' ILIKE '%not appointed%'
        )
        AND cr.client_full_name IS NOT NULL
        AND cr.carrier = 'UnitedHealthcare'
    `);
    res.json({ keys: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/filters', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const _agFilter = agencyFilter(req, null);
    const isAdmin = req.user.role === 'admin' && !_agFilter;
    // 1b — parameterized baseWhere (no string interpolation of user data)
    let baseWhere, baseParams = [];
    if (req.user.role === 'agent') {
      baseWhere = `WHERE agent_name ILIKE $1`;
      baseParams = [`%${req.user.name}%`];
    } else if (_agFilter) {
      baseWhere = `WHERE ${_agFilter}`; // _agFilter uses hardcoded carrier lists only — safe
      baseParams = [];
    } else {
      baseWhere = '';
      baseParams = [];
    }

    const [agents, carriers, periods] = await Promise.all([
      pool.query(`SELECT DISTINCT agent_name FROM commission_records ${baseWhere} ORDER BY agent_name`, baseParams),
      pool.query(`SELECT DISTINCT carrier FROM commission_records ${baseWhere} ORDER BY carrier`, baseParams),
      pool.query(`SELECT DISTINCT payment_period FROM commission_records ${baseWhere} ORDER BY payment_period DESC`, baseParams)
    ]);

    let planTypes = [];
    try {
      const planBase = baseWhere ? baseWhere + ` AND plan_type IS NOT NULL AND plan_type != ''` : `WHERE plan_type IS NOT NULL AND plan_type != ''`;
      const pt = await pool.query(`SELECT DISTINCT plan_type FROM commission_records ${planBase} ORDER BY plan_type`, baseParams);
      planTypes = pt.rows.map(p => p.plan_type).filter(Boolean);
    } catch (e) { console.log('plan_type not available:', e.message); }

    let payees = [];
    try {
      const payeeBase = baseWhere ? baseWhere + ` AND payee IS NOT NULL AND payee != ''` : `WHERE payee IS NOT NULL AND payee != ''`;
      const py = await pool.query(`SELECT DISTINCT payee FROM commission_records ${payeeBase} ORDER BY payee`, baseParams);
      payees = py.rows.map(p => p.payee).filter(Boolean);
    } catch (e) { console.log('payee not available:', e.message); }

    let classifications = [];
    try {
      const classBase = baseWhere ? baseWhere + ` AND classification IS NOT NULL AND classification != ''` : `WHERE classification IS NOT NULL AND classification != ''`;
      const cl = await pool.query(`SELECT DISTINCT classification FROM commission_records ${classBase} ORDER BY classification`, baseParams);
      const planTypeKeywords = /AARP|CSNP|DSNP|MAPD|PDP|MED SUP|MED ADV|MEDIGAP|SUPPLEMENT|HMO|PPO|Aetna|UnitedHealthcare|Humana|Cigna|Devoted|WellCare|Solis|Doctors|HealthSun/i;
      classifications = cl.rows.map(c => c.classification).filter(c => c && !planTypeKeywords.test(c));
    } catch (e) { console.log('classification not available:', e.message); }

    let lobs = [];
    try {
      const lobBase = baseWhere ? baseWhere + ` AND lob IS NOT NULL AND lob != ''` : `WHERE lob IS NOT NULL AND lob != ''`;
      const lb = await pool.query(`SELECT DISTINCT lob FROM commission_records ${lobBase} ORDER BY lob`, baseParams);
      lobs = lb.rows.map(l => l.lob).filter(Boolean);
    } catch (e) { console.log('lob not available:', e.message); }

    res.json({
      agents: agents.rows.map(a => a.agent_name).filter(Boolean),
      carriers: carriers.rows.map(c => c.carrier).filter(Boolean),
      periods: periods.rows.map(p => p.payment_period).filter(Boolean),
      planTypes,
      payees,
      classifications,
      lobs
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/normalize-agents', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const updated = await normalizeAllRecords(pool);
    res.json({ success: true, updated, message: `Normalized ${updated} records` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/adp-payable', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const period = req.query.period;
    const year = req.query.year;
    const groupByCarrier = req.query.group_by_carrier === 'true';

    const whereParts = ['producer_payable IS NOT NULL', 'producer_payable > 0'];
    const params = [];
    if (period) {
      params.push(period);
      whereParts.push(`payment_period = $${params.length}`);
    } else if (year) {
      params.push(`${year}%`);
      whereParts.push(`payment_period LIKE $${params.length}`);
    }
    const af = agencyFilter(req, null);
    if (af) whereParts.push(af);
    const whereClause = `WHERE ${whereParts.join(' AND ')}`;

    const perProducer = await pool.query(
      `SELECT agent_name,
              SUM(producer_payable) as total_payable,
              COUNT(*) as record_count
       FROM commission_records
       ${whereClause}
       GROUP BY agent_name
       ORDER BY total_payable DESC`,
      params
    );

    let perCarrier = [];
    if (groupByCarrier) {
      const carrierResult = await pool.query(
        `SELECT agent_name, carrier,
                SUM(producer_payable) as carrier_payable,
                COUNT(*) as record_count
         FROM commission_records
         ${whereClause}
         GROUP BY agent_name, carrier
         ORDER BY agent_name, carrier`,
        params
      );
      perCarrier = carrierResult.rows;
    }

    const producers = perProducer.rows.map(r => {
      const out = {
        name: r.agent_name,
        total_payable: parseFloat(r.total_payable),
        record_count: parseInt(r.record_count, 10),
      };
      if (groupByCarrier) {
        out.by_carrier = {};
        for (const c of perCarrier.filter(x => x.agent_name === r.agent_name)) {
          out.by_carrier[c.carrier] = parseFloat(c.carrier_payable);
        }
      }
      return out;
    });

    const totalGross = producers.reduce((s, p) => s + p.total_payable, 0);
    const totalCount = producers.reduce((s, p) => s + p.record_count, 0);

    res.json({
      period_filter: period || (year ? `${year}*` : null),
      totals: {
        gross: Math.round(totalGross * 100) / 100,
        record_count: totalCount,
        producer_count: producers.length,
      },
      producers,
    });
  } catch (err) {
    console.error('adp-payable error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/agency-summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const period = req.query.period;
    const year = req.query.year;
    const periods = req.query.periods;

    const whereParts = [AGENCY_ACA_AGENT_EXCLUDE];
    const params = [];
    let idx = 1;

    const af = agencyFilter(req, null);
    if (af) whereParts.push(af);

    if (periods) {
      const list = String(periods).split(',').map((p) => p.trim()).filter(Boolean);
      if (list.length) {
        whereParts.push(`payment_period = ANY($${idx++})`);
        params.push(list);
      }
    } else if (period) {
      whereParts.push(`payment_period = $${idx++}`);
      params.push(period);
    } else if (year) {
      whereParts.push(`payment_period LIKE $${idx++}`);
      params.push(`${year}%`);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         source,
         SUM(COALESCE(gross_commission, 0)) as gross_total,
         SUM(COALESCE(thei_share, 0)) as thei_total,
         SUM(COALESCE(bsi_share, 0)) as bsi_total,
         SUM(COALESCE(producer_payable, 0)) as producer_total,
         COUNT(*) as record_count
       FROM commission_records
       ${whereClause}
       GROUP BY source
       ORDER BY source`,
      params
    );

    const sources = {};
    let grandGross = 0, grandThei = 0, grandBsi = 0, grandPayable = 0, grandCount = 0;
    for (const r of result.rows) {
      const src = r.source || 'unknown';
      sources[src] = {
        gross: parseFloat(r.gross_total),
        thei_share: parseFloat(r.thei_total),
        bsi_share: parseFloat(r.bsi_total),
        producer_payable: parseFloat(r.producer_total),
        record_count: parseInt(r.record_count, 10),
      };
      grandGross += parseFloat(r.gross_total);
      grandThei += parseFloat(r.thei_total);
      grandBsi += parseFloat(r.bsi_total);
      grandPayable += parseFloat(r.producer_total);
      grandCount += parseInt(r.record_count, 10);
    }

    const periodLabel =
      (periods && String(periods).split(',').filter(Boolean).length > 1)
        ? `${String(periods).split(',')[0]}–${String(periods).split(',').slice(-1)[0]}`
        : period || (year ? `${year}*` : 'all-time');

    res.json({
      period_filter: periodLabel,
      sources,
      totals: {
        gross: Math.round(grandGross * 100) / 100,
        thei_share: Math.round(grandThei * 100) / 100,
        bsi_share: Math.round(grandBsi * 100) / 100,
        producer_payable: Math.round(grandPayable * 100) / 100,
        record_count: grandCount,
      },
    });
  } catch (err) {
    console.error('agency-summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/backfill-business-rules', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();

    const NO_SPLIT_AGENTS = [
      'patsy pernia', 'eduardo pernia', 'josseline silber', 'josseline mena',
      'jessica sifontes', 'sabri perez', 'jill taylor', 'osmary orozco',
    ];
    const ACA_CARRIERS_LIST = [
      'molina', 'cigna', 'ambetter', 'florida blue', 'oscar health', 'oscar',
    ];
    const ACA_AGENCY_PAYS_PRODUCER = ['molina', 'cigna', 'ambetter', 'florida blue'];

    function shouldSplit(agentName, carrier) {
      const c = String(carrier || '').toLowerCase().trim();
      if (ACA_CARRIERS_LIST.some(x => c.includes(x))) return false;
      return true;
    }
    function isAcaAgencyPaysProducer(carrier) {
      const c = String(carrier || '').toLowerCase().trim();
      return ACA_AGENCY_PAYS_PRODUCER.some(x => c.includes(x));
    }

    const force = req.query.force === 'true';
    const whereClause = force ? '' : 'WHERE cr.source IS NULL';

    const sel = await pool.query(`
      SELECT cr.id, cr.agent_name, cr.carrier, cr.commission, cr.classification,
             cr.effective_date, cr.plan_type, cr.payee, cr.payment_period,
             u.original_name AS upload_name
      FROM commission_records cr
      LEFT JOIN uploads u ON u.id = cr.upload_id
      ${whereClause}
      ORDER BY cr.payment_period ASC NULLS LAST
    `);

    // Pre-query: build set of agent|carrier combos that have a known Agency Override relationship.
    // Used to identify agent-level New Business/Renewal/Chargeback rows that should be pass-through.
    // Keyed on agent|carrier only (not period) — override statements may arrive on a different cadence
    // than transaction feeds, so a missing override row for a given period does not mean the row is
    // not agent-level; it means that month's override statement hasn't been uploaded yet.
    const overrideRows = await pool.query(`
      SELECT DISTINCT LOWER(agent_name) AS agent, LOWER(carrier) AS carrier
      FROM commission_records
      WHERE classification = 'Agency Override'
        AND source IS NOT NULL
    `);
    const overrideSet = new Set(overrideRows.rows.map(r => `${r.agent}|${r.carrier}`));

    // Integrity Partners agents: 50% producer / 25% THEI / 25% BSI on all Agency Override rows
    const INTEGRITY_AGENTS_LIST = ['christian munoz', 'horacio mendieta', 'cam insurance solutions corp'];

    // Marco's agents: $10 deduction per policy first occurrence, then 50/50 THEI/BSI split
    // Jendy Vanheyningen excluded from Marco's deduction for payment_period >= 202606
    const MARCO_AGENTS_LIST = ['jena brewer','kelly carpenter','adrian cruz','long khuu',
      'nicholas mccalla','tyler payton','anthony portorreal','michael rivera',
      'cristy witcher','michael mateo','miriam jimenez','jendy vanheyningen'];

    // Policies already deducted in DB — prevents re-deducting on re-run or force backfill
    // ORDER BY payment_period ASC (added above) ensures earliest period processed first within batch
    const alreadyDeductedRows = await pool.query(`
      SELECT DISTINCT policy_number FROM commission_records
      WHERE classification = 'Agency Override' AND sub_agent_override > 0
    `);
    const deductedPolicies = new Set(alreadyDeductedRows.rows.map(r => r.policy_number));

    let updated = 0;
    let skipped = 0;
    const sources = { BSI: 0, NHP: 0, direct_carrier: 0, manual: 0 };

    for (const row of sel.rows) {
      const fn = String(row.upload_name || '').toLowerCase().replace(/\s+/g, '_');
      const payeeLc = String(row.payee || '').toLowerCase();
      let source = 'manual';
      if (payeeLc === 'bsi' || /statement-the|statement_-the|broker_society|bsi|statement-health_experts|statement_health_experts/.test(fn)) source = 'BSI';
      else if (payeeLc === 'nhp' || /nhp|the_health_experts_insurance_statement/.test(fn)) source = 'NHP';
      else if (payeeLc) source = 'direct_carrier';
      sources[source] = (sources[source] || 0) + 1;

      const agent = row.agent_name;
      const carrier = row.carrier;
      const classification = String(row.classification || '').toLowerCase();
      const isCommissionRow = classification.includes('agent commission') || classification === 'commission';
      const netCommission = parseFloat(row.commission) || 0;

      const isAcaPassThroughAgent = NO_SPLIT_AGENTS.some(a => String(agent || '').toLowerCase().includes(a));
      const isAcaCarrier = ACA_CARRIERS_LIST.some(c => String(carrier || '').toLowerCase().includes(c));

      // Agent-direct rows: New Business, Renewal, or Chargeback for an agent who also has Agency Override
      // rows on record for this carrier. These are individual agent commissions (pass-through), not
      // agency overrides (BSI split). The Agency Override rows for the same agent/carrier are uploaded
      // separately and already processed correctly.
      const isAgentDirectRow = classification === 'new business' || classification === 'renewal' || classification === 'chargeback';
      const hasMatchingOverride = overrideSet.has(`${String(agent || '').toLowerCase()}|${String(carrier || '').toLowerCase()}`);

      let splitApplies, theiShare, bsiShare, producerPayable, grossCommission;
      let subAgentOverride = 0;

      const agentLcB = String(agent || '').toLowerCase();
      const isIntegrityPartners = INTEGRITY_AGENTS_LIST.some(n => agentLcB.includes(n));
      const isJendyPostCutoff = agentLcB.includes('jendy vanheyningen') && (row.payment_period || '') >= '202606';
      const isMarcoAgent = MARCO_AGENTS_LIST.some(n => agentLcB.includes(n)) && !isJendyPostCutoff;
      const isBsiFullPot = payeeLc === 'bsi';

      if (isCommissionRow || isAgentDirectRow) {
        // Agent production (Agent Commission / NB / Renewal / Chargeback) is paid to agents —
        // never Agency THEI Share. Must run BEFORE the direct_carrier 100% THEI branch.
        splitApplies = false;
        grossCommission = netCommission;
        theiShare = 0;
        bsiShare = 0;
        producerPayable = grossCommission;
      } else if (isAcaCarrier) {
        splitApplies = false;
        grossCommission = netCommission;
        if (isAcaAgencyPaysProducer(carrier) && isAcaPassThroughAgent) {
          theiShare = 0;
          bsiShare = 0;
          producerPayable = grossCommission;
        } else {
          theiShare = grossCommission;
          bsiShare = 0;
          producerPayable = 0;
        }
      } else if (source === 'direct_carrier' && !isBsiFullPot) {
        // Remaining direct-carrier house lines (e.g. Agency Override) keep 100% THEI.
        splitApplies = false;
        grossCommission = netCommission;
        theiShare = netCommission;
        bsiShare = 0;
        producerPayable = 0;
      } else if (classification === 'agency override' && isIntegrityPartners) {
        // Integrity Partners (Christian Munoz, Horacio Mendieta, CAM): 50% producer / 25% THEI / 25% BSI
        splitApplies = false;
        grossCommission = netCommission;
        producerPayable = Math.round(grossCommission * 0.50 * 100) / 100;
        theiShare = Math.round(grossCommission * 0.25 * 100) / 100;
        bsiShare = Math.round(grossCommission * 0.25 * 100) / 100;
      } else if (classification === 'agency override' && isMarcoAgent) {
        // Marco agents: $10 flat deduction on first Override occurrence per policy, then 50/50 THEI/BSI
        // ORDER BY payment_period ASC ensures earliest period gets the deduction
        splitApplies = false;
        grossCommission = netCommission;
        producerPayable = 0;
        const alreadyDeducted = deductedPolicies.has(row.policy_number);
        if (!alreadyDeducted && Math.abs(grossCommission) >= 10) {
          subAgentOverride = grossCommission < 0 ? -10 : 10;
          theiShare = Math.round((grossCommission - subAgentOverride) / 2 * 100) / 100;
          bsiShare = Math.round((grossCommission - subAgentOverride) / 2 * 100) / 100;
          deductedPolicies.add(row.policy_number); // prevent double-deduction within same batch
        } else {
          subAgentOverride = 0;
          theiShare = Math.round(grossCommission / 2 * 100) / 100;
          bsiShare = Math.round(grossCommission / 2 * 100) / 100;
        }
      } else if (classification === 'agency override' && isBsiFullPot) {
        // BSI book: commission is the FULL override pot → THEI/BSI 50/50
        if (source === 'direct_carrier') source = 'BSI';
        splitApplies = true;
        grossCommission = netCommission;
        theiShare = Math.round(netCommission * 0.5 * 100) / 100;
        bsiShare = Math.round(netCommission * 0.5 * 100) / 100;
        producerPayable = 0;
      } else {
        // THE remittance half-model: amount is already THEI's half → mirror to BSI
        splitApplies = true;
        grossCommission = Math.round(netCommission * 2 * 100) / 100;
        theiShare = netCommission;
        bsiShare = netCommission;
        producerPayable = 0;
      }

      const planType = String(row.plan_type || '').toLowerCase();
      const carrierLc = String(carrier || '').toLowerCase();
      let lob = null;
      if (/med adv|mapd|advantage/.test(planType)) lob = 'MA';
      else if (/pdp/.test(planType)) lob = 'PDP';
      else if (/medsupp|medigap|supplement/.test(planType)) lob = 'MedSupp';
      else if (/aca|marketplace/.test(planType) || isAcaCarrier) lob = 'ACA';
      else if (/dental/.test(planType)) lob = 'Dental';
      else if (/vision/.test(planType)) lob = 'Vision';
      else if (/life/.test(planType)) lob = 'Life';
      else if (/medicare|humana|aetna|united|devoted/.test(carrierLc)) lob = 'MA';

      let policyWrittenDate = null;
      const ed = String(row.effective_date || '');
      const m1 = ed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const m2 = ed.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m1) policyWrittenDate = `${m1[3]}-${m1[1]}-${m1[2]}`;
      else if (m2) policyWrittenDate = `${m2[1]}-${m2[2]}-${m2[3]}`;

      await pool.query(
        `UPDATE commission_records
            SET source = $1,
                policy_written_date = $2,
                gross_commission = $3,
                thei_share = $4,
                bsi_share = $5,
                producer_payable = $6,
                split_applies = $7,
                lob = $8,
                sub_agent_override = $9
          WHERE id = $10`,
        [source, policyWrittenDate, grossCommission, theiShare, bsiShare, producerPayable, splitApplies, lob, subAgentOverride, row.id]
      );
      updated++;
    }

    res.json({
      success: true,
      updated,
      skipped,
      sources,
      message: `Backfilled ${updated} records with OliComm business-rule columns.`,
    });
  } catch (err) {
    console.error('backfill error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── FIX MED LOB ──────────────────────────────────────────────────────────────
router.post('/fix-med-lob', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`UPDATE commission_records SET lob = 'MA' WHERE lob = 'MED' RETURNING id`);
    res.json({ success: true, updated: result.rowCount });
  } catch (error) {
    console.error('Fix MED LOB error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── FIX ACA CLASSIFICATIONS ─────────────────────────────────────────────────
router.post('/fix-aca-classifications', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    
    const agentCommResult = await pool.query(`
      UPDATE commission_records 
      SET classification = 'ACA Agent Commission'
      WHERE lob = 'ACA' 
        AND classification = 'Override' 
        AND COALESCE(producer_payable, 0) > 0
      RETURNING id
    `);
    
    const agencyOverrideResult = await pool.query(`
      UPDATE commission_records 
      SET classification = 'ACA Agency Override'
      WHERE lob = 'ACA' 
        AND classification = 'Override' 
        AND COALESCE(thei_share, 0) > 0
        AND COALESCE(producer_payable, 0) = 0
      RETURNING id
    `);
    
    res.json({ 
      success: true, 
      agentCommissions: agentCommResult.rowCount,
      agencyOverrides: agencyOverrideResult.rowCount,
      total: agentCommResult.rowCount + agencyOverrideResult.rowCount
    });
  } catch (error) {
    console.error('Fix ACA classifications error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
// Exported for reuse by other routes that need the same agency-isolation rule
// (e.g. agencyproduction.js's new unpaid-production search) instead of
// re-deriving the BSI/THEI carrier split and risking it drifting out of sync.
module.exports.getAgency = getAgency;
module.exports.agencyFilter = agencyFilter;

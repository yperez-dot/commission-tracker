const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { normalizeAllRecords } = require('./normalize');
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

router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agent, agents, carrier, carriers, period, periods, classification, classifications, planType, payee, search, upload_id, limit = 100, offset = 0 } = req.query;
    let where = [], params = [], idx = 1;

    if (req.user.role === 'agent') {
      where.push(`cr.agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`);
    } else if (req.user.role === 'admin') {
      const af = agencyFilter(req, 'cr');
      if (af) { where.push(af); }
    }
    if (agents) { const list = agents.split(',').map(a=>a.trim()).filter(Boolean); if (list.length) { where.push(`cr.agent_name = ANY($${idx++})`); params.push(list); } }
    else if (agent) { where.push(`cr.agent_name = $${idx++}`); params.push(agent); }
    if (carriers) { const list = carriers.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`cr.carrier = ANY($${idx++})`); params.push(list); } }
    else if (carrier) { where.push(`cr.carrier = $${idx++}`); params.push(carrier); }
    if (periods) { const list = periods.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`cr.payment_period = ANY($${idx++})`); params.push(list); } }
    else if (period) { where.push(`cr.payment_period = $${idx++}`); params.push(period); }
    if (classifications) { const list = classifications.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`cr.classification = ANY($${idx++})`); params.push(list); } }
    else if (classification) { where.push(`cr.classification = $${idx++}`); params.push(classification); }
    if (planType) { where.push(`COALESCE(cr.plan_type,'') = $${idx++}`); params.push(planType); }
    if (upload_id) { where.push(`cr.upload_id = $${idx++}`); params.push(parseInt(upload_id)); }
    if (payee) { where.push(`cr.payee = $${idx++}`); params.push(payee); }
    if (search) { where.push(`(cr.client_full_name ILIKE $${idx} OR cr.agent_name ILIKE $${idx} OR cr.carrier ILIKE $${idx})`); params.push(`%${search}%`); idx++; }

    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const records = await pool.query(
      `SELECT cr.id, cr.agent_name, cr.carrier,
        COALESCE(cr.plan_type, '') as plan_type,
        cr.client_full_name, cr.effective_date, cr.premium, cr.commission,
        cr.classification, cr.payment_period, cr.policy_number, cr.created_at,
        cr.upload_id, cr.payee, COALESCE(cr.mga, '') as mga,
        cr.raw_data, u.original_name as upload_name
       FROM commission_records cr LEFT JOIN uploads u ON cr.upload_id = u.id
       ${wc} ORDER BY cr.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    // Use cr alias on count query so WHERE cr.column refs work
    const total = await pool.query(
      `SELECT COUNT(*) as count FROM commission_records cr ${wc}`,
      params
    );

    res.json({ records: records.rows, total: parseInt(total.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const { ids, deleteAll, agent, carrier, period, classification } = req.body;
    if (deleteAll) {
      await pool.query('DELETE FROM commission_records');
      await pool.query('DELETE FROM uploads');
      await pool.query('DELETE FROM book_of_business');
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
    const { agents, carriers, periods, classifications, planTypes } = req.query;
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

    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [totalComm, totalRec, agentCnt, carrierCnt, byAgent, byCarrier, byPeriod] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(commission),0) as total FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(*) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(DISTINCT agent_name) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(DISTINCT carrier) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT agent_name, SUM(commission) as total, COUNT(*) as count FROM commission_records ${wc} GROUP BY agent_name ORDER BY total DESC`, params),
      pool.query(`SELECT carrier, SUM(commission) as total, COUNT(*) as count FROM commission_records ${wc} GROUP BY carrier ORDER BY total DESC`, params),
      pool.query(`SELECT payment_period as period, SUM(commission) as total, COUNT(*) as count, ABS(SUM(CASE WHEN commission < 0 THEN commission ELSE 0 END)) as chargebacks FROM commission_records ${wc} GROUP BY payment_period ORDER BY payment_period ASC`, params),
    ]);

    res.json({
      totalCommission: parseFloat(totalComm.rows[0].total),
      totalRecords: parseInt(totalRec.rows[0].count),
      agentCount: parseInt(agentCnt.rows[0].count),
      carrierCount: parseInt(carrierCnt.rows[0].count),
      byAgent: byAgent.rows,
      byCarrier: byCarrier.rows,
      byPeriod: byPeriod.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── KPI ──────────────────────────────────────────────────────────────────────
router.get('/kpi', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agents, carriers, periods, classifications, planTypes } = req.query;
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

    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Restored original simple SQL after plan-change detection broke production.
    // Plan-change tagging now happens in the frontend (Reports.js) where it's
    // easier to test + iterate. KPI endpoint is back to known-good shape.
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

    // Default scope: only Yahoska + Katy's personal production.
    // Pass scope='all' to override and check the entire BOB.
    // Per Yahoska 2026-05-12: "We only check for mine and Katy's BOB."
    const THEI_PRINCIPAL_FILTER = `AND (
      LOWER(agent_name) LIKE '%yahoska%'
      OR LOWER(agent_name) LIKE '%katy%'
      OR LOWER(agent_name) LIKE '%perez, yahoska%'
      OR LOWER(agent_name) LIKE '%robles, katy%'
    )`;

    let af;
    if (req.user.role === 'agent') {
      af = `AND agent_name ILIKE '%${req.user.name}%'`;
    } else if (_af) {
      af = `AND ${_af}`;
    } else if (scope === 'all') {
      af = '';
    } else {
      af = THEI_PRINCIPAL_FILTER;
    }
    const [lastMonth, thisMonth] = await Promise.all([
      pool.query(`SELECT agent_name, carrier, client_full_name, commission FROM commission_records WHERE payment_period = $1 ${af}`, [lastPeriod]),
      pool.query(`SELECT agent_name, carrier, client_full_name, commission FROM commission_records WHERE payment_period = $1 ${af}`, [thisPeriod])
    ]);
    const thisKeys = new Set(thisMonth.rows.map(r => `${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase()));
    const lastKeys = new Set(lastMonth.rows.map(r => `${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase()));
    const missing = lastMonth.rows.filter(r => !thisKeys.has(`${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase()));
    const newClients = thisMonth.rows.filter(r => !lastKeys.has(`${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase()));
    res.json({ lastPeriodCount: lastMonth.rows.length, thisPeriodCount: thisMonth.rows.length, missing, newClients, lostRevenue: missing.reduce((s,r)=>s+(parseFloat(r.commission)||0),0) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/filters', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const _agFilter = agencyFilter(req, null);
    const isAdmin = req.user.role === 'admin' && !_agFilter;
    const baseWhere = req.user.role === 'agent'
      ? `WHERE agent_name ILIKE '%${req.user.name}%'`
      : _agFilter ? `WHERE ${_agFilter}` : '';

    const [agents, carriers, periods] = await Promise.all([
      pool.query(`SELECT DISTINCT agent_name FROM commission_records ${baseWhere} ORDER BY agent_name`),
      pool.query(`SELECT DISTINCT carrier FROM commission_records ${baseWhere} ORDER BY carrier`),
      pool.query(`SELECT DISTINCT payment_period FROM commission_records ${baseWhere} ORDER BY payment_period DESC`)
    ]);

    let planTypes = [];
    try {
      const planBase = baseWhere ? baseWhere + ` AND plan_type IS NOT NULL AND plan_type != ''` : `WHERE plan_type IS NOT NULL AND plan_type != ''`;
      const pt = await pool.query(`SELECT DISTINCT plan_type FROM commission_records ${planBase} ORDER BY plan_type`);
      planTypes = pt.rows.map(p => p.plan_type).filter(Boolean);
    } catch (e) { console.log('plan_type not available:', e.message); }

    let payees = [];
    try {
      const payeeBase = baseWhere ? baseWhere + ` AND payee IS NOT NULL AND payee != ''` : `WHERE payee IS NOT NULL AND payee != ''`;
      const py = await pool.query(`SELECT DISTINCT payee FROM commission_records ${payeeBase} ORDER BY payee`);
      payees = py.rows.map(p => p.payee).filter(Boolean);
    } catch (e) { console.log('payee not available:', e.message); }

    res.json({
      agents: agents.rows.map(a => a.agent_name).filter(Boolean),
      carriers: carriers.rows.map(c => c.carrier).filter(Boolean),
      periods: periods.rows.map(p => p.payment_period).filter(Boolean),
      planTypes,
      payees
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

// ADP Payable Report — list of producers THEI owes for ACA pass-through.
//
// Use case: Each pay period, Yahoska needs to know exactly how much to pay
// each ACA pass-through producer (Patsy, Eduardo, Jessica, Sabri, Jill,
// Josseline, Osmary) via ADP. This endpoint gives her that list.
//
// Query params:
//   period (string) - filter by payment_period (e.g., '202604'). Optional.
//   year (string)   - filter by YYYY of payment_period. Optional.
//   group_by_carrier (bool) - if true, return per-carrier breakdown per producer
//
// Returns:
//   {
//     period_filter: string | null,
//     totals: { gross, paid_count },
//     producers: [
//       { name, total_payable, record_count, by_carrier: { Molina: $, Cigna: $, ... } }
//     ]
//   }
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
    const whereClause = `WHERE ${whereParts.join(' AND ')}`;

    // Per-producer totals
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

    // Optional per-carrier breakdown
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

    // Build response
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

// Agency P&L summary — what THEI actually earned + what's owed
router.get('/agency-summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const period = req.query.period;
    const year = req.query.year;

    const whereParts = [];
    const params = [];
    if (period) {
      params.push(period);
      whereParts.push(`payment_period = $${params.length}`);
    } else if (year) {
      params.push(`${year}%`);
      whereParts.push(`payment_period LIKE $${params.length}`);
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

    res.json({
      period_filter: period || (year ? `${year}*` : 'all-time'),
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

// Backfill OliComm business-rule columns onto existing commission_records.
// Computes source/lob/split fields from the data we already have.
// Safe to run multiple times — idempotent (only updates rows where the new
// columns are still NULL).
router.post('/backfill-business-rules', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();

    // Inline the rule constants so this works without depending on files.js exports
    const NO_SPLIT_AGENTS = [
      'patsy pernia', 'eduardo pernia', 'josseline silber', 'josseline mena',
      'jessica sifontes', 'sabri perez', 'jill taylor', 'osmary orozco',
    ];
    const ACA_CARRIERS_LIST = [
      'molina', 'cigna', 'ambetter', 'florida blue', 'oscar health', 'oscar',
    ];
    const ACA_AGENCY_PAYS_PRODUCER = ['molina', 'cigna', 'ambetter', 'florida blue'];

    // Decision: does the THE↔BSI 50/50 split apply?
    // Per Yahoska 2026-05-12 clarification:
    //   - Medicare lines always split 50/50, regardless of agent.
    //   - ACA never splits (whether or not the agent is a pass-through producer).
    function shouldSplit(agentName, carrier) {
      const c = String(carrier || '').toLowerCase().trim();
      if (ACA_CARRIERS_LIST.some(x => c.includes(x))) return false;
      return true;
    }
    function isAcaAgencyPaysProducer(carrier) {
      const c = String(carrier || '').toLowerCase().trim();
      return ACA_AGENCY_PAYS_PRODUCER.some(x => c.includes(x));
    }

    // ?force=true forces a re-backfill of ALL rows (use after rule corrections).
    const force = req.query.force === 'true';
    const whereClause = force ? '' : 'WHERE cr.source IS NULL';

    const sel = await pool.query(`
      SELECT cr.id, cr.agent_name, cr.carrier, cr.commission, cr.classification,
             cr.effective_date, cr.plan_type, cr.payee, cr.payment_period,
             u.original_name AS upload_name
      FROM commission_records cr
      LEFT JOIN uploads u ON u.id = cr.upload_id
      ${whereClause}
    `);

    let updated = 0;
    let skipped = 0;
    const sources = { BSI: 0, NHP: 0, direct_carrier: 0, manual: 0 };

    for (const row of sel.rows) {
      // Infer source from the upload filename / payee
      const fn = String(row.upload_name || '').toLowerCase();
      const payeeLc = String(row.payee || '').toLowerCase();
      let source = 'manual';
      if (payeeLc === 'bsi' || /statement-the|statement_-the|broker_society|bsi/.test(fn)) source = 'BSI';
      else if (payeeLc === 'nhp' || /nhp|the_health_experts_insurance_statement/.test(fn)) source = 'NHP';
      else if (payeeLc) source = 'direct_carrier';
      sources[source] = (sources[source] || 0) + 1;

      // Compute split / payable
      const agent = row.agent_name;
      const carrier = row.carrier;
      const classification = String(row.classification || '').toLowerCase();
      const isCommissionRow = classification.includes('agent commission') || classification === 'commission';

      // The historical `commission` column is already the NET-after-split value
      // (per the existing parsers). We can't recover the gross from there alone,
      // BUT for split records we can derive it: gross = net * 2.
      // For no-split records, gross = net.
      const netCommission = parseFloat(row.commission) || 0;

      const isAcaPassThroughAgent = NO_SPLIT_AGENTS.some(a => String(agent || '').toLowerCase().includes(a));
      const isAcaCarrier = ACA_CARRIERS_LIST.some(c => String(carrier || '').toLowerCase().includes(c));
      let splitApplies, theiShare, bsiShare, producerPayable, grossCommission;

      if (isCommissionRow) {
        // Producer's own commission flowing through THEI (ADP payable)
        splitApplies = false;
        grossCommission = netCommission;
        theiShare = 0;
        bsiShare = 0;
        producerPayable = grossCommission;
      } else if (isAcaCarrier) {
        // ACA override: no BSI split
        splitApplies = false;
        grossCommission = netCommission;
        if (isAcaAgencyPaysProducer(carrier) && isAcaPassThroughAgent) {
          // Pass-through to producer via ADP
          theiShare = 0;
          bsiShare = 0;
          producerPayable = grossCommission;
        } else {
          // ACA but THEI keeps the override
          theiShare = grossCommission;
          bsiShare = 0;
          producerPayable = 0;
        }
      } else if (source === 'direct_carrier') {
        // Direct carrier portal pulls show YOUR (Yahoska/Katy) PERSONAL
        // production only. No BSI split applies — it's the writer's own money.
        // Confirmed by Yahoska 2026-05-12.
        splitApplies = false;
        grossCommission = netCommission;
        theiShare = netCommission;
        bsiShare = 0;
        producerPayable = 0;
      } else {
        // BSI / NHP Medicare override -> 50/50 BSI split
        splitApplies = true;
        grossCommission = Math.round(netCommission * 2 * 100) / 100;
        theiShare = netCommission;
        bsiShare = netCommission;
        producerPayable = 0;
      }

      // LOB inference from plan_type / carrier
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

      // Parse effective_date (often MM/DD/YYYY string) -> YYYY-MM-DD
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
                lob = $8
          WHERE id = $9`,
        [source, policyWrittenDate, grossCommission, theiShare, bsiShare, producerPayable, splitApplies, lob, row.id]
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

module.exports = router;

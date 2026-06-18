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
    const { agent, agents, carrier, carriers, period, periods, classification, classifications, lob, lobs, planType, payee, search, upload_id, sortCol, sortDir = 'asc', limit = 100, offset = 0 } = req.query;
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
    if (lobs) { const list = lobs.split(',').map(l=>l.trim()).filter(Boolean); if (list.length) { where.push(`cr.lob = ANY($${idx++})`); params.push(list); } }
    else if (lob) { where.push(`cr.lob = $${idx++}`); params.push(lob); }
    if (planType) { where.push(`COALESCE(cr.plan_type,'') = $${idx++}`); params.push(planType); }
    if (upload_id) { where.push(`cr.upload_id = $${idx++}`); params.push(parseInt(upload_id)); }
    if (payee) { where.push(`cr.payee = $${idx++}`); params.push(payee); }
    if (search) { where.push(`(cr.client_full_name ILIKE $${idx} OR cr.agent_name ILIKE $${idx} OR cr.carrier ILIKE $${idx})`); params.push(`%${search}%`); idx++; }

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
        cr.upload_id, cr.payee, COALESCE(cr.mga, '') as mga,
        cr.raw_data, u.original_name as upload_name,
        cr.lob, cr.gross_commission, cr.thei_share, cr.bsi_share,
        cr.producer_payable, cr.sub_agent_override,
        cr.members, cr.statement_month,
        CASE WHEN ps.status = 'termed' THEN true ELSE false END as is_termed
       FROM commission_records cr 
       LEFT JOIN uploads u ON cr.upload_id = u.id
       LEFT JOIN policy_status ps 
         ON LOWER(TRIM(cr.client_full_name)) = LOWER(TRIM(ps.client_full_name))
         AND LOWER(TRIM(cr.carrier)) = LOWER(TRIM(ps.carrier))
         AND LOWER(TRIM(cr.agent_name)) = LOWER(TRIM(ps.agent_name))
       ${wc} ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`,
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

    // Agency view: exclude ACA Agent Commissions. Agent view: include everything.
    if (view !== 'agent') {
      where.push(`NOT (lob = 'ACA' AND classification ILIKE '%agent commission%')`);
    }
    where.push(`NOT (lob = 'ACA' AND classification ILIKE '%agent commission%')`);

    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [totalComm, totalRec, agentCnt, carrierCnt, byAgent, byCarrier, byPeriod, byLOB] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(commission),0) as total FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(*) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(DISTINCT agent_name) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(DISTINCT carrier) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT agent_name, SUM(commission) as total, COUNT(*) as count FROM commission_records ${wc} GROUP BY agent_name ORDER BY total DESC`, params),
      pool.query(`SELECT carrier, SUM(commission) as total, COUNT(*) as count FROM commission_records ${wc} GROUP BY carrier ORDER BY total DESC`, params),
      pool.query(`SELECT payment_period as period, SUM(commission) as total, COUNT(*) as count, ABS(SUM(CASE WHEN commission < 0 THEN commission ELSE 0 END)) as chargebacks FROM commission_records ${wc} GROUP BY payment_period ORDER BY payment_period ASC`, params),
      pool.query(`SELECT lob, SUM(commission) as total, SUM(COALESCE(producer_payable,0)) as agent_payable, SUM(COALESCE(thei_share,0)) as thei_total, COUNT(*) as count FROM commission_records ${wc} GROUP BY lob ORDER BY lob`, params),
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

    // Agency view: exclude ACA Agent Commissions. Agent view: include everything.
    if (view !== 'agent') {
      where.push(`NOT (lob = 'ACA' AND classification ILIKE '%agent commission%')`);
    }
    where.push(`NOT (lob = 'ACA' AND classification ILIKE '%agent commission%')`);

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

    let classifications = [];
    try {
      const classBase = baseWhere ? baseWhere + ` AND classification IS NOT NULL AND classification != ''` : `WHERE classification IS NOT NULL AND classification != ''`;
      const cl = await pool.query(`SELECT DISTINCT classification FROM commission_records ${classBase} ORDER BY classification`);
      const planTypeKeywords = /AARP|CSNP|DSNP|MAPD|PDP|MED SUP|MED ADV|MEDIGAP|SUPPLEMENT|HMO|PPO|Aetna|UnitedHealthcare|Humana|Cigna|Devoted|WellCare|Solis|Doctors|HealthSun/i;
      classifications = cl.rows.map(c => c.classification).filter(c => c && !planTypeKeywords.test(c));
    } catch (e) { console.log('classification not available:', e.message); }

    let lobs = [];
    try {
      const lobBase = baseWhere ? baseWhere + ` AND lob IS NOT NULL AND lob != ''` : `WHERE lob IS NOT NULL AND lob != ''`;
      const lb = await pool.query(`SELECT DISTINCT lob FROM commission_records ${lobBase} ORDER BY lob`);
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
    `);

    let updated = 0;
    let skipped = 0;
    const sources = { BSI: 0, NHP: 0, direct_carrier: 0, manual: 0 };

    for (const row of sel.rows) {
      const fn = String(row.upload_name || '').toLowerCase();
      const payeeLc = String(row.payee || '').toLowerCase();
      let source = 'manual';
      if (payeeLc === 'bsi' || /statement-the|statement_-the|broker_society|bsi/.test(fn)) source = 'BSI';
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
      let splitApplies, theiShare, bsiShare, producerPayable, grossCommission;

      if (isCommissionRow) {
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
      } else if (source === 'direct_carrier') {
        splitApplies = false;
        grossCommission = netCommission;
        theiShare = netCommission;
        bsiShare = 0;
        producerPayable = 0;
      } else {
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

// ─── FIX MED LOB ──────────────────────────────────────────────────────────────
router.post('/fix-med-lob', requireAuth, async (req, res) => {
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
router.post('/fix-aca-classifications', requireAuth, async (req, res) => {
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

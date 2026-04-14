const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { normalizeAllRecords } = require('../normalize');

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agent, agents, carrier, carriers, period, periods, classification, classifications, planType, payee, search, upload_id, limit = 500, offset = 0 } = req.query;
    let where = [], params = [], idx = 1;
    if (req.user.role === 'agent') { where.push(`cr.agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`); }
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
        cr.upload_id, cr.payee, u.original_name as upload_name
       FROM commission_records cr LEFT JOIN uploads u ON cr.upload_id = u.id ${wc} ORDER BY cr.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const total = await pool.query(`SELECT COUNT(*) as count FROM commission_records ${wc}`, params);
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

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agents, carriers, periods, classifications, planTypes } = req.query;
    let where = [], params = [], idx = 1;
    if (req.user.role === 'agent') { where.push(`agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`); }
    if (agents) { const list = agents.split(',').map(a=>a.trim()).filter(Boolean); if (list.length) { where.push(`agent_name = ANY($${idx++})`); params.push(list); } }
    if (carriers) { const list = carriers.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`carrier = ANY($${idx++})`); params.push(list); } }
    if (periods) { const list = periods.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`payment_period = ANY($${idx++})`); params.push(list); } }
    if (classifications) { const list = classifications.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`classification = ANY($${idx++})`); params.push(list); } }
    if (planTypes) { const list = planTypes.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`COALESCE(plan_type,'') = ANY($${idx++})`); params.push(list); } }
    const wc = where.length ? 'WHERE ' + where.join(' AND ').replace(/(?<![a-z_])(agent_name|carrier|payment_period|classification|plan_type|upload_id)/g, 'cr.$1') : '';
    const [totalComm, totalRec, agentCnt, carrierCnt, byAgent, byCarrier, byPeriod] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(commission),0) as total FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(*) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(DISTINCT agent_name) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT COUNT(DISTINCT carrier) as count FROM commission_records ${wc}`, params),
      pool.query(`SELECT agent_name, SUM(commission) as total, COUNT(*) as count FROM commission_records ${wc} GROUP BY agent_name ORDER BY total DESC`, params),
      pool.query(`SELECT carrier, SUM(commission) as total, COUNT(*) as count FROM commission_records ${wc} GROUP BY carrier ORDER BY total DESC`, params),
      pool.query(`SELECT payment_period, SUM(commission) as total, COUNT(*) as count FROM commission_records ${wc} GROUP BY payment_period ORDER BY payment_period DESC LIMIT 12`, params),
    ]);
    res.json({
      totalCommission: parseFloat(totalComm.rows[0].total),
      totalRecords: parseInt(totalRec.rows[0].count),
      agentCount: parseInt(agentCnt.rows[0].count),
      carrierCount: parseInt(carrierCnt.rows[0].count),
      byAgent: byAgent.rows, byCarrier: byCarrier.rows, byPeriod: byPeriod.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/kpi', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agents, carriers, periods, classifications, planTypes } = req.query;
    let where = [], params = [], idx = 1;
    if (req.user.role === 'agent') { where.push(`agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`); }
    if (agents) { const list = agents.split(',').map(a=>a.trim()).filter(Boolean); if (list.length) { where.push(`agent_name = ANY($${idx++})`); params.push(list); } }
    if (carriers) { const list = carriers.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`carrier = ANY($${idx++})`); params.push(list); } }
    if (periods) { const list = periods.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`payment_period = ANY($${idx++})`); params.push(list); } }
    if (classifications) { const list = classifications.split(',').map(c=>c.trim()).filter(Boolean); if (list.length) { where.push(`classification = ANY($${idx++})`); params.push(list); } }
    if (planTypes) { const list = planTypes.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`COALESCE(plan_type,'') = ANY($${idx++})`); params.push(list); } }
    const wc = where.length ? 'WHERE ' + where.join(' AND ').replace(/(?<![a-z_])(agent_name|carrier|payment_period|classification|plan_type|upload_id)/g, 'cr.$1') : '';
    const rows = await pool.query(`
      SELECT agent_name,
        COUNT(*) as total_count,
        COALESCE(SUM(commission), 0) as total_commission,
        COALESCE(SUM(CASE WHEN commission < 0 THEN ABS(commission) ELSE 0 END), 0) as chargeback_amount,
        COUNT(CASE WHEN commission < 0 THEN 1 END) as chargeback_count,
        COALESCE(SUM(CASE WHEN classification ILIKE '%advance%' THEN commission ELSE 0 END), 0) as advance_amount,
        COUNT(CASE WHEN classification ILIKE '%advance%' THEN 1 END) as advance_count,
        COUNT(CASE WHEN classification = 'Agent Commission' OR classification = 'Agency Override' THEN 1 END) as new_apps
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
    const agents2 = rows.rows.map(r => {
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
    res.json({ agents: agents2, totals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/missing-renewals', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { lastPeriod, thisPeriod } = req.query;
    if (!lastPeriod || !thisPeriod) return res.status(400).json({ error: 'lastPeriod and thisPeriod required' });
    const af = req.user.role === 'admin' ? '' : `AND agent_name ILIKE '%${req.user.name}%'`;
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
    const isAdmin = req.user.role === 'admin';
    const baseWhere = isAdmin ? '' : `WHERE agent_name ILIKE '%${req.user.name}%'`;

    const [agents, carriers, periods] = await Promise.all([
      pool.query(`SELECT DISTINCT agent_name FROM commission_records ${baseWhere} ORDER BY agent_name`),
      pool.query(`SELECT DISTINCT carrier FROM commission_records ${baseWhere} ORDER BY carrier`),
      pool.query(`SELECT DISTINCT payment_period FROM commission_records ${baseWhere} ORDER BY payment_period DESC`)
    ]);

    // plan_type may not exist yet — try it separately and fallback to empty
    let planTypes = [];
    try {
      const planWhere = isAdmin
        ? `WHERE plan_type IS NOT NULL AND plan_type != ''`
        : `WHERE agent_name ILIKE '%${req.user.name}%' AND plan_type IS NOT NULL AND plan_type != ''`;
      const pt = await pool.query(`SELECT DISTINCT plan_type FROM commission_records ${planWhere} ORDER BY plan_type`);
      planTypes = pt.rows.map(p => p.plan_type).filter(Boolean);
    } catch (e) {
      // column doesn't exist yet — that's fine, return empty
      console.log('plan_type column not yet available:', e.message);
    }

    // payee — try separately with fallback
    let payees = [];
    try {
      const payeeWhere = isAdmin
        ? `WHERE payee IS NOT NULL AND payee != ''`
        : `WHERE agent_name ILIKE '%${req.user.name}%' AND payee IS NOT NULL AND payee != ''`;
      const py = await pool.query(`SELECT DISTINCT payee FROM commission_records ${payeeWhere} ORDER BY payee`);
      payees = py.rows.map(p => p.payee).filter(Boolean);
    } catch (e) {
      console.log('payee column not available:', e.message);
    }

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

module.exports = router;

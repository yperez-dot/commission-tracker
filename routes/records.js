const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { normalizeAgentName, normalizeAllRecords } = require('../normalize');

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agent, carrier, period, classification, planType, limit = 500, offset = 0 } = req.query;
    let where = [], params = [], idx = 1;
    if (req.user.role === 'agent') { where.push(`agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`); }
    if (agent) { where.push(`agent_name = $${idx++}`); params.push(agent); }
    if (carrier) { where.push(`carrier = $${idx++}`); params.push(carrier); }
    if (period) { where.push(`payment_period = $${idx++}`); params.push(period); }
    if (classification) { where.push(`classification = $${idx++}`); params.push(classification); }
    if (planType) { where.push(`plan_type = $${idx++}`); params.push(planType); }
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const records = await pool.query(
      `SELECT id, agent_name, carrier, plan_type, client_full_name, effective_date, premium, commission, classification, payment_period, policy_number, created_at FROM commission_records ${wc} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const total = await pool.query(`SELECT COUNT(*) as count FROM commission_records ${wc}`, params);
    res.json({ records: records.rows, total: parseInt(total.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete a single commission record
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM commission_records WHERE id = $1', [req.params.id]);
    res.json({ success: true });
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
    if (planTypes) { const list = planTypes.split(',').map(p=>p.trim()).filter(Boolean); if (list.length) { where.push(`plan_type = ANY($${idx++})`); params.push(list); } }
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';
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
    const af = req.user.role === 'admin' ? '' : `WHERE agent_name ILIKE '%${req.user.name}%'`;
    const wf = req.user.role === 'admin' ? `WHERE plan_type IS NOT NULL AND plan_type != ''` : `WHERE agent_name ILIKE '%${req.user.name}%' AND plan_type IS NOT NULL AND plan_type != ''`;
    const [agents, carriers, periods, planTypes] = await Promise.all([
      pool.query(`SELECT DISTINCT agent_name FROM commission_records ${af} ORDER BY agent_name`),
      pool.query(`SELECT DISTINCT carrier FROM commission_records ${af} ORDER BY carrier`),
      pool.query(`SELECT DISTINCT payment_period FROM commission_records ${af} ORDER BY payment_period DESC`),
      pool.query(`SELECT DISTINCT plan_type FROM commission_records ${wf} ORDER BY plan_type`)
    ]);
    res.json({
      agents: agents.rows.map(a=>a.agent_name).filter(Boolean),
      carriers: carriers.rows.map(c=>c.carrier).filter(Boolean),
      periods: periods.rows.map(p=>p.payment_period).filter(Boolean),
      planTypes: planTypes.rows.map(p=>p.plan_type).filter(Boolean)
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

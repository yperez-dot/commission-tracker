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
    const { agent, carrier, period, classification, limit = 500, offset = 0 } = req.query;

    let where = [];
    let params = [];
    let idx = 1;

    if (req.user.role === 'agent') {
      where.push(`agent_name ILIKE $${idx++}`);
      params.push(`%${req.user.name}%`);
    }
    if (agent) { where.push(`agent_name = $${idx++}`); params.push(agent); }
    if (carrier) { where.push(`carrier = $${idx++}`); params.push(carrier); }
    if (period) { where.push(`payment_period = $${idx++}`); params.push(period); }
    if (classification) { where.push(`classification = $${idx++}`); params.push(classification); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const records = await pool.query(
      `SELECT id, agent_name, carrier, client_full_name, effective_date, premium, commission, classification, payment_period, policy_number, created_at
       FROM commission_records ${whereClause}
       ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const total = await pool.query(
      `SELECT COUNT(*) as count FROM commission_records ${whereClause}`,
      params
    );

    res.json({ records: records.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agents, carriers, periods, classifications, agentName } = req.query;

    let where = [];
    let params = [];
    let idx = 1;

    // Role-based filtering
    if (req.user.role === 'agent') {
      where.push(`agent_name ILIKE $${idx++}`);
      params.push(`%${req.user.name}%`);
    }

    // Dashboard filter params (comma-separated lists)
    if (agents) {
      const agentList = agents.split(',').map(a => a.trim()).filter(Boolean);
      if (agentList.length) {
        where.push(`agent_name = ANY($${idx++})`);
        params.push(agentList);
      }
    }
    if (carriers) {
      const carrierList = carriers.split(',').map(c => c.trim()).filter(Boolean);
      if (carrierList.length) {
        where.push(`carrier = ANY($${idx++})`);
        params.push(carrierList);
      }
    }
    if (periods) {
      const periodList = periods.split(',').map(p => p.trim()).filter(Boolean);
      if (periodList.length) {
        where.push(`payment_period = ANY($${idx++})`);
        params.push(periodList);
      }
    }
    if (classifications) {
      const classList = classifications.split(',').map(c => c.trim()).filter(Boolean);
      if (classList.length) {
        where.push(`classification = ANY($${idx++})`);
        params.push(classList);
      }
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const totalCommission = await pool.query(`SELECT COALESCE(SUM(commission),0) as total FROM commission_records ${whereClause}`, params);
    const totalRecords = await pool.query(`SELECT COUNT(*) as count FROM commission_records ${whereClause}`, params);
    const agentCount = await pool.query(`SELECT COUNT(DISTINCT agent_name) as count FROM commission_records ${whereClause}`, params);
    const carrierCount = await pool.query(`SELECT COUNT(DISTINCT carrier) as count FROM commission_records ${whereClause}`, params);

    const byAgent = await pool.query(
      `SELECT agent_name, SUM(commission) as total, COUNT(*) as count FROM commission_records ${whereClause} GROUP BY agent_name ORDER BY total DESC`,
      params
    );
    const byCarrier = await pool.query(
      `SELECT carrier, SUM(commission) as total, COUNT(*) as count FROM commission_records ${whereClause} GROUP BY carrier ORDER BY total DESC`,
      params
    );
    const byPeriod = await pool.query(
      `SELECT payment_period, SUM(commission) as total, COUNT(*) as count FROM commission_records ${whereClause} GROUP BY payment_period ORDER BY payment_period DESC LIMIT 12`,
      params
    );

    res.json({
      totalCommission: parseFloat(totalCommission.rows[0].total),
      totalRecords: parseInt(totalRecords.rows[0].count),
      agentCount: parseInt(agentCount.rows[0].count),
      carrierCount: parseInt(carrierCount.rows[0].count),
      byAgent: byAgent.rows,
      byCarrier: byCarrier.rows,
      byPeriod: byPeriod.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/missing-renewals', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { lastPeriod, thisPeriod } = req.query;
    if (!lastPeriod || !thisPeriod) return res.status(400).json({ error: 'lastPeriod and thisPeriod required' });

    const isAdmin = req.user.role === 'admin';
    const agentFilter = isAdmin ? '' : `AND agent_name ILIKE '%${req.user.name}%'`;

    const lastMonth = await pool.query(
      `SELECT agent_name, carrier, client_full_name, commission FROM commission_records WHERE payment_period = $1 ${agentFilter}`,
      [lastPeriod]
    );
    const thisMonth = await pool.query(
      `SELECT agent_name, carrier, client_full_name, commission FROM commission_records WHERE payment_period = $1 ${agentFilter}`,
      [thisPeriod]
    );

    const thisMonthKeys = new Set(
      thisMonth.rows.map(r => `${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase())
    );
    const lastMonthKeys = new Set(
      lastMonth.rows.map(r => `${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase())
    );

    const missing = lastMonth.rows.filter(r =>
      !thisMonthKeys.has(`${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase())
    );
    const newClients = thisMonth.rows.filter(r =>
      !lastMonthKeys.has(`${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase())
    );

    const lostRevenue = missing.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);

    res.json({
      lastPeriodCount: lastMonth.rows.length,
      thisPeriodCount: thisMonth.rows.length,
      missing,
      newClients,
      lostRevenue
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/filters', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.role === 'admin';
    const agentFilter = isAdmin ? '' : `WHERE agent_name ILIKE '%${req.user.name}%'`;

    const agents = await pool.query(`SELECT DISTINCT agent_name FROM commission_records ${agentFilter} ORDER BY agent_name`);
    const carriers = await pool.query(`SELECT DISTINCT carrier FROM commission_records ${agentFilter} ORDER BY carrier`);
    const periods = await pool.query(`SELECT DISTINCT payment_period FROM commission_records ${agentFilter} ORDER BY payment_period DESC`);

    res.json({
      agents: agents.rows.map(a => a.agent_name).filter(Boolean),
      carriers: carriers.rows.map(c => c.carrier).filter(Boolean),
      periods: periods.rows.map(p => p.payment_period).filter(Boolean)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/normalize-agents', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const updated = await normalizeAllRecords(pool);
    res.json({ success: true, updated, message: `Normalized ${updated} records` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

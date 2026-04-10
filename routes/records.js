const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { agent, carrier, period, classification, limit = 500, offset = 0 } = req.query;

  let where = [];
  let params = [];

  if (req.user.role === 'agent') {
    where.push('agent_name = ?');
    params.push(req.user.name);
  }
  if (agent) { where.push('agent_name = ?'); params.push(agent); }
  if (carrier) { where.push('carrier = ?'); params.push(carrier); }
  if (period) { where.push('payment_period = ?'); params.push(period); }
  if (classification) { where.push('classification = ?'); params.push(classification); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const records = db.prepare(`
    SELECT id, agent_name, carrier, client_full_name, effective_date,
           premium, commission, classification, payment_period, policy_number, created_at
    FROM commission_records ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), parseInt(offset));

  const total = db.prepare(`SELECT COUNT(*) as count FROM commission_records ${whereClause}`).get(...params);

  res.json({ records, total: total.count });
});

router.get('/summary', requireAuth, (req, res) => {
  const db = getDb();

  const isAdmin = req.user.role === 'admin';
  const agentFilter = isAdmin ? '' : 'WHERE agent_name = ?';
  const agentParam = isAdmin ? [] : [req.user.name];

  const totalCommission = db.prepare(`SELECT COALESCE(SUM(commission),0) as total FROM commission_records ${agentFilter}`).get(...agentParam);
  const totalRecords = db.prepare(`SELECT COUNT(*) as count FROM commission_records ${agentFilter}`).get(...agentParam);
  const agents = db.prepare(`SELECT DISTINCT agent_name FROM commission_records ${agentFilter} ORDER BY agent_name`).all(...agentParam);
  const carriers = db.prepare(`SELECT DISTINCT carrier FROM commission_records ${agentFilter} ORDER BY carrier`).all(...agentParam);
  const periods = db.prepare(`SELECT DISTINCT payment_period FROM commission_records ${agentFilter} ORDER BY payment_period DESC`).all(...agentParam);

  const byAgent = db.prepare(`
    SELECT agent_name, SUM(commission) as total, COUNT(*) as count
    FROM commission_records ${agentFilter}
    GROUP BY agent_name ORDER BY total DESC
  `).all(...agentParam);

  const byCarrier = db.prepare(`
    SELECT carrier, SUM(commission) as total, COUNT(*) as count
    FROM commission_records ${agentFilter}
    GROUP BY carrier ORDER BY total DESC
  `).all(...agentParam);

  const byPeriod = db.prepare(`
    SELECT payment_period, SUM(commission) as total, COUNT(*) as count
    FROM commission_records ${agentFilter}
    GROUP BY payment_period ORDER BY payment_period DESC LIMIT 12
  `).all(...agentParam);

  const byClass = db.prepare(`
    SELECT classification, SUM(commission) as total, COUNT(*) as count
    FROM commission_records ${agentFilter}
    GROUP BY classification ORDER BY total DESC
  `).all(...agentParam);

  res.json({
    totalCommission: totalCommission.total,
    totalRecords: totalRecords.count,
    agentCount: agents.length,
    carrierCount: carriers.length,
    agents: agents.map(a => a.agent_name),
    carriers: carriers.map(c => c.carrier),
    periods: periods.map(p => p.payment_period),
    byAgent,
    byCarrier,
    byPeriod,
    byClass
  });
});

router.get('/missing-renewals', requireAuth, (req, res) => {
  const db = getDb();
  const { lastPeriod, thisPeriod } = req.query;
  if (!lastPeriod || !thisPeriod) return res.status(400).json({ error: 'lastPeriod and thisPeriod required' });

  const isAdmin = req.user.role === 'admin';
  const agentFilter = isAdmin ? '' : 'AND agent_name = ?';
  const agentParam = isAdmin ? [] : [req.user.name];

  const lastMonth = db.prepare(`
    SELECT agent_name, carrier, client_full_name, commission
    FROM commission_records
    WHERE payment_period = ? ${agentFilter}
  `).all(lastPeriod, ...agentParam);

  const thisMonth = db.prepare(`
    SELECT agent_name, carrier, client_full_name, commission
    FROM commission_records
    WHERE payment_period = ? ${agentFilter}
  `).all(thisPeriod, ...agentParam);

  const thisMonthKeys = new Set(
    thisMonth.map(r => `${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase())
  );

  const missing = lastMonth.filter(r =>
    !thisMonthKeys.has(`${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase())
  );

  const newClients = thisMonth.filter(r => {
    const lastKeys = new Set(lastMonth.map(x => `${x.agent_name}|${x.carrier}|${x.client_full_name}`.toLowerCase()));
    return !lastKeys.has(`${r.agent_name}|${r.carrier}|${r.client_full_name}`.toLowerCase());
  });

  const lostRevenue = missing.reduce((s, r) => s + (r.commission || 0), 0);

  res.json({
    lastPeriodCount: lastMonth.length,
    thisPeriodCount: thisMonth.length,
    missing,
    newClients,
    lostRevenue
  });
});

router.get('/filters', requireAuth, (req, res) => {
  const db = getDb();
  const isAdmin = req.user.role === 'admin';
  const agentFilter = isAdmin ? '' : 'WHERE agent_name = ?';
  const agentParam = isAdmin ? [] : [req.user.name];

  const agents = db.prepare(`SELECT DISTINCT agent_name FROM commission_records ${agentFilter} ORDER BY agent_name`).all(...agentParam);
  const carriers = db.prepare(`SELECT DISTINCT carrier FROM commission_records ${agentFilter} ORDER BY carrier`).all(...agentParam);
  const periods = db.prepare(`SELECT DISTINCT payment_period FROM commission_records ${agentFilter} ORDER BY payment_period DESC`).all(...agentParam);

  res.json({
    agents: agents.map(a => a.agent_name).filter(Boolean),
    carriers: carriers.map(c => c.carrier).filter(Boolean),
    periods: periods.map(p => p.payment_period).filter(Boolean)
  });
});

module.exports = router;

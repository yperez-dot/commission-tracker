'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');
const {
  resolvePassThroughLiableAgent,
  listPassThroughAgents,
  WRITER_PASS_THROUGH_AGENTS,
} = require('../src/writerPassThroughAgents');

async function ensurePassThroughSchema(pool) {
  await pool.query(`
    ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS liable_agent TEXT;
    ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS pass_through_collected BOOLEAN DEFAULT FALSE;
    ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS pass_through_collected_at TIMESTAMPTZ;
    ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS pass_through_notes TEXT;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_records_liable_agent
      ON commission_records (liable_agent)
      WHERE liable_agent IS NOT NULL
  `);
}

function normalizeClientKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function lookupMedicareProAgents(pool, clientNames) {
  const map = new Map();
  const unique = [...new Set(clientNames.filter(Boolean))];
  for (const client of unique) {
    const r = await pool.query(
      `SELECT agent_name FROM medicarepro_sales
       WHERE client_name ILIKE $1 AND agent_name IS NOT NULL AND TRIM(agent_name) <> ''
       ORDER BY uploaded_at DESC NULLS LAST
       LIMIT 1`,
      [`%${client.split(',')[0].trim()}%`]
    );
    if (r.rows[0]?.agent_name) {
      map.set(normalizeClientKey(client), r.rows[0].agent_name);
    }
  }
  return map;
}

async function backfillLiableAgents(pool, { dryRun = false } = {}) {
  await ensurePassThroughSchema(pool);

  const rows = await pool.query(`
    SELECT id, agent_name, client_full_name, commission, liable_agent
    FROM commission_records
    WHERE commission < 0
      AND (liable_agent IS NULL OR TRIM(liable_agent) = '')
    ORDER BY id
  `);

  const saleAgentMap = await lookupMedicareProAgents(
    pool,
    rows.rows.map((r) => r.client_full_name)
  );

  let updated = 0;
  const preview = [];

  for (const row of rows.rows) {
    const saleAgent = saleAgentMap.get(normalizeClientKey(row.client_full_name)) || null;
    const liable = resolvePassThroughLiableAgent({
      agentName: row.agent_name,
      clientName: row.client_full_name,
      commission: row.commission,
      saleAgentName: saleAgent,
    });
    if (!liable) continue;

    preview.push({
      id: row.id,
      client: row.client_full_name,
      agent_name: row.agent_name,
      commission: row.commission,
      liable_agent: liable,
    });

    if (!dryRun) {
      await pool.query('UPDATE commission_records SET liable_agent = $1 WHERE id = $2', [liable, row.id]);
      updated += 1;
    }
  }

  return { scanned: rows.rows.length, matched: preview.length, updated: dryRun ? 0 : updated, preview: preview.slice(0, 50) };
}

/** GET /api/pass-through/agents */
router.get('/agents', requireAuth, requireAdmin, async (_req, res) => {
  res.json({ agents: listPassThroughAgents() });
});

/** GET /api/pass-through/chargebacks?period=&agent=&collected= */
router.get('/chargebacks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await ensurePassThroughSchema(pool);

    const period = String(req.query.period || '').trim();
    const agent = String(req.query.agent || '').trim();
    const collected = String(req.query.collected || 'all').toLowerCase();

    const where = ['cr.commission < 0', 'cr.liable_agent IS NOT NULL', "TRIM(cr.liable_agent) <> ''"];
    const params = [];
    let idx = 1;

    if (period) {
      where.push(`cr.payment_period = $${idx++}`);
      params.push(period);
    }
    if (agent) {
      where.push(`cr.liable_agent = $${idx++}`);
      params.push(agent);
    }
    if (collected === 'yes') where.push('cr.pass_through_collected = TRUE');
    if (collected === 'no') where.push('COALESCE(cr.pass_through_collected, FALSE) = FALSE');

    const wc = `WHERE ${where.join(' AND ')}`;

    const rows = await pool.query(
      `SELECT cr.id, cr.liable_agent, cr.agent_name AS writing_agent, cr.client_full_name,
              cr.carrier, cr.payment_period, cr.commission, cr.classification,
              cr.effective_date, cr.pass_through_collected, cr.pass_through_collected_at,
              cr.pass_through_notes
       FROM commission_records cr
       ${wc}
       ORDER BY cr.payment_period DESC, cr.liable_agent, cr.client_full_name`,
      params
    );

    const summary = await pool.query(
      `SELECT cr.liable_agent,
              COUNT(*)::int AS chargeback_count,
              COALESCE(SUM(ABS(cr.commission)), 0) AS total_owed,
              COALESCE(SUM(CASE WHEN cr.pass_through_collected THEN ABS(cr.commission) ELSE 0 END), 0) AS total_collected,
              COALESCE(SUM(CASE WHEN NOT COALESCE(cr.pass_through_collected, FALSE) THEN ABS(cr.commission) ELSE 0 END), 0) AS total_outstanding
       FROM commission_records cr
       ${wc}
       GROUP BY cr.liable_agent
       ORDER BY cr.liable_agent`,
      params
    );

    const periods = await pool.query(
      `SELECT DISTINCT payment_period FROM commission_records
       WHERE commission < 0 AND liable_agent IS NOT NULL AND TRIM(liable_agent) <> ''
       ORDER BY payment_period DESC`
    );

    res.json({
      rows: rows.rows,
      summary: summary.rows,
      periods: periods.rows.map((r) => r.payment_period).filter(Boolean),
      agents: WRITER_PASS_THROUGH_AGENTS.map((a) => a.canonicalName),
    });
  } catch (err) {
    console.error('[pass-through/chargebacks]', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/pass-through/backfill?dryRun=1 */
router.post('/backfill', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
    const result = await backfillLiableAgents(pool, { dryRun });
    res.json({ dryRun, ...result });
  } catch (err) {
    console.error('[pass-through/backfill]', err);
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/pass-through/collections/:id */
router.patch('/collections/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await ensurePassThroughSchema(pool);
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const { collected, notes } = req.body || {};
    const isCollected = collected !== false;

    const r = await pool.query(
      `UPDATE commission_records
       SET pass_through_collected = $1,
           pass_through_collected_at = CASE WHEN $1 THEN COALESCE(pass_through_collected_at, NOW()) ELSE NULL END,
           pass_through_notes = COALESCE($2, pass_through_notes)
       WHERE id = $3 AND liable_agent IS NOT NULL
       RETURNING id, liable_agent, client_full_name, commission, pass_through_collected, pass_through_collected_at, pass_through_notes`,
      [isCollected, notes || null, id]
    );

    if (!r.rows.length) return res.status(404).json({ error: 'Record not found or not a pass-through chargeback' });
    res.json({ row: r.rows[0] });
  } catch (err) {
    console.error('[pass-through/collections]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, ensurePassThroughSchema, backfillLiableAgents, resolvePassThroughLiableAgent };

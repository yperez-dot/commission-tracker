'use strict';

/**
 * Change log (audit trail) — who did what, when.
 *
 * Records commission upload events (created / deleted / renamed), manual record
 * edits / deletes, and payroll events (lock / unlock, adjustments, payments,
 * month close, statements, deposits).
 *
 *   logChange(pool, req, { type, entityType, entityId, period, payee, summary, details })
 *     never throws — a logging failure must not break the action being logged.
 *   GET /api/change-log ?type=&user=&period=&payee=&q=&limit=&offset=
 *
 * Table self-creates on first use (CREATE TABLE IF NOT EXISTS), same as
 * payee_statements, so nothing has to be run by hand on Railway.
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { requirePayrollStaff } = require('./payrollRoles');

let ready = false;
async function ensureChangeLog(pool) {
  if (ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS change_log (
      id SERIAL PRIMARY KEY,
      agency_key TEXT NOT NULL DEFAULT 'thei',
      event_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      payment_period TEXT,
      payee TEXT,
      actor TEXT,
      actor_role TEXT,
      summary TEXT,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_change_log_created ON change_log (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_change_log_type ON change_log (event_type, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_change_log_period ON change_log (payment_period)`);
  ready = true;
}

function actorOf(req) {
  const u = (req && req.user) || {};
  return u.name || u.email || u.username || null;
}

function agencyOf(req) {
  const raw = (req && ((req.query && req.query.agency) || (req.body && req.body.agency) ||
    (req.headers && req.headers['x-agency-override']) || (req.user && req.user.agency))) || 'thei';
  const s = String(raw || 'thei').toLowerCase();
  return s.includes('broker society') || s === 'bsi' ? 'bsi' : 'thei';
}

async function logChange(pool, req, ev) {
  try {
    const p = pool || getPool();
    await ensureChangeLog(p);
    const e = ev || {};
    await p.query(
      `INSERT INTO change_log (agency_key, event_type, entity_type, entity_id, payment_period, payee,
                               actor, actor_role, summary, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [e.agencyKey || agencyOf(req), e.type, e.entityType || null,
        e.entityId != null ? String(e.entityId) : null, e.period || null, e.payee || null,
        e.actor || actorOf(req), (req && req.user && req.user.role) || null,
        e.summary || null, e.details ? JSON.stringify(e.details) : null]
    );
  } catch (err) {
    console.error('[change-log] failed to record', ev && ev.type, err.message);
  }
}

/** GET /api/change-log */
router.get('/', requireAuth, requirePayrollStaff, async (req, res) => {
  try {
    const pool = getPool();
    await ensureChangeLog(pool);
    const where = ['1=1'];
    const params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.type) {
      // "upload" matches upload.created / upload.deleted / upload.renamed
      const t = String(req.query.type);
      if (t.includes('.')) add('event_type = ?', t); else add('event_type LIKE ?', `${t}.%`);
    }
    if (req.query.user) add('actor ILIKE ?', `%${req.query.user}%`);
    if (req.query.period) add('payment_period = ?', String(req.query.period));
    if (req.query.payee) add('payee ILIKE ?', `%${req.query.payee}%`);
    if (req.query.q) add('summary ILIKE ?', `%${req.query.q}%`);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const offset = parseInt(req.query.offset, 10) || 0;
    const rows = await pool.query(
      `SELECT id, agency_key, event_type, entity_type, entity_id, payment_period, payee, actor, actor_role,
              summary, details, created_at
         FROM change_log WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const users = await pool.query(`SELECT DISTINCT actor FROM change_log WHERE actor IS NOT NULL ORDER BY actor`);
    res.json({ entries: rows.rows, users: users.rows.map((r) => r.actor) });
  } catch (err) {
    console.error('[change-log] list', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.logChange = logChange;
module.exports.ensureChangeLog = ensureChangeLog;

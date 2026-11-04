'use strict';

/**
 * payment_holds — per-payee effective-on-or-after holds for house statements.
 * Self-creates. migrations/015_payment_holds.sql has the same DDL for
 * reference / manual runs.
 */

const { normalizePayeeKey, parseEffectiveYmd, rowToHold } = require('../src/paymentHold');

let ready = false;

async function ensureHoldTable(pool) {
  if (ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_holds (
      id SERIAL PRIMARY KEY,
      payee_key TEXT NOT NULL,
      effective_on_or_after DATE NOT NULL,
      note TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      released_by TEXT,
      released_at TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_holds_payee
    ON payment_holds (payee_key, released_at)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_holds_active
    ON payment_holds (payee_key) WHERE released_at IS NULL`);
  ready = true;
}

async function listHolds(pool, opts) {
  await ensureHoldTable(pool);
  const activeOnly = opts && opts.activeOnly;
  const payeeKey = opts && opts.payeeKey ? normalizePayeeKey(opts.payeeKey) : '';
  const where = [];
  const params = [];
  if (activeOnly) where.push('released_at IS NULL');
  if (payeeKey) {
    params.push(payeeKey);
    where.push('payee_key = $' + params.length);
  }
  const sql =
    `SELECT * FROM payment_holds` +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY created_at DESC, id DESC';
  const r = await pool.query(sql, params);
  return r.rows.map(rowToHold);
}

async function loadActiveHolds(pool) {
  return listHolds(pool, { activeOnly: true });
}

async function activeHoldFor(pool, payeeKey) {
  const key = normalizePayeeKey(payeeKey);
  if (!key) return null;
  const rows = await listHolds(pool, { activeOnly: true, payeeKey: key });
  return rows[0] || null;
}

async function createHold(pool, { payeeKey, effectiveOnOrAfter, note, createdBy }) {
  await ensureHoldTable(pool);
  const key = normalizePayeeKey(payeeKey);
  const ymd = parseEffectiveYmd(effectiveOnOrAfter);
  if (!key) {
    const err = new Error('payeeKey is required');
    err.status = 400;
    throw err;
  }
  if (!ymd) {
    const err = new Error('effectiveOnOrAfter must be a date (e.g. 2027-01-01)');
    err.status = 400;
    throw err;
  }
  const existing = await activeHoldFor(pool, key);
  if (existing) {
    const err = new Error('An active hold already exists for ' + key + '. Release it first.');
    err.status = 409;
    throw err;
  }
  const r = await pool.query(
    `INSERT INTO payment_holds (payee_key, effective_on_or_after, note, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [key, ymd, note != null && String(note).trim() ? String(note).trim() : null, createdBy || null]
  );
  return rowToHold(r.rows[0]);
}

async function releaseHold(pool, id, releasedBy) {
  await ensureHoldTable(pool);
  const hid = parseInt(id, 10);
  if (!hid) {
    const err = new Error('Hold id is required');
    err.status = 400;
    throw err;
  }
  const found = await pool.query('SELECT * FROM payment_holds WHERE id = $1', [hid]);
  if (!found.rows[0]) {
    const err = new Error('Hold not found');
    err.status = 404;
    throw err;
  }
  if (found.rows[0].released_at) {
    const err = new Error('Hold is already released');
    err.status = 409;
    throw err;
  }
  const r = await pool.query(
    `UPDATE payment_holds
        SET released_at = NOW(), released_by = $2
      WHERE id = $1 AND released_at IS NULL
      RETURNING *`,
    [hid, releasedBy || null]
  );
  return rowToHold(r.rows[0]);
}

module.exports = {
  ensureHoldTable,
  listHolds,
  loadActiveHolds,
  activeHoldFor,
  createHold,
  releaseHold,
};

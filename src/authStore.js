'use strict';

/**
 * Database access for sign-in, 2FA and the auth_events security log.
 * The schema self-applies (idempotently, under an advisory lock) the first
 * time any auth code runs, so no manual migration is needed on Railway.
 */

const { getPool } = require('../db/database');
const { hashBackupCode, verifyBackupCodeHash } = require('./authCrypto');

const SCHEMA_LOCK_ID = 72016001; // arbitrary constant for pg_advisory_xact_lock

const SCHEMA_SQL = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS agency TEXT DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret_enc TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS user_backup_codes (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     code_hash TEXT NOT NULL,
     used_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_user_backup_codes_user ON user_backup_codes(user_id) WHERE used_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS auth_events (
     id BIGSERIAL PRIMARY KEY,
     event_type TEXT NOT NULL,
     user_id INTEGER,
     actor_user_id INTEGER,
     email TEXT,
     ip TEXT,
     user_agent TEXT,
     detail JSONB,
     created_at TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_events_created ON auth_events(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, created_at DESC)`,
];

let schemaPromise = null;

async function applySchema(pool) {
  if (typeof pool.connect !== 'function') {
    for (const sql of SCHEMA_SQL) await pool.query(sql);
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_ID]);
    for (const sql of SCHEMA_SQL) await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function ensureAuthSchema() {
  if (!schemaPromise) {
    schemaPromise = applySchema(getPool()).catch((err) => {
      schemaPromise = null; // retry next request
      console.error('auth schema init failed:', err.message);
      throw err;
    });
  }
  return schemaPromise;
}

const USER_COLUMNS = `id, name, email, password_hash, role, COALESCE(agency, '') AS agency,
  totp_secret_enc, totp_pending_secret_enc, totp_enabled_at, totp_last_step,
  COALESCE(session_version, 0) AS session_version`;

async function q(sql, params) {
  await ensureAuthSchema();
  return getPool().query(sql, params);
}

async function findUserByEmail(email) {
  const r = await q(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1 LIMIT 1`, [String(email || '').toLowerCase().trim()]);
  return r.rows[0] || null;
}

async function findUserById(id) {
  const r = await q(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`, [id]);
  return r.rows[0] || null;
}

async function setPendingTotpSecret(userId, enc) {
  await q(`UPDATE users SET totp_pending_secret_enc = $2 WHERE id = $1`, [userId, enc]);
}

/** Activates 2FA only if it isn't already on (guards against a double-submit race). */
async function activateTotp(userId, enc, step) {
  const r = await q(
    `UPDATE users
        SET totp_secret_enc = $2, totp_pending_secret_enc = NULL,
            totp_enabled_at = NOW(), totp_last_step = $3
      WHERE id = $1 AND totp_enabled_at IS NULL
      RETURNING id`,
    [userId, enc, step]
  );
  return r.rows.length === 1;
}

/** Atomically advances the last-used TOTP step; false means the code was already used. */
async function advanceTotpStep(userId, step) {
  const r = await q(
    `UPDATE users SET totp_last_step = $2
      WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
      RETURNING id`,
    [userId, step]
  );
  return r.rows.length === 1;
}

async function replaceBackupCodes(userId, codes) {
  await q(`DELETE FROM user_backup_codes WHERE user_id = $1`, [userId]);
  for (const code of codes) {
    await q(`INSERT INTO user_backup_codes (user_id, code_hash) VALUES ($1, $2)`, [userId, hashBackupCode(code)]);
  }
}

/** Finds a matching unused code and burns it atomically. Returns remaining count or -1. */
async function consumeBackupCode(userId, code) {
  const r = await q(`SELECT id, code_hash FROM user_backup_codes WHERE user_id = $1 AND used_at IS NULL ORDER BY id`, [userId]);
  let matchId = null;
  for (const row of r.rows) {
    // Check every row so timing doesn't reveal which position matched.
    if (verifyBackupCodeHash(code, row.code_hash) && matchId === null) matchId = row.id;
  }
  if (matchId === null) return -1;
  const upd = await q(`UPDATE user_backup_codes SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id`, [matchId]);
  if (upd.rows.length !== 1) return -1;
  return r.rows.length - 1;
}

async function countUnusedBackupCodes(userId) {
  const r = await q(`SELECT COUNT(*)::int AS n FROM user_backup_codes WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  return (r.rows[0] && r.rows[0].n) || 0;
}

/** Turns 2FA off for a user and signs out all their sessions. */
async function resetMfa(userId) {
  const r = await q(
    `UPDATE users
        SET totp_secret_enc = NULL, totp_pending_secret_enc = NULL,
            totp_enabled_at = NULL, totp_last_step = NULL,
            session_version = COALESCE(session_version, 0) + 1
      WHERE id = $1
      RETURNING id`,
    [userId]
  );
  await q(`DELETE FROM user_backup_codes WHERE user_id = $1`, [userId]);
  return r.rows.length === 1;
}

async function bumpSessionVersion(userId) {
  await q(`UPDATE users SET session_version = COALESCE(session_version, 0) + 1 WHERE id = $1`, [userId]);
}

async function logAuthEvent(event) {
  try {
    await q(
      `INSERT INTO auth_events (event_type, user_id, actor_user_id, email, ip, user_agent, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.type,
        event.userId || null,
        event.actorUserId || null,
        event.email ? String(event.email).toLowerCase().slice(0, 254) : null,
        event.ip ? String(event.ip).slice(0, 64) : null,
        event.userAgent ? String(event.userAgent).slice(0, 300) : null,
        event.detail ? JSON.stringify(event.detail) : null,
      ]
    );
  } catch (err) {
    console.error('auth event log failed:', err.message);
  }
}

async function listAuthEvents(limit = 200) {
  const n = Math.max(1, Math.min(1000, Number(limit) || 200));
  const r = await q(
    `SELECT e.id, e.event_type, e.user_id, e.actor_user_id, e.email, e.ip, e.detail, e.created_at,
            u.name AS user_name, a.name AS actor_name
       FROM auth_events e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users a ON a.id = e.actor_user_id
      ORDER BY e.created_at DESC
      LIMIT $1`,
    [n]
  );
  return r.rows;
}

function _resetSchemaForTests() { schemaPromise = null; }

module.exports = {
  ensureAuthSchema,
  findUserByEmail,
  findUserById,
  setPendingTotpSecret,
  activateTotp,
  advanceTotpStep,
  replaceBackupCodes,
  consumeBackupCode,
  countUnusedBackupCodes,
  resetMfa,
  bumpSessionVersion,
  logAuthEvent,
  listAuthEvents,
  _resetSchemaForTests,
};

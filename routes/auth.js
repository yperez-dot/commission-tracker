const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getPool } = require('../db/database');
const {
  sha256hex,
  secretsEqual,
  extractApiToken,
  envApiKeyMatches,
  servicePrincipal,
} = require('../src/serviceAuth');
const {
  publicUser,
  signAccessToken,
  signPendingToken,
  verifyAccessToken,
  verifyPendingToken,
  jwtSecretWarnings,
} = require('../src/authTokens');
const {
  isMfaConfigured,
  getEncryptionKey,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  looksLikeBackupCode,
} = require('../src/authCrypto');
const { generateTotpSecret, otpauthUri, qrDataUrl, verifyTotp, looksLikeTotp } = require('../src/totp');
const { FailureLimiter, clientIp } = require('../src/authRateLimit');
const { passwordProblem } = require('../src/passwordPolicy');
const store = require('../src/authStore');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET env var not set'); process.exit(1); }
for (const w of jwtSecretWarnings(JWT_SECRET)) console.warn(`SECURITY: ${w} (value not shown). Use a long random value.`);
getEncryptionKey(); // logs a clear error once at startup if TOTP_ENCRYPTION_KEY is missing

const BCRYPT_COST = 12;
// Compared against when the email doesn't exist so response time doesn't reveal accounts.
const DUMMY_HASH = bcrypt.hashSync('olicomm-dummy-password-for-timing', BCRYPT_COST);

// 5 wrong passwords (same email + IP) → 15 min lock. 20 wrong from one IP (any email) → 15 min lock.
const loginLimiter = new FailureLimiter({ maxFailures: 5 });
const loginIpLimiter = new FailureLimiter({ maxFailures: 20 });
// 5 wrong codes (same account + IP) → 15 min lock. 10 wrong for one account from anywhere → 15 min lock.
const mfaLimiter = new FailureLimiter({ maxFailures: 5 });
const mfaUserLimiter = new FailureLimiter({ maxFailures: 10 });

const GENERIC_LOGIN_ERROR = 'Invalid email or password';
const GENERIC_CODE_ERROR = "That code didn't work. Check your authenticator app and try again.";
const EXPIRED_PENDING = 'Your sign-in step expired. Please sign in again.';
const MFA_NOT_CONFIGURED = 'Two-factor sign-in is not configured on the server yet. Ask an admin to set TOTP_ENCRYPTION_KEY.';

function serverError(res, err, where) {
  console.error(`auth ${where}:`, err && err.message);
  return res.status(500).json({ error: 'Server error' });
}

function reqMeta(req) {
  return { ip: clientIp(req), userAgent: req.headers && req.headers['user-agent'] };
}

function tooMany(res, ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  res.set('Retry-After', String(Math.ceil(ms / 1000)));
  return res.status(429).json({ error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
}

function normEmail(email) {
  return String(email || '').toLowerCase().trim();
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_COST);
}

function bcryptCost(hash) {
  const m = /^\$2[aby]?\$(\d{2})\$/.exec(String(hash || ''));
  return m ? Number(m[1]) : 0;
}

// ─── Step 1: password ────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const normalized = normEmail(email);
  const meta = reqMeta(req);
  const acctKey = `${meta.ip}|${normalized}`;
  const lockedMs = Math.max(loginLimiter.lockedFor(acctKey), loginIpLimiter.lockedFor(meta.ip));
  if (lockedMs > 0) {
    store.logAuthEvent({ type: 'login_locked', email: normalized, ...meta });
    return tooMany(res, lockedMs);
  }
  try {
    const user = await store.findUserByEmail(normalized);
    const matches = await bcrypt.compare(String(password), user ? user.password_hash : DUMMY_HASH);
    if (!user || !matches) {
      const locked = loginLimiter.fail(acctKey);
      loginIpLimiter.fail(meta.ip);
      store.logAuthEvent({
        type: 'login_failed', userId: user ? user.id : null, email: normalized, ...meta,
        detail: { reason: user ? 'bad_password' : 'unknown_email', locked },
      });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }
    loginLimiter.reset(acctKey);

    if (bcryptCost(user.password_hash) < BCRYPT_COST) {
      // Quietly upgrade older, cheaper hashes.
      hashPassword(password)
        .then((h) => getPool().query('UPDATE users SET password_hash = $1 WHERE id = $2', [h, user.id]))
        .catch((e) => console.error('rehash failed:', e.message));
    }

    if (!isMfaConfigured()) {
      store.logAuthEvent({ type: 'login_blocked_mfa_unconfigured', userId: user.id, email: normalized, ...meta });
      return res.status(503).json({ error: MFA_NOT_CONFIGURED });
    }

    const enrolled = !!user.totp_enabled_at;
    const purpose = enrolled ? 'verify' : 'enroll';
    store.logAuthEvent({ type: 'login_password_ok', userId: user.id, email: normalized, ...meta, detail: { next: purpose } });
    return res.json({
      mfaRequired: true,
      mfaEnrollRequired: !enrolled,
      mfaToken: signPendingToken(user, purpose),
    });
  } catch (err) {
    return serverError(res, err, 'login');
  }
});

// Loads the user behind an mfa-pending token, or responds 401.
async function loadPending(req, res, expectedPurpose) {
  const token = String((req.body && req.body.mfaToken) || '').trim();
  if (!token) { res.status(401).json({ error: EXPIRED_PENDING }); return null; }
  let claims;
  try { claims = verifyPendingToken(token); } catch {
    res.status(401).json({ error: EXPIRED_PENDING }); return null;
  }
  const user = await store.findUserById(claims.uid);
  if (!user || Number(user.session_version || 0) !== Number(claims.sv || 0)) {
    res.status(401).json({ error: EXPIRED_PENDING }); return null;
  }
  const enrolled = !!user.totp_enabled_at;
  const actualPurpose = enrolled ? 'verify' : 'enroll';
  if (claims.purpose !== expectedPurpose || actualPurpose !== expectedPurpose) {
    res.status(409).json({ error: EXPIRED_PENDING }); return null;
  }
  if (!isMfaConfigured()) { res.status(503).json({ error: MFA_NOT_CONFIGURED }); return null; }
  return user;
}

function mfaLockedFor(user, ip) {
  return Math.max(mfaLimiter.lockedFor(`${user.id}|${ip}`), mfaUserLimiter.lockedFor(String(user.id)));
}

function mfaFailed(user, meta, type, detail) {
  const locked = mfaLimiter.fail(`${user.id}|${meta.ip}`);
  mfaUserLimiter.fail(String(user.id));
  store.logAuthEvent({ type, userId: user.id, email: user.email, ...meta, detail: { ...(detail || {}), locked } });
}

function mfaSucceeded(user, meta) {
  mfaLimiter.reset(`${user.id}|${meta.ip}`);
  mfaUserLimiter.reset(String(user.id));
}

// ─── Step 2a: verify an enrolled user's code (TOTP or backup code) ───────────
router.post('/mfa/verify', async (req, res) => {
  const meta = reqMeta(req);
  try {
    const user = await loadPending(req, res, 'verify');
    if (!user) return;
    const lockedMs = mfaLockedFor(user, meta.ip);
    if (lockedMs > 0) {
      store.logAuthEvent({ type: 'mfa_locked', userId: user.id, email: user.email, ...meta });
      return tooMany(res, lockedMs);
    }
    const code = String((req.body && req.body.code) || '').trim();
    let method = null;
    let backupCodesRemaining;

    if (looksLikeTotp(code)) {
      const secret = decryptSecret(user.totp_secret_enc);
      const step = verifyTotp(code, secret, user.totp_last_step);
      if (step !== null && await store.advanceTotpStep(user.id, step)) method = 'totp';
    } else if (looksLikeBackupCode(code)) {
      const remaining = await store.consumeBackupCode(user.id, code);
      if (remaining >= 0) { method = 'backup_code'; backupCodesRemaining = remaining; }
    }

    if (!method) {
      mfaFailed(user, meta, 'mfa_failed');
      return res.status(401).json({ error: GENERIC_CODE_ERROR });
    }
    mfaSucceeded(user, meta);
    if (method === 'backup_code') {
      store.logAuthEvent({ type: 'backup_code_used', userId: user.id, email: user.email, ...meta, detail: { remaining: backupCodesRemaining } });
    }
    store.logAuthEvent({ type: 'login_success', userId: user.id, email: user.email, ...meta, detail: { method } });
    return res.json({
      token: signAccessToken(user),
      user: publicUser(user),
      ...(backupCodesRemaining !== undefined ? { backupCodesRemaining } : {}),
    });
  } catch (err) {
    return serverError(res, err, 'mfa verify');
  }
});

// ─── Step 2b: forced enrollment for users without 2FA ────────────────────────
router.post('/mfa/enroll/start', async (req, res) => {
  try {
    const user = await loadPending(req, res, 'enroll');
    if (!user) return;
    const secret = generateTotpSecret();
    await store.setPendingTotpSecret(user.id, encryptSecret(secret));
    const uri = otpauthUri(user.email, secret);
    return res.json({
      otpauthUrl: uri,
      qrDataUrl: await qrDataUrl(uri),
      manualKey: secret.replace(/(.{4})/g, '$1 ').trim(),
      issuer: 'OliComm',
      account: user.email,
    });
  } catch (err) {
    return serverError(res, err, 'mfa enroll start');
  }
});

router.post('/mfa/enroll/confirm', async (req, res) => {
  const meta = reqMeta(req);
  try {
    const user = await loadPending(req, res, 'enroll');
    if (!user) return;
    const lockedMs = mfaLockedFor(user, meta.ip);
    if (lockedMs > 0) return tooMany(res, lockedMs);
    if (!user.totp_pending_secret_enc) return res.status(409).json({ error: EXPIRED_PENDING });
    const secret = decryptSecret(user.totp_pending_secret_enc);
    const step = verifyTotp(String((req.body && req.body.code) || ''), secret, null);
    if (step === null) {
      mfaFailed(user, meta, 'mfa_enroll_failed');
      return res.status(401).json({ error: GENERIC_CODE_ERROR });
    }
    const activated = await store.activateTotp(user.id, user.totp_pending_secret_enc, step);
    if (!activated) return res.status(409).json({ error: EXPIRED_PENDING });
    mfaSucceeded(user, meta);
    const backupCodes = generateBackupCodes();
    await store.replaceBackupCodes(user.id, backupCodes);
    store.logAuthEvent({ type: 'mfa_enrolled', userId: user.id, email: user.email, ...meta });
    store.logAuthEvent({ type: 'login_success', userId: user.id, email: user.email, ...meta, detail: { method: 'enroll' } });
    return res.json({ token: signAccessToken(user), user: publicUser(user), backupCodes });
  } catch (err) {
    return serverError(res, err, 'mfa enroll confirm');
  }
});

// ─── Signed-in user's own 2FA ─────────────────────────────────────────────────
router.get('/mfa/status', requireAuth, async (req, res) => {
  if (req.user.authType === 'api_key') return res.json({ enabled: false, serviceKey: true });
  try {
    const user = await store.findUserById(req.user.id);
    return res.json({
      enabled: !!(user && user.totp_enabled_at),
      enabledAt: user ? user.totp_enabled_at : null,
      backupCodesRemaining: user ? await store.countUnusedBackupCodes(user.id) : 0,
    });
  } catch (err) { return serverError(res, err, 'mfa status'); }
});

// New backup codes (old ones stop working). Requires a current authenticator code.
router.post('/mfa/backup-codes', requireAuth, async (req, res) => {
  if (req.user.authType === 'api_key') return res.status(403).json({ error: 'Not available for API keys' });
  const meta = reqMeta(req);
  try {
    const user = await store.findUserById(req.user.id);
    if (!user || !user.totp_enabled_at) return res.status(409).json({ error: 'Two-factor is not enabled' });
    const lockedMs = mfaLockedFor(user, meta.ip);
    if (lockedMs > 0) return tooMany(res, lockedMs);
    const step = verifyTotp(String((req.body && req.body.code) || ''), decryptSecret(user.totp_secret_enc), user.totp_last_step);
    if (step === null || !(await store.advanceTotpStep(user.id, step))) {
      mfaFailed(user, meta, 'mfa_failed', { context: 'backup_codes_regenerate' });
      return res.status(401).json({ error: GENERIC_CODE_ERROR });
    }
    mfaSucceeded(user, meta);
    const backupCodes = generateBackupCodes();
    await store.replaceBackupCodes(user.id, backupCodes);
    store.logAuthEvent({ type: 'backup_codes_regenerated', userId: user.id, actorUserId: user.id, email: user.email, ...meta });
    return res.json({ backupCodes });
  } catch (err) { return serverError(res, err, 'backup codes'); }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ─── List all users (admin only) ─────────────────────────────────────────────
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    await store.ensureAuthSchema();
    const result = await getPool().query(
      `SELECT id, name, email, role, agency, created_at,
              (totp_enabled_at IS NOT NULL) AS mfa_enabled, totp_enabled_at AS mfa_enabled_at
         FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) { serverError(res, err, 'list users'); }
});

// ─── Create user (admin only) ─────────────────────────────────────────────────
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role, agency } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });
  const problem = passwordProblem(password, { email, name });
  if (problem) return res.status(400).json({ error: problem });
  try {
    await store.ensureAuthSchema();
    const hash = await hashPassword(password);
    const result = await getPool().query(
      `INSERT INTO users (name, email, password_hash, role, agency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, agency, created_at`,
      [name, normEmail(email), hash, role || 'agent', agency || '']
    );
    const created = result.rows[0];
    store.logAuthEvent({ type: 'user_created', userId: created.id, actorUserId: req.user.id || null, email: created.email, ...reqMeta(req), detail: { role: created.role } });
    res.json(created);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    serverError(res, err, 'create user');
  }
});

// ─── Delete user (admin only) ─────────────────────────────────────────────────
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Bad user id' });
  if (req.user.authType !== 'api_key' && targetId === Number(req.user.id)) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }
  try {
    await getPool().query('DELETE FROM users WHERE id = $1', [targetId]);
    store.logAuthEvent({ type: 'user_deleted', userId: targetId, actorUserId: req.user.id || null, ...reqMeta(req) });
    res.json({ success: true });
  } catch (err) { serverError(res, err, 'delete user'); }
});

// ─── Reset password (admin only) — also signs that user out everywhere ───────
router.patch('/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Bad user id' });
  try {
    const target = await store.findUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const problem = passwordProblem(password, { email: target.email, name: target.name });
    if (problem) return res.status(400).json({ error: problem });
    const hash = await hashPassword(password);
    await getPool().query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, targetId]);
    await store.bumpSessionVersion(targetId);
    store.logAuthEvent({ type: 'password_reset_by_admin', userId: targetId, actorUserId: req.user.id || null, email: target.email, ...reqMeta(req) });
    res.json({ success: true });
  } catch (err) { serverError(res, err, 'reset password'); }
});

// ─── Reset another user's 2FA (admin only, people only — not API keys) ───────
router.post('/users/:id/mfa/reset', requireAuth, requireAdmin, async (req, res) => {
  if (req.user.authType === 'api_key') return res.status(403).json({ error: 'A signed-in admin must do this' });
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Bad user id' });
  if (targetId === Number(req.user.id)) {
    return res.status(400).json({ error: 'Another admin has to reset your two-factor' });
  }
  try {
    const target = await store.findUserById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    await store.resetMfa(targetId);
    store.logAuthEvent({
      type: 'mfa_reset', userId: targetId, actorUserId: req.user.id, email: target.email, ...reqMeta(req),
      detail: { by: req.user.email, reason: String((req.body && req.body.reason) || '').slice(0, 200) || null },
    });
    res.json({ success: true });
  } catch (err) { serverError(res, err, 'mfa reset'); }
});

// ─── Security log (admin only) ────────────────────────────────────────────────
router.get('/events', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await store.listAuthEvents(req.query && req.query.limit));
  } catch (err) { serverError(res, err, 'events'); }
});

// ─── BSI carrier list ─────────────────────────────────────────────────────────
const BSI_CARRIERS = [
  'Mutual of Omaha','United of Omaha','Fidelity Life','Instabrain',
  'F&G','Fidelity & Guaranty','American Amicable','Transamerica',
  'Ethos','American Home Life','National Life Group'
];

// ─── Agents list — filtered by agency when dropdown is set ───────────────────
router.get('/agents', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();

    // Get agency from header (same as other routes)
    const override = req.headers['x-agency-override'];
    const agency = override !== undefined ? (override || null) : (req.user.agency || null);

    if (agency) {
      // Return agents who have commission records for this agency's carriers
      const isBSI = agency.toLowerCase().includes('broker society');
      const carrierList = BSI_CARRIERS.map((_, i) => `$${i + 1}`).join(',');
      const query = isBSI
        ? `SELECT DISTINCT u.id, u.name, u.email, u.role, u.created_at
           FROM users u
           WHERE u.name IN (
             SELECT DISTINCT agent_name FROM commission_records
             WHERE carrier = ANY($1)
           ) OR u.role = 'admin'
           ORDER BY u.name`
        : `SELECT DISTINCT u.id, u.name, u.email, u.role, u.created_at
           FROM users u
           WHERE u.name IN (
             SELECT DISTINCT agent_name FROM commission_records
             WHERE carrier != ALL($1)
           ) OR u.role = 'admin'
           ORDER BY u.name`;
      const result = await pool.query(query, [BSI_CARRIERS]);
      return res.json(result.rows);
    }

    // No agency filter — return all
    const result = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY name');
    res.json(result.rows);
  } catch (err) { serverError(res, err, 'agents list'); }
});

router.post('/agents', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });
  const problem = passwordProblem(password, { email, name });
  if (problem) return res.status(400).json({ error: problem });
  try {
    const hash = await hashPassword(password);
    const result = await getPool().query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, normEmail(email), hash, role || 'agent']
    );
    store.logAuthEvent({ type: 'user_created', userId: result.rows[0].id, actorUserId: req.user.id || null, email: result.rows[0].email, ...reqMeta(req) });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    serverError(res, err, 'create agent');
  }
});

// ─── TEMPORARY: schema inspection endpoint (setup secret) ────────────────────
router.get('/_schema/:table', async (req, res) => {
  const provided = req.headers['x-setup-secret'];
  if (!process.env.SETUP_SECRET || !secretsEqual(provided, process.env.SETUP_SECRET)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const pool = getPool();
    const r = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [req.params.table]);
    res.json({ table: req.params.table, columns: r.rows });
  } catch (err) {
    serverError(res, err, 'schema');
  }
});

/**
 * Accepts only a full (post-2FA) session for a user who still exists and whose
 * session_version matches. mfa-pending tokens, old pre-2FA tokens and tokens
 * for deleted/reset users are rejected with 401.
 */
async function attachJwtOrReject(token, req, res, next) {
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  try {
    const user = await store.findUserById(claims.id);
    if (!user || Number(user.session_version || 0) !== Number(claims.sv || 0) || !user.totp_enabled_at) {
      return res.status(401).json({ error: 'Session expired' });
    }
    req.user = { ...publicUser(user), authType: 'session' };
    return next();
  } catch (err) {
    console.error('session lookup failed:', err.message);
    return res.status(503).json({ error: 'Service unavailable' });
  }
}

function requireAuth(req, res, next) {
  const token = extractApiToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // Machine access for Igor / automations: static env key or hashed row in api_keys.
  // These bypass 2FA by design (no human, no authenticator) — keep keys secret and revocable.
  if (envApiKeyMatches(token)) {
    req.user = servicePrincipal();
    return next();
  }

  const pool = getPool();
  pool.query(
    `SELECT user_id, name, email, role
       FROM api_keys
      WHERE key_hash = $1 AND revoked_at IS NULL
      LIMIT 1`,
    [sha256hex(token)]
  ).then((result) => {
    const row = result.rows[0];
    if (row) {
      req.user = servicePrincipal({
        id: row.user_id,
        name: row.name,
        email: row.email,
        role: row.role,
      });
      return next();
    }
    return attachJwtOrReject(token, req, res, next);
  }).catch((err) => {
    if (!err || err.code !== '42P01') console.error('api_keys lookup', err && err.message);
    return attachJwtOrReject(token, req, res, next);
  });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports._limiters = { loginLimiter, loginIpLimiter, mfaLimiter, mfaUserLimiter };

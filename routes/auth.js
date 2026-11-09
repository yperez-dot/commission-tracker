const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool } = require('../db/database');
const {
  sha256hex,
  extractApiToken,
  envApiKeyMatches,
  servicePrincipal,
} = require('../src/serviceAuth');
const {
  generateTotpSecret,
  verifyTotp,
  buildOtpauthUri,
  generateBackupCodes,
  hashBackupCode,
  consumeBackupCode,
  parseBackupHashes,
  serializeBackupHashes,
  encryptTotpSecret,
  decryptTotpSecret,
} = require('../src/totp');
const QRCode = require('qrcode');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET env var not set'); process.exit(1); }

const TEMP_2FA_PURPOSE = '2fa_pending';
const TEMP_2FA_EXPIRES = '5m';
const VERIFY_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_MAX_ATTEMPTS = 10;
const verifyAttempts = new Map();

function checkVerifyRateLimit(key) {
  const now = Date.now();
  let entry = verifyAttempts.get(key);
  if (!entry || now - entry.start > VERIFY_WINDOW_MS) {
    entry = { start: now, count: 0 };
    verifyAttempts.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= VERIFY_MAX_ATTEMPTS;
}

function publicUser(user) {
  // Keep the classic login/session user shape stable for non-2FA clients.
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    agency: user.agency || '',
  };
}

function issueSessionToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, agency: user.agency || '' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function issueTemp2faToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, purpose: TEMP_2FA_PURPOSE },
    JWT_SECRET,
    { expiresIn: TEMP_2FA_EXPIRES }
  );
}

function isTemp2faPayload(payload) {
  return !!(payload && payload.purpose === TEMP_2FA_PURPOSE);
}

function non2faLoginResponse(user) {
  return { token: issueSessionToken(user), user: publicUser(user) };
}

// Simple in-memory login rate limit (per IP+email)
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function checkLoginRateLimit(key) {
  const now = Date.now();
  let entry = loginAttempts.get(key);
  if (!entry || now - entry.start > LOGIN_WINDOW_MS) {
    entry = { start: now, count: 0 };
    loginAttempts.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const rateKey = `${req.ip || 'unknown'}:${String(email).toLowerCase().trim()}`;
  if (!checkLoginRateLimit(rateKey)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    loginAttempts.delete(rateKey);

    // Opt-in 2FA: unchanged response when totp_enabled is false/null
    if (user.totp_enabled) {
      return res.json({
        requires2fa: true,
        tempToken: issueTemp2faToken(user),
      });
    }

    res.json(non2faLoginResponse(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Complete 2FA login (TOTP or backup code) ────────────────────────────────
router.post('/2fa/verify', async (req, res) => {
  const { tempToken, code } = req.body || {};
  if (!tempToken || !code) return res.status(400).json({ error: 'tempToken and code required' });
  let payload;
  try {
    payload = jwt.verify(tempToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: '2FA session expired. Sign in again.' });
  }
  if (!isTemp2faPayload(payload) || !payload.id) {
    return res.status(401).json({ error: 'Invalid 2FA session' });
  }
  const rateKey = `${req.ip || 'unknown'}:2fa:${payload.id}`;
  if (!checkVerifyRateLimit(rateKey)) {
    return res.status(429).json({ error: 'Too many 2FA attempts. Try again later.' });
  }
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [payload.id]);
    const user = result.rows[0];
    if (!user || !user.totp_enabled) {
      return res.status(401).json({ error: '2FA is not enabled for this account' });
    }
    const secret = decryptTotpSecret(user.totp_secret);
    const digitsOnly = String(code).replace(/\s+/g, '');
    let ok = false;
    if (/^\d{6}$/.test(digitsOnly) && secret && verifyTotp(secret, digitsOnly)) {
      ok = true;
    } else {
      const hashes = parseBackupHashes(user.totp_backup_codes);
      const consumed = consumeBackupCode(code, hashes);
      if (consumed.ok) {
        ok = true;
        await pool.query('UPDATE users SET totp_backup_codes = $1 WHERE id = $2', [
          serializeBackupHashes(consumed.remainingHashes),
          user.id,
        ]);
      }
    }
    if (!ok) return res.status(401).json({ error: 'Invalid authenticator or backup code' });
    verifyAttempts.delete(rateKey);
    res.json(non2faLoginResponse(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── 2FA setup (logged-in): returns otpauth URI + QR data URL ────────────────
router.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    if (isTemp2faPayload(req.user)) return res.status(401).json({ error: 'Unauthorized' });
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.totp_enabled) {
      return res.status(400).json({ error: '2FA is already enabled. Disable it before re-enrolling.' });
    }
    const secret = generateTotpSecret();
    const enc = encryptTotpSecret(secret);
    await pool.query(
      `UPDATE users SET totp_secret = $1, totp_enabled = FALSE, totp_backup_codes = NULL WHERE id = $2`,
      [enc, user.id]
    );
    const otpauthUrl = buildOtpauthUri(secret, user.email);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
    res.json({ otpauthUrl, qrDataUrl, secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Enable 2FA after confirming first code; returns backup codes once ───────
router.post('/2fa/enable', requireAuth, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Authenticator code required' });
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });
    if (!user.totp_secret) return res.status(400).json({ error: 'Call /auth/2fa/setup first' });
    const secret = decryptTotpSecret(user.totp_secret);
    if (!verifyTotp(secret, code)) {
      return res.status(401).json({ error: 'Invalid authenticator code' });
    }
    const backupCodes = generateBackupCodes();
    const hashes = backupCodes.map(hashBackupCode);
    await pool.query(
      `UPDATE users
          SET totp_enabled = TRUE,
              totp_backup_codes = $1,
              totp_verified_at = NOW()
        WHERE id = $2`,
      [serializeBackupHashes(hashes), user.id]
    );
    res.json({ enabled: true, backupCodes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Disable 2FA (password + current code or backup) ─────────────────────────
router.post('/2fa/disable', requireAuth, async (req, res) => {
  const { password, code } = req.body || {};
  if (!password || !code) return res.status(400).json({ error: 'Password and code required' });
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    if (!user.totp_enabled) {
      await pool.query(
        `UPDATE users SET totp_secret = NULL, totp_backup_codes = NULL, totp_enabled = FALSE, totp_verified_at = NULL WHERE id = $1`,
        [user.id]
      );
      return res.json({ disabled: true });
    }
    const secret = decryptTotpSecret(user.totp_secret);
    const digitsOnly = String(code).replace(/\s+/g, '');
    let ok = /^\d{6}$/.test(digitsOnly) && secret && verifyTotp(secret, digitsOnly);
    if (!ok) {
      const hashes = parseBackupHashes(user.totp_backup_codes);
      ok = consumeBackupCode(code, hashes).ok;
    }
    if (!ok) return res.status(401).json({ error: 'Invalid authenticator or backup code' });
    await pool.query(
      `UPDATE users SET totp_secret = NULL, totp_backup_codes = NULL, totp_enabled = FALSE, totp_verified_at = NULL WHERE id = $1`,
      [user.id]
    );
    res.json({ disabled: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Regenerate backup codes (requires current TOTP) ─────────────────────────
router.post('/2fa/backup-codes/regenerate', requireAuth, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Authenticator code required' });
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user || !user.totp_enabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }
    const secret = decryptTotpSecret(user.totp_secret);
    if (!verifyTotp(secret, code)) {
      return res.status(401).json({ error: 'Invalid authenticator code' });
    }
    const backupCodes = generateBackupCodes();
    const hashes = backupCodes.map(hashBackupCode);
    await pool.query('UPDATE users SET totp_backup_codes = $1 WHERE id = $2', [
      serializeBackupHashes(hashes),
      user.id,
    ]);
    res.json({ backupCodes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── 2FA status for Settings ─────────────────────────────────────────────────
router.get('/2fa/status', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT totp_enabled, totp_verified_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const row = result.rows[0] || {};
    res.json({
      enabled: !!row.totp_enabled,
      verifiedAt: row.totp_verified_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ─── List all users (admin only) ─────────────────────────────────────────────
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS agency TEXT DEFAULT ''`).catch(() => {});
    const result = await pool.query(
      `SELECT id, name, email, role, agency, totp_enabled, created_at FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Create user (admin only) ─────────────────────────────────────────────────
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role, agency } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const pool = getPool();
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS agency TEXT DEFAULT ''`).catch(() => {});
    const hash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, agency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, agency, created_at`,
      [name, email.toLowerCase().trim(), hash, role || 'agent', agency || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete user (admin only) ─────────────────────────────────────────────────
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Reset password (admin only) ──────────────────────────────────────────────
router.patch('/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const pool = getPool();
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Admin reset another user's 2FA ──────────────────────────────────────────
router.post('/users/:id/2fa/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE users
          SET totp_secret = NULL,
              totp_backup_codes = NULL,
              totp_enabled = FALSE,
              totp_verified_at = NULL
        WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/agents', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });
  try {
    const pool = getPool();
    const hash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email.toLowerCase().trim(), hash, role || 'agent']
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ─── TEMPORARY: schema inspection endpoint (admin-only) ──────────────────────────
router.get('/_schema/:table', async (req, res) => {
  const provided = req.headers['x-setup-secret'];
  if (!process.env.SETUP_SECRET || provided !== process.env.SETUP_SECRET) {
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
    res.status(500).json({ error: err.message });
  }
});

function attachJwtOrReject(token, req, res, next) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (isTemp2faPayload(payload)) {
      return res.status(401).json({ error: 'Complete 2FA verification first' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAuth(req, res, next) {
  const token = extractApiToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // Machine access for Igor / automations: static env key or hashed row in api_keys.
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
    attachJwtOrReject(token, req, res, next);
  }).catch((err) => {
    if (err && err.code === '42P01') {
      return attachJwtOrReject(token, req, res, next);
    }
    console.error('api_keys lookup', err.message);
    return attachJwtOrReject(token, req, res, next);
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.issueSessionToken = issueSessionToken;
module.exports.issueTemp2faToken = issueTemp2faToken;
module.exports.isTemp2faPayload = isTemp2faPayload;
module.exports.non2faLoginResponse = non2faLoginResponse;
module.exports.publicUser = publicUser;
module.exports.TEMP_2FA_PURPOSE = TEMP_2FA_PURPOSE;

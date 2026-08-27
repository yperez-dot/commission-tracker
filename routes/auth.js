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
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET env var not set'); process.exit(1); }

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
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role, agency: user.agency || '' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, agency: user.agency || '' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
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
      `SELECT id, name, email, role, agency, created_at FROM users ORDER BY created_at DESC`
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
    req.user = jwt.verify(token, JWT_SECRET);
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

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool } = require('../db/database');
const JWT_SECRET = process.env.JWT_SECRET || 'healthexperts-secret-change-in-production';

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
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

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;

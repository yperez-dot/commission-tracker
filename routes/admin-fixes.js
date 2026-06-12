const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');

// POST /api/admin-fixes/update-user-name - One-time fix for user display names
router.post('/update-user-name', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { email, newName } = req.body;
    
    if (!email || !newName) {
      return res.status(400).json({ error: 'email and newName required' });
    }

    const pool = getPool();
    
    // Check current user
    const current = await pool.query(
      'SELECT id, name, email FROM users WHERE email = $1',
      [email]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: `User ${email} not found` });
    }

    // Update the name
    const result = await pool.query(
      'UPDATE users SET name = $1 WHERE email = $2 RETURNING id, name, email',
      [newName, email]
    );

    res.json({
      success: true,
      before: current.rows[0],
      after: result.rows[0],
      message: `Updated ${email} from "${current.rows[0].name}" to "${newName}"`
    });
  } catch (err) {
    console.error('Admin fix error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

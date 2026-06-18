const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');

// GET /api/payroll - List all payroll payments
router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agent, startDate, endDate, limit, offset } = req.query;
    
    let where = ['1=1'];
    let params = [];
    let idx = 1;
    
    if (agent) {
      where.push(`agent_name ILIKE $${idx++}`);
      params.push(`%${agent}%`);
    }
    
    if (startDate) {
      where.push(`payment_date >= $${idx++}`);
      params.push(startDate);
    }
    
    if (endDate) {
      where.push(`payment_date <= $${idx++}`);
      params.push(endDate);
    }
    
    const limitVal = parseInt(limit) || 100;
    const offsetVal = parseInt(offset) || 0;
    
    const result = await pool.query(
      `SELECT * FROM payroll_payments 
       WHERE ${where.join(' AND ')}
       ORDER BY payment_date DESC, created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limitVal, offsetVal]
    );
    
    const count = await pool.query(
      `SELECT COUNT(*) as total FROM payroll_payments WHERE ${where.join(' AND ')}`,
      params
    );
    
    res.json({
      payments: result.rows,
      total: parseInt(count.rows[0].total),
      limit: limitVal,
      offset: offsetVal
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payroll/summary - Summary by agent
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { startDate, endDate } = req.query;
    
    let where = ['1=1'];
    let params = [];
    let idx = 1;
    
    if (startDate) {
      where.push(`payment_date >= $${idx++}`);
      params.push(startDate);
    }
    
    if (endDate) {
      where.push(`payment_date <= $${idx++}`);
      params.push(endDate);
    }
    
    const result = await pool.query(
      `SELECT 
        agent_name,
        COUNT(*) as payment_count,
        SUM(payment_amount) as total_paid,
        MIN(payment_date) as first_payment,
        MAX(payment_date) as last_payment
       FROM payroll_payments
       WHERE ${where.join(' AND ')}
       GROUP BY agent_name
       ORDER BY total_paid DESC`,
      params
    );
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payroll - Create new payment record
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const {
      payment_date,
      agent_name,
      payment_amount,
      payment_method,
      check_number,
      period_start,
      period_end,
      notes
    } = req.body;
    
    if (!payment_date || !agent_name || !payment_amount) {
      return res.status(400).json({ error: 'payment_date, agent_name, and payment_amount are required' });
    }
    
    const result = await pool.query(
      `INSERT INTO payroll_payments 
       (payment_date, agent_name, payment_amount, payment_method, check_number, 
        period_start, period_end, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        payment_date,
        agent_name,
        payment_amount,
        payment_method || null,
        check_number || null,
        period_start || null,
        period_end || null,
        notes || null,
        req.user.name || req.user.email
      ]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/payroll/:id - Update payment record
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const {
      payment_date,
      agent_name,
      payment_amount,
      payment_method,
      check_number,
      period_start,
      period_end,
      notes
    } = req.body;
    
    const updates = [];
    const params = [];
    let idx = 1;
    
    if (payment_date !== undefined) {
      updates.push(`payment_date = $${idx++}`);
      params.push(payment_date);
    }
    
    if (agent_name !== undefined) {
      updates.push(`agent_name = $${idx++}`);
      params.push(agent_name);
    }
    
    if (payment_amount !== undefined) {
      updates.push(`payment_amount = $${idx++}`);
      params.push(payment_amount);
    }
    
    if (payment_method !== undefined) {
      updates.push(`payment_method = $${idx++}`);
      params.push(payment_method);
    }
    
    if (check_number !== undefined) {
      updates.push(`check_number = $${idx++}`);
      params.push(check_number);
    }
    
    if (period_start !== undefined) {
      updates.push(`period_start = $${idx++}`);
      params.push(period_start);
    }
    
    if (period_end !== undefined) {
      updates.push(`period_end = $${idx++}`);
      params.push(period_end);
    }
    
    if (notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      params.push(notes);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);
    
    const result = await pool.query(
      `UPDATE payroll_payments 
       SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      params
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/payroll/:id - Delete payment record
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM payroll_payments WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

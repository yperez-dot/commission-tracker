const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');

// GET /api/agent-statements - List all statements
router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { agent, period, status, limit, offset } = req.query;
    
    let where = ['1=1'];
    let params = [];
    let idx = 1;
    
    if (agent) {
      where.push(`agent_name ILIKE $${idx++}`);
      params.push(`%${agent}%`);
    }
    
    if (period) {
      where.push(`statement_period = $${idx++}`);
      params.push(period);
    }
    
    if (status) {
      where.push(`payment_status = $${idx++}`);
      params.push(status);
    }
    
    const limitVal = parseInt(limit) || 100;
    const offsetVal = parseInt(offset) || 0;
    
    const result = await pool.query(
      `SELECT * FROM agent_statements 
       WHERE ${where.join(' AND ')}
       ORDER BY statement_period DESC, statement_date DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limitVal, offsetVal]
    );
    
    const count = await pool.query(
      `SELECT COUNT(*) as total FROM agent_statements WHERE ${where.join(' AND ')}`,
      params
    );
    
    res.json({
      statements: result.rows,
      total: parseInt(count.rows[0].total),
      limit: limitVal,
      offset: offsetVal
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agent-statements/summary - Summary by agent
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { startPeriod, endPeriod } = req.query;
    
    let where = ['1=1'];
    let params = [];
    let idx = 1;
    
    if (startPeriod) {
      where.push(`statement_period >= $${idx++}`);
      params.push(startPeriod);
    }
    
    if (endPeriod) {
      where.push(`statement_period <= $${idx++}`);
      params.push(endPeriod);
    }
    
    const result = await pool.query(
      `SELECT 
        agent_name,
        COUNT(*) as statement_count,
        SUM(total_commission) as total_commission,
        SUM(CASE WHEN payment_status = 'paid' THEN payment_amount ELSE 0 END) as total_paid,
        COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_count,
        MIN(statement_date) as first_statement,
        MAX(statement_date) as last_statement
       FROM agent_statements
       WHERE ${where.join(' AND ')}
       GROUP BY agent_name
       ORDER BY total_commission DESC`,
      params
    );
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agent-statements - Create new statement record
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const {
      agent_name,
      statement_period,
      statement_date,
      total_commission,
      record_count,
      payment_status,
      payment_date,
      payment_amount,
      payment_method,
      check_number,
      notes
    } = req.body;
    
    if (!agent_name || !statement_period || !total_commission) {
      return res.status(400).json({ error: 'agent_name, statement_period, and total_commission are required' });
    }
    
    const result = await pool.query(
      `INSERT INTO agent_statements 
       (agent_name, statement_period, statement_date, total_commission, record_count,
        payment_status, payment_date, payment_amount, payment_method, check_number, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        agent_name,
        statement_period,
        statement_date || new Date().toISOString().split('T')[0],
        total_commission,
        record_count || 0,
        payment_status || 'pending',
        payment_date || null,
        payment_amount || null,
        payment_method || null,
        check_number || null,
        notes || null,
        req.user.name || req.user.email
      ]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agent-statements/:id - Update statement record
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const {
      payment_status,
      payment_date,
      payment_amount,
      payment_method,
      check_number,
      notes
    } = req.body;
    
    const updates = [];
    const params = [];
    let idx = 1;
    
    if (payment_status !== undefined) {
      updates.push(`payment_status = $${idx++}`);
      params.push(payment_status);
    }
    
    if (payment_date !== undefined) {
      updates.push(`payment_date = $${idx++}`);
      params.push(payment_date);
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
      `UPDATE agent_statements 
       SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      params
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/agent-statements/:id - Delete statement record
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM agent_statements WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

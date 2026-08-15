const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');

async function ensurePayoutStatusTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_payout_status (
      id SERIAL PRIMARY KEY,
      agency_key TEXT NOT NULL DEFAULT 'thei',
      payment_period TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      is_paid BOOLEAN NOT NULL DEFAULT FALSE,
      paid_date DATE,
      amount NUMERIC(12, 2),
      notes TEXT,
      updated_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (agency_key, payment_period, agent_name)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_payroll_payout_status_period
      ON payroll_payout_status (agency_key, payment_period)
  `);
}

function agencyKeyFromReq(req) {
  const raw =
    req.query.agency ||
    req.body?.agency ||
    req.headers['x-agency-override'] ||
    req.user?.agency ||
    'thei';
  const s = String(raw || 'thei').toLowerCase();
  if (s.includes('broker society') || s === 'bsi') return 'bsi';
  return 'thei';
}

// ─── Shared Agent Payout paid/unpaid status ───────────────────────────────────

/** GET /api/payroll/payout-status?period=202607 */
router.get('/payout-status', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await ensurePayoutStatusTable(pool);
    const period = String(req.query.period || '');
    if (!period) return res.status(400).json({ error: 'period is required' });
    const agencyKey = agencyKeyFromReq(req);
    const result = await pool.query(
      `SELECT id, agency_key, payment_period, agent_name, is_paid, paid_date,
              amount, notes, updated_by, updated_at
       FROM payroll_payout_status
       WHERE agency_key = $1 AND payment_period = $2
       ORDER BY agent_name`,
      [agencyKey, period]
    );
    const paid = {};
    const dates = {};
    const amounts = {};
    for (const row of result.rows) {
      if (row.is_paid) {
        paid[row.agent_name] = true;
        dates[row.agent_name] = row.paid_date
          ? String(row.paid_date).slice(0, 10)
          : null;
        amounts[row.agent_name] = row.amount != null ? Number(row.amount) : null;
      }
    }
    res.json({
      agencyKey,
      period,
      paid,
      dates,
      amounts,
      rows: result.rows,
    });
  } catch (err) {
    console.error('[payroll] payout-status GET', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/payroll/payout-status
 * body: { period, agent, paid, amount?, paidDate?, notes?, agency? }
 */
router.put('/payout-status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await ensurePayoutStatusTable(pool);
    const period = String(req.body?.period || '');
    const agent = String(req.body?.agent || '').trim();
    const paid = !!req.body?.paid;
    if (!period || !agent) {
      return res.status(400).json({ error: 'period and agent are required' });
    }
    const agencyKey = agencyKeyFromReq(req);
    const amount =
      req.body?.amount != null && req.body.amount !== ''
        ? Number(req.body.amount)
        : null;
    const paidDate = paid
      ? String(req.body?.paidDate || new Date().toISOString().slice(0, 10)).slice(0, 10)
      : null;
    const updatedBy = req.user?.name || req.user?.email || null;
    const notes = req.body?.notes != null ? String(req.body.notes) : null;

    const result = await pool.query(
      `INSERT INTO payroll_payout_status
         (agency_key, payment_period, agent_name, is_paid, paid_date, amount, notes, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (agency_key, payment_period, agent_name)
       DO UPDATE SET
         is_paid = EXCLUDED.is_paid,
         paid_date = EXCLUDED.paid_date,
         amount = COALESCE(EXCLUDED.amount, payroll_payout_status.amount),
         notes = COALESCE(EXCLUDED.notes, payroll_payout_status.notes),
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [agencyKey, period, agent, paid, paidDate, amount, notes, updatedBy]
    );

    res.json({ success: true, row: result.rows[0] });
  } catch (err) {
    console.error('[payroll] payout-status PUT', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/payroll/payout-history?limit=200 — paid marks for History tab */
router.get('/payout-history', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await ensurePayoutStatusTable(pool);
    const agencyKey = agencyKeyFromReq(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const result = await pool.query(
      `SELECT id, agency_key, payment_period, agent_name, is_paid, paid_date,
              amount, notes, updated_by, updated_at
       FROM payroll_payout_status
       WHERE agency_key = $1 AND is_paid = TRUE
       ORDER BY paid_date DESC NULLS LAST, updated_at DESC
       LIMIT $2`,
      [agencyKey, limit]
    );
    res.json({
      agencyKey,
      history: result.rows.map((r) => ({
        id: r.id,
        period: r.payment_period,
        periodLabel: formatPeriodLabel(r.payment_period),
        agent: r.agent_name,
        amount: r.amount != null ? Number(r.amount) : 0,
        date: r.paid_date ? String(r.paid_date).slice(0, 10) : null,
        updatedBy: r.updated_by,
      })),
    });
  } catch (err) {
    console.error('[payroll] payout-history', err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/payroll/payout-status/:id — clear a paid mark (History delete) */
router.delete('/payout-status/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await ensurePayoutStatusTable(pool);
    const agencyKey = agencyKeyFromReq(req);
    const result = await pool.query(
      `DELETE FROM payroll_payout_status
       WHERE id = $1 AND agency_key = $2
       RETURNING *`,
      [req.params.id, agencyKey]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Status row not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('[payroll] payout-status DELETE', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent contacts + email statements ───────────────────────────────────────

const {
  buildAgentStatementCsv,
  statementFilename,
  isValidEmail,
} = require('../src/agentStatementCsv');

async function ensureAgentContactsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_contacts (
      id SERIAL PRIMARY KEY,
      agent_name TEXT UNIQUE NOT NULL,
      email TEXT,
      phone TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function resolveAgentEmail(pool, agentName) {
  const name = String(agentName || '').trim();
  if (!name) return null;

  const contact = await pool.query(
    `SELECT email FROM agent_contacts
     WHERE LOWER(TRIM(agent_name)) = LOWER(TRIM($1))
     LIMIT 1`,
    [name]
  );
  if (contact.rows[0]?.email) return String(contact.rows[0].email).trim();

  const user = await pool.query(
    `SELECT email FROM users
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
     LIMIT 1`,
    [name]
  );
  if (user.rows[0]?.email) return String(user.rows[0].email).trim();

  return null;
}

/** GET /api/payroll/agent-contacts */
router.get('/agent-contacts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await ensureAgentContactsTable(pool);
    const result = await pool.query(
      `SELECT id, agent_name, email, phone, updated_at
       FROM agent_contacts
       ORDER BY agent_name ASC`
    );
    res.json({ contacts: result.rows });
  } catch (err) {
    console.error('[payroll] agent-contacts GET', err);
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/payroll/agent-contacts — upsert by agent_name */
router.put('/agent-contacts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await ensureAgentContactsTable(pool);
    const agentName = String(req.body?.agent_name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = req.body?.phone != null ? String(req.body.phone).trim() : null;

    if (!agentName) return res.status(400).json({ error: 'agent_name is required' });
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const result = await pool.query(
      `INSERT INTO agent_contacts (agent_name, email, phone, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (agent_name)
       DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = NOW()
       RETURNING *`,
      [agentName, email, phone]
    );
    res.json({ success: true, contact: result.rows[0] });
  } catch (err) {
    console.error('[payroll] agent-contacts PUT', err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/payroll/agent-contacts/:id */
router.delete('/agent-contacts/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await ensureAgentContactsTable(pool);
    const result = await pool.query(
      `DELETE FROM agent_contacts WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contact not found' });
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('[payroll] agent-contacts DELETE', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/payroll/send-statement
 * body: { agent_name, period_label, records?, statement_csv?, statement_base64?, is_bsi? }
 * Prefer records (server builds CSV) or statement_csv / base64 attachment from client.
 */
router.post('/send-statement', requireAuth, requireAdmin, async (req, res) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'Email not configured. Set RESEND_API_KEY (and optional RESEND_FROM_EMAIL) on the API.',
      });
    }

    const pool = getPool();
    await ensureAgentContactsTable(pool);

    const agentName = String(req.body?.agent_name || '').trim();
    const periodLabel = String(req.body?.period_label || '').trim() || 'Statement';
    if (!agentName) return res.status(400).json({ error: 'agent_name is required' });

    const toEmail = await resolveAgentEmail(pool, agentName);
    if (!toEmail || !isValidEmail(toEmail)) {
      return res.status(400).json({
        error: `No email on file for ${agentName}. Add one under Agent emails.`,
      });
    }

    let csvText = null;
    if (Array.isArray(req.body?.records) && req.body.records.length >= 0) {
      csvText = buildAgentStatementCsv(agentName, req.body.records, periodLabel);
    } else if (req.body?.statement_csv) {
      csvText = String(req.body.statement_csv);
    } else if (req.body?.statement_base64) {
      csvText = Buffer.from(String(req.body.statement_base64), 'base64').toString('utf8');
    } else {
      return res.status(400).json({ error: 'records or statement_csv required' });
    }

    const isBSI = !!req.body?.is_bsi;
    const filename = statementFilename(agentName, periodLabel, isBSI);
    const fromEmail =
      process.env.RESEND_FROM_EMAIL || 'commissions@healthexps.com';
    const firstName = agentName.split(/\s+/)[0] || agentName;

    const { Resend } = require('resend');
    const resend = new Resend(apiKey);
    const sendResult = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: `Your Commission Statement — ${periodLabel}`,
      html: `
        <p>Hi ${firstName},</p>
        <p>Please find your commission statement for <strong>${periodLabel}</strong> attached.</p>
        <p>Questions? Reply to this email or call 1-800-380-6821.</p>
        <br/>
        <p>The Health Experts Insurance</p>
      `,
      attachments: [
        {
          filename,
          content: Buffer.from(csvText, 'utf8'),
        },
      ],
    });

    if (sendResult?.error) {
      console.error('[payroll] Resend error', sendResult.error);
      return res.status(502).json({
        error: sendResult.error.message || 'Failed to send email via Resend',
      });
    }

    res.json({
      success: true,
      to: toEmail,
      filename,
      id: sendResult?.data?.id || null,
    });
  } catch (err) {
    console.error('[payroll] send-statement', err);
    res.status(500).json({ error: err.message || 'Failed to send statement' });
  }
});

function formatPeriodLabel(p) {
  if (!p) return p;
  const s = String(p).trim();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (/^\d{6}$/.test(s)) {
    const m = parseInt(s.slice(4, 6), 10);
    if (m >= 1 && m <= 12) return `${months[m - 1]} ${s.slice(0, 4)}`;
  }
  return s;
}

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

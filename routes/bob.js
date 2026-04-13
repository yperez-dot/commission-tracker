const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');

const UPLOADS_DIR = path.join('/tmp', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const y = value.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  if (typeof value === 'string') {
    if (value.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) return value;
    if (value.match(/\d{4}-\d{2}-\d{2}/)) {
      const [y, m, d] = value.split('-');
      return `${m}/${d}/${y}`;
    }
    return value;
  }
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    if (isNaN(date.getTime())) return String(value);
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  return String(value);
}

// GET all BOB entries
router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { carrier, agent, status, missing } = req.query;

    let where = ['1=1'];
    let params = [];
    let idx = 1;

    if (req.user.role === 'agent') {
      where.push(`agent_name ILIKE $${idx++}`);
      params.push(`%${req.user.name}%`);
    }
    if (carrier) { where.push(`carrier = $${idx++}`); params.push(carrier); }
    if (agent) { where.push(`agent_name = $${idx++}`); params.push(agent); }
    if (status) { where.push(`status = $${idx++}`); params.push(status); }
    if (missing === 'true') { where.push(`months_missing > 0 AND status = 'active'`); }

    const result = await pool.query(
      `SELECT * FROM book_of_business WHERE ${where.join(' AND ')} ORDER BY months_missing DESC, client_full_name ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET BOB summary stats
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.role === 'admin';
    const agentFilter = isAdmin ? '' : `AND agent_name ILIKE '%${req.user.name}%'`;

    const total = await pool.query(`SELECT COUNT(*) as count FROM book_of_business WHERE status = 'active' ${agentFilter}`);
    const missing = await pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(last_commission_amount),0) as at_risk FROM book_of_business WHERE months_missing > 0 AND status = 'active' ${agentFilter}`);
    const newThis = await pool.query(`SELECT COUNT(*) as count FROM book_of_business WHERE source = 'statement' AND created_at > NOW() - INTERVAL '35 days' ${agentFilter}`);
    const byCarrier = await pool.query(`SELECT carrier, COUNT(*) as count, MAX(updated_at) as last_updated FROM book_of_business WHERE status = 'active' ${agentFilter} GROUP BY carrier ORDER BY count DESC`);
    const bySource = await pool.query(`SELECT source, COUNT(*) as count FROM book_of_business WHERE status = 'active' ${agentFilter} GROUP BY source`);

    res.json({
      totalActive: parseInt(total.rows[0].count),
      missingCount: parseInt(missing.rows[0].count),
      atRisk: parseFloat(missing.rows[0].at_risk),
      newEnrollments: parseInt(newThis.rows[0].count),
      byCarrier: byCarrier.rows,
      bySource: bySource.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH - update resolution status for a BOB entry
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { resolution, status, notes } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (resolution !== undefined) { updates.push(`resolution = $${idx++}`); params.push(resolution); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }
    if (notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(notes); }
    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id);
    await pool.query(
      `UPDATE book_of_business SET ${updates.join(', ')} WHERE id = $${idx}`,
      params
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - run renewal check: compare BOB against latest commission period
router.post('/check-renewals', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { period } = req.body;
    if (!period) return res.status(400).json({ error: 'Period required' });

    const isAdmin = req.user.role === 'admin';
    const agentFilter = isAdmin ? '' : `AND agent_name ILIKE '%${req.user.name}%'`;

    // Get all commission records for this period
    const commRecords = await pool.query(
      `SELECT LOWER(TRIM(client_full_name)) as client_key, carrier, agent_name, commission, payment_period
       FROM commission_records WHERE payment_period = $1 ${agentFilter}`,
      [period]
    );

    const paidSet = new Set(
      commRecords.rows.map(r => `${r.client_key}|${r.carrier.toLowerCase()}`)
    );

    // Get all active BOB clients
    const bobClients = await pool.query(
      `SELECT * FROM book_of_business WHERE status = 'active' ${agentFilter}`
    );

    let missingCount = 0;
    let recoveredCount = 0;

    for (const client of bobClients.rows) {
      const key = `${client.client_full_name.toLowerCase().trim()}|${client.carrier.toLowerCase()}`;
      const wasMissing = client.months_missing > 0;
      const isPaid = paidSet.has(key);

      if (!isPaid) {
        // Still missing or newly missing
        await pool.query(
          `UPDATE book_of_business SET months_missing = months_missing + 1, updated_at = NOW() WHERE id = $1`,
          [client.id]
        );
        missingCount++;
      } else if (wasMissing && isPaid) {
        // Recovered!
        await pool.query(
          `UPDATE book_of_business SET months_missing = 0, resolution = 'recovered', updated_at = NOW() WHERE id = $1`,
          [client.id]
        );
        recoveredCount++;
      }
    }

    // Also update last_commission_date and amount for paid clients
    for (const rec of commRecords.rows) {
      await pool.query(
        `UPDATE book_of_business 
         SET last_commission_date = $1, last_commission_amount = $2, updated_at = NOW()
         WHERE LOWER(TRIM(client_full_name)) = $3 AND LOWER(carrier) = $4 AND status = 'active'`,
        [period, rec.commission, rec.client_key, rec.carrier.toLowerCase()]
      );
    }

    res.json({ missingCount, recoveredCount, period, checkedClients: bobClients.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST - upload BOB export file from carrier
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const pool = getPool();
    const { carrier } = req.body;
    if (!carrier) return res.status(400).json({ error: 'Carrier name required' });

    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

    if (!rows.length) return res.status(400).json({ error: 'File is empty' });

    const headers = Object.keys(rows[0]).map(h => h.toLowerCase());

    const findCol = (terms) => {
      const idx = headers.findIndex(h => terms.some(t => h.includes(t)));
      return idx >= 0 ? Object.keys(rows[0])[idx] : null;
    };

    const clientCol = findCol(['client', 'member', 'subscriber', 'insured', 'name']);
    const agentCol = findCol(['agent', 'producer', 'writing', 'rep']);
    const policyCol = findCol(['policy', 'member id', 'contract', 'certificate']);
    const effDateCol = findCol(['effective', 'eff date', 'start']);
    const planCol = findCol(['plan', 'product', 'benefit']);

    if (!clientCol) return res.status(400).json({ error: 'Could not find client name column' });

    let added = 0;
    let updated = 0;

    for (const row of rows) {
      const client = String(row[clientCol] || '').trim();
      if (!client) continue;

      const agent = agentCol ? String(row[agentCol] || '').trim() : '';
      const policyNumber = policyCol ? String(row[policyCol] || '').trim() : '';
      const effectiveDate = effDateCol ? formatDate(row[effDateCol]) : '';
      const planType = planCol ? String(row[planCol] || '').trim() : '';

      // Upsert — update if exists, insert if not
      const existing = await pool.query(
        `SELECT id FROM book_of_business WHERE LOWER(TRIM(client_full_name)) = LOWER($1) AND carrier = $2`,
        [client, carrier]
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE book_of_business SET agent_name = COALESCE(NULLIF($1,''), agent_name), policy_number = COALESCE(NULLIF($2,''), policy_number), effective_date = COALESCE(NULLIF($3,''), effective_date), plan_type = COALESCE(NULLIF($4,''), plan_type), source = 'bob_export', status = 'active', updated_at = NOW() WHERE id = $5`,
          [agent, policyNumber, effectiveDate, planType, existing.rows[0].id]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO book_of_business (agent_name, carrier, client_full_name, policy_number, effective_date, plan_type, source, status) VALUES ($1, $2, $3, $4, $5, $6, 'bob_export', 'active')`,
          [agent, carrier, client, policyNumber, effectiveDate, planType]
        );
        added++;
      }
    }

    // Log the upload
    await pool.query(
      `INSERT INTO bob_uploads (original_name, carrier, row_count, uploaded_by) VALUES ($1, $2, $3, $4)`,
      [req.file.originalname, carrier, rows.length, req.user.id]
    );

    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({ added, updated, total: added + updated, carrier });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST - auto-build BOB from existing commission statements
router.post('/build-from-statements', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.role === 'admin';
    const agentFilter = isAdmin ? '' : `AND agent_name ILIKE '%${req.user.name}%'`;

    // Get all unique client+carrier combos from commission records
    const records = await pool.query(
      `SELECT DISTINCT ON (LOWER(TRIM(client_full_name)), carrier)
        client_full_name, carrier, agent_name, effective_date, commission, payment_period
       FROM commission_records
       WHERE client_full_name != '' AND commission > 0 ${agentFilter}
       ORDER BY LOWER(TRIM(client_full_name)), carrier, created_at DESC`
    );

    let added = 0;
    let skipped = 0;

    for (const rec of records.rows) {
      const existing = await pool.query(
        `SELECT id FROM book_of_business WHERE LOWER(TRIM(client_full_name)) = LOWER($1) AND carrier = $2`,
        [rec.client_full_name, rec.carrier]
      );

      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO book_of_business (agent_name, carrier, client_full_name, effective_date, last_commission_date, last_commission_amount, source, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'statement', 'active')`,
          [rec.agent_name, rec.carrier, rec.client_full_name, rec.effective_date, rec.payment_period, rec.commission]
        );
        added++;
      } else {
        skipped++;
      }
    }

    res.json({ added, skipped, total: added + skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

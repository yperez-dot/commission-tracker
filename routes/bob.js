const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { normalizeAgentName } = require('../normalize');

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

// Find the real header row by scanning for known column names
function findHeaderRow(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const clientKeywords = ['member', 'client', 'subscriber', 'insured', 'firstname', 'lastname', 'name'];
  for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
    let matches = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const v = String(cell.v || '').toLowerCase().replace(/\s+/g, '');
        if (clientKeywords.some(k => v.includes(k))) matches++;
      }
    }
    if (matches >= 2) return r;
  }
  return 0;
}

// Parse BOB rows from a sheet, handling files with disclaimer rows at top
function parseBOBSheet(ws) {
  const headerRow = findHeaderRow(ws);
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, range: headerRow });
  if (!rows.length) return null;

  // Normalize all header keys to lowercase for matching
  const firstRow = rows[0];
  const keyMap = {};
  Object.keys(firstRow).forEach(k => { keyMap[k.toLowerCase().replace(/\s+/g, '')] = k; });

  const findKey = (terms) => {
    for (const t of terms) {
      if (keyMap[t]) return keyMap[t];
      // partial match
      const found = Object.keys(keyMap).find(k => k.includes(t));
      if (found) return keyMap[found];
    }
    return null;
  };

  // UHC BOB has separate first/last name columns
  const firstNameCol = findKey(['memberfirstname', 'firstname', 'first']);
  const lastNameCol = findKey(['memberlastname', 'lastname', 'last']);
  const clientCol = findKey(['membername', 'clientname', 'subscribername', 'name', 'client', 'member', 'subscriber']);
  const agentCol = findKey(['agentname', 'writingagentname', 'agent', 'producer']);
  const policyCol = findKey(['membernumber', 'policynumber', 'memberid', 'policy', 'certificate', 'applicationnumber', 'policyid']);
  const effDateCol = findKey(['policyeffectivedate', 'effectivedate', 'effective', 'effdate', 'startdate']);
  const planCol = findKey(['planname', 'plan', 'product', 'benefit']);
  const statusCol = findKey(['memberstatus', 'planstatus', 'status']);

  return rows.map(row => {
    // Build full name from first+last if no combined name col
    let clientName = '';
    if (firstNameCol && lastNameCol) {
      const first = String(row[firstNameCol] || '').trim();
      const last = String(row[lastNameCol] || '').trim();
      clientName = [first, last].filter(Boolean).join(' ');
    } else if (clientCol) {
      clientName = String(row[clientCol] || '').trim();
    }

    return {
      client: clientName,
      agent: agentCol ? normalizeAgentName(String(row[agentCol] || '').trim()) : '',
      policyNumber: policyCol ? String(row[policyCol] || '').trim() : '',
      effectiveDate: effDateCol ? formatDate(row[effDateCol]) : '',
      planType: planCol ? String(row[planCol] || '').trim() : '',
      status: statusCol ? String(row[statusCol] || '').trim().toLowerCase() : 'active',
    };
  }).filter(r => r.client && r.client.length > 1);
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { carrier, agent, status, missing } = req.query;
    let where = ['1=1'];
    let params = [];
    let idx = 1;
    if (req.user.role === 'agent') { where.push(`agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`); }
    if (carrier) { where.push(`carrier = $${idx++}`); params.push(carrier); }
    if (agent) { where.push(`agent_name = $${idx++}`); params.push(agent); }
    if (status) { where.push(`status = $${idx++}`); params.push(status); }
    if (missing === 'true') { where.push(`months_missing > 0 AND status = 'active'`); }
    const result = await pool.query(
      `SELECT * FROM book_of_business WHERE ${where.join(' AND ')} ORDER BY months_missing DESC, client_full_name ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.role === 'admin';
    const af = isAdmin ? '' : `AND agent_name ILIKE '%${req.user.name}%'`;
    const total = await pool.query(`SELECT COUNT(*) as count FROM book_of_business WHERE status = 'active' ${af}`);
    const missing = await pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(last_commission_amount),0) as at_risk FROM book_of_business WHERE months_missing > 0 AND status = 'active' ${af}`);
    const newThis = await pool.query(`SELECT COUNT(*) as count FROM book_of_business WHERE created_at > NOW() - INTERVAL '35 days' ${af}`);
    const byCarrier = await pool.query(`SELECT carrier, COUNT(*) as count, MAX(updated_at) as last_updated FROM book_of_business WHERE status = 'active' ${af} GROUP BY carrier ORDER BY count DESC`);
    const bySource = await pool.query(`SELECT source, COUNT(*) as count FROM book_of_business WHERE status = 'active' ${af} GROUP BY source`);
    res.json({
      totalActive: parseInt(total.rows[0].count),
      missingCount: parseInt(missing.rows[0].count),
      atRisk: parseFloat(missing.rows[0].at_risk),
      newEnrollments: parseInt(newThis.rows[0].count),
      byCarrier: byCarrier.rows,
      bySource: bySource.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
    await pool.query(`UPDATE book_of_business SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/check-renewals', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { period } = req.body;
    if (!period) return res.status(400).json({ error: 'Period required' });
    const isAdmin = req.user.role === 'admin';
    const af = isAdmin ? '' : `AND agent_name ILIKE '%${req.user.name}%'`;

    // Normalize period to YYYYMM for flexible matching
    function normalizePeriod(p) {
      if (!p) return null;
      const s = String(p).trim();
      // Already YYYYMM
      if (s.match(/^\d{6}$/)) return s;
      // MM/DD/YYYY or MM/YYYY
      const mmyyyy = s.match(/^(\d{1,2})\/(?:\d{2}\/)?(\d{4})$/);
      if (mmyyyy) return mmyyyy[2] + mmyyyy[1].padStart(2,'0');
      // Month name like FEB2026 or FEB 2026
      const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
      const named = s.toLowerCase().match(/^([a-z]{3})\s*(\d{4})$/);
      if (named && months[named[1]]) return named[2] + months[named[1]];
      return null;
    }

    const targetNorm = normalizePeriod(period);

    // Get all commission records — filter by normalized period
    const allRecords = await pool.query(
      `SELECT LOWER(TRIM(client_full_name)) as client_key, carrier, agent_name, commission, payment_period
       FROM commission_records WHERE commission > 0 ${af}`
    );

    // Match records whose period normalizes to the same YYYYMM
    const matchingRecords = allRecords.rows.filter(r => {
      const norm = normalizePeriod(r.payment_period);
      return norm && targetNorm && norm === targetNorm;
    });

    const paidSet = new Set(matchingRecords.map(r => `${r.client_key}|${r.carrier.toLowerCase()}`));

    const bobClients = await pool.query(`SELECT * FROM book_of_business WHERE status = 'active' ${af}`);
    let missingCount = 0, recoveredCount = 0;

    for (const client of bobClients.rows) {
      const key = `${client.client_full_name.toLowerCase().trim()}|${client.carrier.toLowerCase()}`;
      const wasMissing = client.months_missing > 0;
      const isPaid = paidSet.has(key);
      if (!isPaid) {
        await pool.query(`UPDATE book_of_business SET months_missing = months_missing + 1, updated_at = NOW() WHERE id = $1`, [client.id]);
        missingCount++;
      } else if (wasMissing && isPaid) {
        await pool.query(`UPDATE book_of_business SET months_missing = 0, resolution = 'recovered', updated_at = NOW() WHERE id = $1`, [client.id]);
        recoveredCount++;
      }
    }

    // Update last commission info for matched clients
    for (const rec of matchingRecords) {
      await pool.query(
        `UPDATE book_of_business SET last_commission_date = $1, last_commission_amount = $2, updated_at = NOW()
         WHERE LOWER(TRIM(client_full_name)) = $3 AND LOWER(carrier) = $4 AND status = 'active'`,
        [period, rec.commission, rec.client_key, rec.carrier.toLowerCase()]
      );
    }

    res.json({
      missingCount, recoveredCount, period,
      checkedClients: bobClients.rows.length,
      matchedRecords: matchingRecords.length
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const pool = getPool();
    const { carrier } = req.body;
    if (!carrier) return res.status(400).json({ error: 'Carrier name required' });

    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const parsed = parseBOBSheet(ws);

    if (!parsed) return res.status(400).json({ error: 'Could not parse file — no recognizable columns found' });
    if (!parsed.length) return res.status(400).json({ error: 'No client records found in file' });

    let added = 0, updated = 0;
    for (const r of parsed) {
      const isTermed = r.status.includes('term') || r.status.includes('cancel') || r.status.includes('inactive');
      const recordStatus = isTermed ? 'inactive' : 'active';

      const existing = await pool.query(
        `SELECT id FROM book_of_business WHERE LOWER(TRIM(client_full_name)) = LOWER($1) AND carrier = $2`,
        [r.client, carrier]
      );
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE book_of_business SET agent_name = COALESCE(NULLIF($1,''), agent_name), policy_number = COALESCE(NULLIF($2,''), policy_number), effective_date = COALESCE(NULLIF($3,''), effective_date), plan_type = COALESCE(NULLIF($4,''), plan_type), source = 'bob_export', status = $5, updated_at = NOW() WHERE id = $6`,
          [r.agent, r.policyNumber, r.effectiveDate, r.planType, recordStatus, existing.rows[0].id]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO book_of_business (agent_name, carrier, client_full_name, policy_number, effective_date, plan_type, source, status) VALUES ($1, $2, $3, $4, $5, $6, 'bob_export', $7)`,
          [r.agent, carrier, r.client, r.policyNumber, r.effectiveDate, r.planType, recordStatus]
        );
        added++;
      }
    }

    await pool.query(
      `INSERT INTO bob_uploads (original_name, carrier, row_count, uploaded_by) VALUES ($1, $2, $3, $4)`,
      [req.file.originalname, carrier, parsed.length, req.user.id]
    );

    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.json({ added, updated, total: added + updated, carrier });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/build-from-statements', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.role === 'admin';
    const af = isAdmin ? '' : `AND agent_name ILIKE '%${req.user.name}%'`;
    const records = await pool.query(
      `SELECT DISTINCT ON (LOWER(TRIM(client_full_name)), carrier) client_full_name, carrier, agent_name, effective_date, commission, payment_period FROM commission_records WHERE client_full_name != '' AND commission > 0 ${af} ORDER BY LOWER(TRIM(client_full_name)), carrier, created_at DESC`
    );
    let added = 0, skipped = 0;
    for (const rec of records.rows) {
      const existing = await pool.query(
        `SELECT id FROM book_of_business WHERE LOWER(TRIM(client_full_name)) = LOWER($1) AND carrier = $2`,
        [rec.client_full_name, rec.carrier]
      );
      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO book_of_business (agent_name, carrier, client_full_name, effective_date, last_commission_date, last_commission_amount, source, status) VALUES ($1, $2, $3, $4, $5, $6, 'statement', 'active')`,
          [rec.agent_name, rec.carrier, rec.client_full_name, rec.effective_date, rec.payment_period, rec.commission]
        );
        added++;
      } else { skipped++; }
    }
    res.json({ added, skipped, total: added + skipped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE a single BOB client
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM book_of_business WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');

const UPLOADS_DIR = path.join('/tmp', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function detectCarrierFromFilename(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  if (f.includes('commission_statement_2737247') || f.includes('uhc') || f.includes('united')) return 'UnitedHealthcare';
  if (f.includes('producerstatementreport')) return 'Aetna';
  if (f.includes('16326554') || f.includes('devoted')) return 'Devoted';
  if (f.includes('the_health_experts_insurance_med_comm')) return 'Aetna';
  if (f.includes('commissiondata') || f.includes('yahoska_perez_med_comm') || f.includes('humana')) return 'Humana';
  if (f.includes('statement-health_experts') || f.includes('statement_health_experts')) return 'BSI';
  if (f.includes('the_health_experts_insurance_statement') || f.includes('nhp')) return 'NHP';
  if (f.includes('commissions_ledger') || f.includes('solis')) return 'Solis';
  if (f.includes('commission-statement') || f.includes('integrity')) return 'Integrity';
  if (f.includes('cigna')) return 'Cigna';
  if (f.includes('wellcare')) return 'WellCare';
  if (f.includes('sunshine')) return 'Sunshine Health';
  if (f.includes('molina')) return 'Molina';
  if (f.includes('ambetter')) return 'Ambetter';
  if (f.includes('florida_blue') || f.includes('bcbs') || f.includes('floridablue')) return 'Florida Blue';
  if (f.includes('oscar')) return 'Oscar Health';
  return 'Unknown';
}

function normalizeBSICarrier(company) {
  const c = String(company || '').toLowerCase();
  if (c.includes('united') || c.includes('uhc')) return 'UnitedHealthcare';
  if (c.includes('humana') && c.includes('devoted')) return 'Humana/Devoted';
  if (c.includes('humana')) return 'Humana';
  if (c.includes('devoted')) return 'Devoted';
  if (c.includes('aetna')) return 'Aetna';
  if (c.includes('nhp')) return 'NHP';
  return String(company || '').trim();
}

function normalizeNHPCarrier(carrierMonth) {
  const c = String(carrierMonth || '').toLowerCase();
  if (c.includes('aetna')) return 'Aetna';
  if (c.includes('cigna')) return 'Cigna';
  if (c.includes('devoted')) return 'Devoted';
  if (c.includes('florida blue') || c.includes('floridablue')) return 'Florida Blue';
  if (c.includes('gold kidney')) return 'Gold Kidney';
  if (c.includes('humana')) return 'Humana';
  if (c.includes('oscar')) return 'Oscar Health';
  if (c.includes('simply')) return 'Simply';
  if (c.includes('united') || c.includes('uhc')) return 'UnitedHealthcare';
  if (c.includes('molina')) return 'Molina';
  if (c.includes('wellcare')) return 'WellCare';
  return String(carrierMonth || '').split(' - ')[0].trim();
}

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

function isBSIFile(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.includes('statement-health_experts') || f.includes('statement_health_experts');
}

function isNHPFile(filename) {
  const f = filename.toLowerCase().replace(/\s+/g, '_');
  return f.includes('the_health_experts_insurance_statement');
}

function parseBSIRows(rows) {
  const records = [];
  let dataStarted = false;
  for (const row of rows) {
    const vals = Object.values(row);
    if (!dataStarted) {
      const str = vals.map(v => String(v || '').toLowerCase()).join('|');
      if (str.includes('agent') && str.includes('client') && str.includes('commission')) {
        dataStarted = true;
        continue;
      }
      continue;
    }
    const agent = String(vals[1] || '').trim();
    const company = String(vals[2] || '').trim();
    const policyNumber = String(vals[3] || '').trim();
    const client = String(vals[4] || '').trim();
    const effectiveDate = formatDate(vals[5]);
    const commission = parseFloat(vals[6]) || 0;
    if (!client) continue;
    records.push({
      agent: agent || 'Unknown',
      carrier: normalizeBSICarrier(company),
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification: commission < 0 ? 'Chargeback' : 'Override',
      period: 'Unknown',
      policyNumber,
      raw: row
    });
  }
  return records;
}

function parseNHPRows(wb) {
  const records = [];
  const ws = wb.Sheets[wb.SheetNames[0]];

  // Find header row by scanning for 'Override' column
  const range = XLSX.utils.decode_range(ws['!ref']);
  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 20, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && String(cell.v || '').toLowerCase().trim() === 'override') {
        headerRow = r;
        break;
      }
    }
    if (headerRow >= 0) break;
  }

  if (headerRow < 0) return records;

  // Read using that header row
  const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: '', range: headerRow });

  for (const row of rows) {
    const agent = String(row['Agent'] || '').trim();
    const carrierRaw = String(row['Carrier-Statement Month'] || '').trim();
    const client = String(row['Subscriber Name'] || '').trim();
    const policyNumber = String(row['Policy Number'] || '').trim();
    const effectiveDate = formatDate(row['Policy Effective Date']);
    const period = formatDate(row['Commission Month']);
    const status = String(row['Status'] || '').trim();
    const commission = parseFloat(row['Override']) || 0;

    if (!client || commission === 0) continue;

    records.push({
      agent: agent || 'Unknown',
      carrier: normalizeNHPCarrier(carrierRaw),
      client,
      effectiveDate,
      premium: 0,
      commission,
      classification: commission < 0 ? 'Chargeback' : (status || 'Override'),
      period: period || 'Unknown',
      policyNumber,
      raw: row
    });
  }
  return records;
}

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const pool = getPool();

    const existing = await pool.query(
      'SELECT id FROM uploads WHERE original_name = $1',
      [req.file.originalname]
    );
    if (existing.rows.length > 0) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(409).json({
        error: `"${req.file.originalname}" has already been uploaded. Delete the existing file first if you want to re-upload it.`
      });
    }

    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];

    let records;
    if (isBSIFile(req.file.originalname)) {
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      records = parseBSIRows(rows);
    } else if (isNHPFile(req.file.originalname)) {
      records = parseNHPRows(wb);
    } else {
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      if (!rows.length) return res.status(400).json({ error: 'File is empty' });
      const headers = Object.keys(rows[0]);
      const sample = rows.slice(0, 3);
      const mapping = await mapColumnsWithAI(headers, sample);
      records = parseRows(rows, mapping, req.file.originalname);
    }

    if (!records.length) return res.status(400).json({ error: 'No records found in file' });

    const commissionSum = records.reduce((s, r) => s + (r.commission || 0), 0);
    const carriers = [...new Set(records.map(r => r.carrier).filter(Boolean))];

    const uploadResult = await pool.query(
      'INSERT INTO uploads (filename, original_name, carrier, row_count, commission_sum, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [req.file.filename, req.file.originalname, carriers.join(', '), records.length, commissionSum, req.user.id]
    );
    const uploadId = uploadResult.rows[0].id;

    for (const r of records) {
      await pool.query(
        `INSERT INTO commission_records
          (upload_id, agent_name, carrier, client_full_name, effective_date, premium, commission, classification, payment_period, policy_number, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [uploadId, r.agent, r.carrier, r.client, r.effectiveDate, r.premium || 0, r.commission || 0, r.classification, r.period, r.policyNumber, JSON.stringify(r.raw)]
      );
    }

    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({
      uploadId,
      filename: req.file.originalname,
      rowCount: records.length,
      commissionSum,
      carriers,
      preview: records.slice(0, 5)
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/uploads', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT u.*, usr.name as uploaded_by_name
      FROM uploads u
      LEFT JOIN users usr ON u.uploaded_by = usr.id
      ORDER BY u.uploaded_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/uploads/:id', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM uploads WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function mapColumnsWithAI(headers, sample) {
  try {
    const prompt = `You are parsing an insurance carrier commission statement Excel file.

Column headers found: ${headers.join(', ')}

Sample row: ${JSON.stringify(sample[0])}

Map these columns to our schema. Respond ONLY with a valid JSON object, no markdown, no explanation:
{
  "agent": "column name for agent/producer/writing agent name, or null",
  "carrier": "column name for insurance carrier/company name, or null",
  "client": "column name for client/member/subscriber/insured full name, or null",
  "effectiveDate": "column name for policy effective date, or null",
  "premium": "column name for premium/modal premium amount, or null",
  "commission": "column name for commission/payment/amount paid (the money earned), required - best guess if unclear",
  "classification": "column name for payment type: renewal/new business/advance/chargeback, or null",
  "period": "column name for payment period/statement month, or null",
  "policyNumber": "column name for policy/member ID/contract number, or null"
}`;

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = msg.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (e) {
    console.error('AI mapping failed, using heuristics:', e.message);
    return heuristicMapping(headers);
  }
}

function heuristicMapping(headers) {
  const h = headers.map(x => x.toLowerCase());
  const find = (terms) => headers[h.findIndex(x => terms.some(t => x.includes(t)))] || null;
  return {
    agent: find(['agent', 'producer', 'writing', 'rep']),
    carrier: find(['carrier', 'company', 'insurer', 'plan']),
    client: find(['client', 'member', 'subscriber', 'insured', 'name']),
    effectiveDate: find(['effective', 'eff date', 'policy date', 'start']),
    premium: find(['premium', 'modal', 'annualized']),
    commission: find(['commission', 'payment', 'amount', 'earned', 'comp']),
    classification: find(['type', 'class', 'category', 'new', 'renewal']),
    period: find(['period', 'month', 'statement', 'pay date']),
    policyNumber: find(['policy', 'member id', 'contract', 'certificate'])
  };
}

function parseRows(rows, mapping, filename) {
  return rows
    .map(row => ({
      agent: mapping.agent ? String(row[mapping.agent] || '').trim() : filename.replace(/[_\d.xlsx]/g, ' ').trim(),
      carrier: mapping.carrier ? String(row[mapping.carrier] || '').trim() : detectCarrierFromFilename(filename),
      client: mapping.client ? String(row[mapping.client] || '').trim() : '',
      effectiveDate: mapping.effectiveDate ? formatDate(row[mapping.effectiveDate]) : '',
      premium: mapping.premium ? parseFloat(row[mapping.premium]) || 0 : 0,
      commission: mapping.commission ? parseFloat(row[mapping.commission]) || 0 : 0,
      classification: mapping.classification ? String(row[mapping.classification] || '').trim() : 'Unknown',
      period: mapping.period ? String(row[mapping.period] || '').trim() : 'Unknown',
      policyNumber: mapping.policyNumber ? String(row[mapping.policyNumber] || '').trim() : '',
      raw: row
    }))
    .filter(r => r.commission > 0 || r.premium > 0 || r.client);
}

module.exports = router;

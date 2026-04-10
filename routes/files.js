const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!rows.length) return res.status(400).json({ error: 'File is empty' });

    const headers = Object.keys(rows[0]);
    const sample = rows.slice(0, 3);

    const mapping = await mapColumnsWithAI(headers, sample);
    const records = parseRows(rows, mapping, req.file.originalname);

    const db = getDb();
    const commissionSum = records.reduce((s, r) => s + (r.commission || 0), 0);
    const carriers = [...new Set(records.map(r => r.carrier).filter(Boolean))];

    const uploadResult = db.prepare(`
      INSERT INTO uploads (filename, original_name, carrier, row_count, commission_sum, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.file.filename, req.file.originalname, carriers.join(', '), records.length, commissionSum, req.user.id);

    const uploadId = uploadResult.lastInsertRowid;
    const insertRecord = db.prepare(`
      INSERT INTO commission_records
        (upload_id, agent_name, carrier, client_full_name, effective_date, premium, commission, classification, payment_period, policy_number, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((recs) => {
      recs.forEach(r => insertRecord.run(
        uploadId, r.agent, r.carrier, r.client, r.effectiveDate,
        r.premium || 0, r.commission || 0, r.classification, r.period, r.policyNumber,
        JSON.stringify(r.raw)
      ));
    });
    insertMany(records);

    res.json({
      uploadId,
      filename: req.file.originalname,
      rowCount: records.length,
      commissionSum,
      carriers,
      mapping,
      preview: records.slice(0, 5)
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/uploads', requireAuth, (req, res) => {
  const db = getDb();
  const uploads = db.prepare(`
    SELECT u.*, usr.name as uploaded_by_name
    FROM uploads u
    LEFT JOIN users usr ON u.uploaded_by = usr.id
    ORDER BY u.uploaded_at DESC
  `).all();
  res.json(uploads);
});

router.delete('/uploads/:id', requireAuth, (req, res) => {
  const db = getDb();
  const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(req.params.id);
  if (!upload) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM uploads WHERE id = ?').run(req.params.id);
  const filePath = path.join(UPLOADS_DIR, upload.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  res.json({ success: true });
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
      carrier: mapping.carrier ? String(row[mapping.carrier] || '').trim() : 'Unknown',
      client: mapping.client ? String(row[mapping.client] || '').trim() : '',
      effectiveDate: mapping.effectiveDate ? String(row[mapping.effectiveDate] || '').trim() : '',
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

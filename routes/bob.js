const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { normalizeAgentName } = require('./normalize');
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

function parseBOBSheet(ws) {
  const headerRow = findHeaderRow(ws);
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, range: headerRow });
  if (!rows.length) return null;

  const firstRow = rows[0];
  const keyMap = {};
  Object.keys(firstRow).forEach(k => { keyMap[k.toLowerCase().replace(/\s+/g, '')] = k; });

  const findKey = (terms) => {
    for (const t of terms) {
      if (keyMap[t]) return keyMap[t];
      const found = Object.keys(keyMap).find(k => k.includes(t));
      if (found) return keyMap[found];
    }
    return null;
  };

  const firstNameCol = findKey(['memberfirstname', 'firstname', 'first']);
  const lastNameCol = findKey(['memberlastname', 'lastname', 'last']);
  const clientCol = findKey(['membername', 'clientname', 'subscribername', 'name', 'client', 'member', 'subscriber']);
  const agentCol = findKey(['agentname', 'writingagentname', 'agent', 'producer']);
  const policyCol = findKey(['membernumber', 'policynumber', 'memberid', 'policy', 'certificate', 'applicationnumber', 'policyid']);
  const effDateCol = findKey(['policyeffectivedate', 'effectivedate', 'effective', 'effdate', 'startdate']);
  const planCol = findKey(['planname', 'plan', 'product', 'benefit']);
  const statusCol = findKey(['memberstatus', 'planstatus', 'status']);

  return rows.map(row => {
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

// ─── GET all BOB clients ──────────────────────────────────────────────────────
// Resolve effective agency
function getAgency(req) {
  if (req.user.role !== 'admin') return null;
  const override = req.headers['x-agency-override'];
  const agency = override !== undefined ? (override || null) : (req.user.agency || null);
  return agency;
}

// Returns SQL filter clause for agency isolation — based on carrier
// BSI carriers: Mutual of Omaha, United of Omaha
// THEI carriers: everything else
function agencyFilter(req, alias) {
  const agency = getAgency(req);
  const col = alias ? alias + '.carrier' : 'carrier';
  if (!agency) return null;
  if (agency.toLowerCase().includes('broker society')) {
    return col + " IN ('Mutual of Omaha', 'United of Omaha', 'Fidelity Life', 'Instabrain', 'F&G', 'Fidelity & Guaranty', 'American Amicable', 'Transamerica', 'Ethos', 'American Home Life', 'National Life Group')";
  }
  // Health Experts: exclude all BSI carriers
  return col + " NOT IN ('Mutual of Omaha', 'United of Omaha', 'Fidelity Life', 'Instabrain', 'F&G', 'Fidelity & Guaranty', 'American Amicable', 'Transamerica', 'Ethos', 'American Home Life', 'National Life Group')";
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { carrier, agent, status, missing, lob } = req.query;
    let where = ['1=1'];
    let params = [];
    let idx = 1;
    if (req.user.role === 'agent') { where.push(`b.agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`); }
    else {
      const af = agencyFilter(req, null);
      if (af) { where.push(af); }
    }
    if (carrier) { where.push(`b.carrier = $${idx++}`); params.push(carrier); }
    if (agent) { where.push(`b.agent_name = $${idx++}`); params.push(agent); }
    if (status) { where.push(`b.status = $${idx++}`); params.push(status); }
    if (missing === 'true') { where.push(`b.months_missing > 0 AND b.status = 'active'`); }
    if (lob) { where.push(`($${idx} = 'all' OR LOWER(cr.lob) = LOWER($${idx}))`); params.push(lob); idx++; }
    
    // If LOB filter is present, join with commission_records to get LOB
    let query;
    if (lob) {
      query = `
        SELECT DISTINCT ON (b.id) b.*
        FROM book_of_business b
        LEFT JOIN commission_records cr
          ON LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(cr.client_full_name))
          AND LOWER(TRIM(b.carrier)) = LOWER(TRIM(cr.carrier))
          AND LOWER(TRIM(b.agent_name)) = LOWER(TRIM(cr.agent_name))
        WHERE ${where.join(' AND ')}
        ORDER BY b.id, cr.created_at DESC
      `;
    } else {
      query = `SELECT * FROM book_of_business b WHERE ${where.join(' AND ')} ORDER BY b.months_missing DESC, b.client_full_name ASC`;
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET summary ──────────────────────────────────────────────────────────────
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.role === 'admin' && !getAgency(req);
    const af = req.user.role === 'agent'
      ? `AND agent_name ILIKE '%${req.user.name}%'`
      : (req.user.role === 'admin' && getAgency(req))
        ? `AND carrier IN (SELECT DISTINCT carrier FROM commission_records WHERE ${agencyFilter(req, null)})`
        : '';
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

// ─── PATCH single client ──────────────────────────────────────────────────────
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
    
    // Update BOB record
    await pool.query(`UPDATE book_of_business SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    
    // Cascade plan_change status to policy_status table
    if (status === 'plan_change') {
      // Get BOB record details for cascade
      const bobRecord = await pool.query(
        `SELECT client_full_name, carrier, agent_name FROM book_of_business WHERE id = $1`,
        [req.params.id]
      );
      
      if (bobRecord.rows.length > 0) {
        const { client_full_name, carrier, agent_name } = bobRecord.rows[0];
        const updated_by = req.user.name || req.user.email;
        
        console.log('[BOB-API] Cascading PLAN_CHANGE status to policy_status...');
        await pool.query(`
          INSERT INTO policy_status (client_full_name, carrier, agent_name, status, notes, updated_by, updated_at)
          VALUES ($1, $2, $3, 'plan_change', $4, $5, NOW())
          ON CONFLICT (client_full_name, carrier, agent_name)
          DO UPDATE SET status = 'plan_change', notes = $4, updated_by = $5, updated_at = NOW()
        `, [client_full_name, carrier, agent_name, notes || null, updated_by]);
        console.log('[BOB-API] Policy status updated to plan_change');
      }
    }
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST check-renewals ──────────────────────────────────────────────────────
router.post('/check-renewals', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { period, scope } = req.body;
    if (!period) return res.status(400).json({ error: 'Period required' });
    const isAdmin = req.user.role === 'admin' && !getAgency(req);

    // Default scope for THEI admins: check ONLY Yahoska + Katy's BOB
    // (their personal production). Pass scope='all' to check everyone.
    // Per Yahoska 2026-05-12: "We only check for mine and Katy's BOB."
    const THEI_PRINCIPAL_FILTER = `AND (
      LOWER(agent_name) LIKE '%yahoska%'
      OR LOWER(agent_name) LIKE '%katy%'
      OR LOWER(agent_name) LIKE '%perez, yahoska%'
      OR LOWER(agent_name) LIKE '%robles, katy%'
    )`;

    let af = '';
    if (req.user.role === 'agent') {
      af = `AND agent_name ILIKE '%${req.user.name}%'`;
    } else if (req.user.role === 'admin' && getAgency(req)) {
      af = `AND carrier IN (SELECT DISTINCT carrier FROM commission_records WHERE ${agencyFilter(req, null)})`;
    } else if (scope === 'all') {
      af = ''; // explicit opt-in to check entire BOB
    } else {
      af = THEI_PRINCIPAL_FILTER; // default: Yahoska + Katy only
    }

    function normalizePeriod(p) {
      if (!p) return null;
      const s = String(p).trim();
      if (s.match(/^\d{6}$/)) return s;
      const mmyyyy = s.match(/^(\d{1,2})\/(?:\d{2}\/)?(\d{4})$/);
      if (mmyyyy) return mmyyyy[2] + mmyyyy[1].padStart(2,'0');
      const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
      const named = s.toLowerCase().match(/^([a-z]{3})\s*(\d{4})$/);
      if (named && months[named[1]]) return named[2] + months[named[1]];
      return null;
    }

    const targetNorm = normalizePeriod(period);
    const allRecords = await pool.query(
      `SELECT LOWER(TRIM(client_full_name)) as client_key, carrier, agent_name, commission, payment_period FROM commission_records WHERE commission > 0 ${af}`
    );
    const matchingRecords = allRecords.rows.filter(r => {
      const norm = normalizePeriod(r.payment_period);
      return norm && targetNorm && norm === targetNorm;
    });

    function normName(name) {
      if (!name) return '';
      const s = String(name).toLowerCase().trim();
      if (s.includes(',')) {
        const [last, first] = s.split(',').map(p => p.trim());
        return `${first} ${last}`.replace(/\s+/g, ' ').trim();
      }
      return s.replace(/\s+/g, ' ').trim();
    }
    function normCarrier(c) {
      const s = String(c || '').toLowerCase();
      if (s.includes('united') || s.includes('uhc')) return 'unitedhealthcare';
      if (s.includes('humana')) return 'humana';
      if (s.includes('aetna')) return 'aetna';
      return s;
    }

    // CRITICAL: Match on client_name|carrier ONLY - do NOT include effective_date
    // Effective dates vary across different statement sources (BSI, NHP, direct carrier)
    // and would cause false "missing" flags for the same client
    const paidSet = new Set(matchingRecords.map(r => `${normName(r.client_key)}|${normCarrier(r.carrier)}`));
    const paidLastNameSet = new Set(matchingRecords.map(r => {
      const n = normName(r.client_key);
      return `${n.split(' ').pop()}|${normCarrier(r.carrier)}`;
    }));

    const bobClients = await pool.query(`SELECT * FROM book_of_business WHERE status = 'active' ${af}`);
    let missingCount = 0, recoveredCount = 0;

    for (const client of bobClients.rows) {
      const normN = normName(client.client_full_name);
      const normC = normCarrier(client.carrier);
      const key = `${normN}|${normC}`;
      const lastKey = `${normN.split(' ').pop()}|${normC}`;
      const wasMissing = client.months_missing > 0;
      const isPaid = paidSet.has(key) || paidLastNameSet.has(lastKey);
      if (!isPaid) {
        await pool.query(`UPDATE book_of_business SET months_missing = months_missing + 1, updated_at = NOW() WHERE id = $1`, [client.id]);
        missingCount++;
      } else if (wasMissing && isPaid) {
        await pool.query(`UPDATE book_of_business SET months_missing = 0, resolution = 'recovered', updated_at = NOW() WHERE id = $1`, [client.id]);
        recoveredCount++;
      }
    }

    for (const rec of matchingRecords) {
      await pool.query(
        `UPDATE book_of_business SET last_commission_date = $1, last_commission_amount = $2, updated_at = NOW()
         WHERE LOWER(TRIM(client_full_name)) = $3 AND LOWER(carrier) = $4 AND status = 'active'`,
        [period, rec.commission, rec.client_key, rec.carrier.toLowerCase()]
      );
    }

    res.json({ missingCount, recoveredCount, period, checkedClients: bobClients.rows.length, matchedRecords: matchingRecords.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST upload BOB export ───────────────────────────────────────────────────
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

// ─── POST build-from-statements (upsert — safe to run multiple times) ─────────
router.post('/build-from-statements', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.role === 'admin' && !getAgency(req);
    const af = req.user.role === 'agent'
      ? `AND agent_name ILIKE '%${req.user.name}%'`
      : (req.user.role === 'admin' && getAgency(req))
        ? `AND carrier IN (SELECT DISTINCT carrier FROM commission_records WHERE ${agencyFilter(req, null)})`
        : '';

    // Helper function to normalize name for dedup (removes middle initials/names)
    // "Donald A Salmon" → "donald salmon"
    // "SALMON, DONALD A" → "donald salmon"
    const normalizeNameForDedup = (name) => {
      if (!name) return '';
      let normalized = name.toLowerCase().trim();
      
      // Handle "LAST, FIRST MIDDLE" format
      if (normalized.includes(',')) {
        const parts = normalized.split(',').map(p => p.trim());
        const lastName = parts[0];
        const firstPart = parts[1] || '';
        const firstWords = firstPart.split(/\s+/);
        const firstName = firstWords[0] || '';
        return `${firstName} ${lastName}`.trim();
      }
      
      // Handle "FIRST MIDDLE LAST" format - keep first and last word only
      const words = normalized.split(/\s+/).filter(w => w.length > 0);
      if (words.length >= 3) {
        // Keep first and last word, skip middle
        return `${words[0]} ${words[words.length - 1]}`;
      }
      return words.join(' ');
    };

    // Get best record per client+carrier (most recent, with effective date preferred)
    // Normalize names to handle both "LAST, FIRST MIDDLE" and "FIRST MIDDLE LAST" formats
    // Examples: "CORP, JOYCE I." and "JOYCE CORP" both normalize to "joyce corp"
    const records = await pool.query(
      `SELECT DISTINCT ON (
         LOWER(TRIM(
           CASE 
             WHEN client_full_name ~ ',' THEN
               -- "LAST, FIRST MIDDLE" format: extract first word after comma + clean last name
               CONCAT(
                 TRIM(SPLIT_PART(SPLIT_PART(client_full_name, ',', 2), ' ', 1)),
                 ' ',
                 TRIM(regexp_replace(SPLIT_PART(client_full_name, ',', 1), '\\s+[A-Z]\\.?\\s*$', '', 'i'))
               )
             ELSE
               -- "FIRST MIDDLE LAST" format: remove single-letter middle initials
               regexp_replace(TRIM(client_full_name), '\\s+[A-Z]\\.?\\s+', ' ', 'gi')
           END
         )),
         LOWER(carrier)
       )
         client_full_name, carrier, agent_name, effective_date, commission, payment_period
       FROM commission_records
       WHERE client_full_name != '' AND client_full_name IS NOT NULL AND commission > 0 ${af}
       ORDER BY 
         LOWER(TRIM(
           CASE 
             WHEN client_full_name ~ ',' THEN
               CONCAT(
                 TRIM(SPLIT_PART(SPLIT_PART(client_full_name, ',', 2), ' ', 1)),
                 ' ',
                 TRIM(regexp_replace(SPLIT_PART(client_full_name, ',', 1), '\\s+[A-Z]\\.?\\s*$', '', 'i'))
               )
             ELSE
               regexp_replace(TRIM(client_full_name), '\\s+[A-Z]\\.?\\s+', ' ', 'gi')
           END
         )),
         LOWER(carrier),
         CASE WHEN effective_date IS NOT NULL AND effective_date != '' THEN 0 ELSE 1 END,
         created_at DESC`
    );

    let added = 0, updated = 0;
    for (const rec of records.rows) {
      // Check MedicarePro for status (Deceased, Prospect, etc.)
      const mpStatus = await pool.query(
        `SELECT status FROM medicarepro_sales
         WHERE LOWER(TRIM(client_name)) = LOWER(TRIM($1)) AND LOWER(carrier) = LOWER($2)
         ORDER BY uploaded_at DESC LIMIT 1`,
        [rec.client_full_name, rec.carrier]
      );
      
      // Map MedicarePro status → BOB status + resolution
      let bobStatus = 'active';
      let resolution = null;
      
      if (mpStatus.rows.length > 0) {
        const status = (mpStatus.rows[0].status || '').toLowerCase();
        if (status === 'deceased') {
          bobStatus = 'inactive';
          resolution = 'Deceased';
        } else if (status === 'inactive') {
          bobStatus = 'inactive';
          resolution = 'Termed';
        } else if (status === 'prospect') {
          bobStatus = 'active';
          resolution = 'Prospect';
        }
        // "Active" or "Active Client" → bobStatus='active', resolution=null (default)
      }

      const existing = await pool.query(
        `SELECT id, effective_date FROM book_of_business
         WHERE LOWER(TRIM(client_full_name)) = LOWER($1) AND LOWER(carrier) = LOWER($2)
         LIMIT 1`,
        [rec.client_full_name, rec.carrier]
      );

      if (existing.rows.length === 0) {
        // Insert new
        await pool.query(
          `INSERT INTO book_of_business
             (agent_name, carrier, client_full_name, effective_date, last_commission_date, last_commission_amount, source, status, resolution)
           VALUES ($1, $2, $3, $4, $5, $6, 'statement', $7, $8)`,
          [rec.agent_name, rec.carrier, rec.client_full_name, rec.effective_date, rec.payment_period, rec.commission, bobStatus, resolution]
        );
        added++;
      } else {
        // Update existing — always use the NEWEST effective date (plan changes)
        const existingEffDate = existing.rows[0].effective_date;
        let newEffDate = existingEffDate;
        if (rec.effective_date && rec.effective_date !== '') {
          // Parse both dates and keep the newer one
          const parseDate = (d) => { if (!d) return null; const p = d.split('/'); if (p.length===3) return new Date(p[2], p[0]-1, p[1]); return new Date(d); };
          const existingD = parseDate(existingEffDate);
          const newD = parseDate(rec.effective_date);
          if (!existingD || (newD && newD > existingD)) newEffDate = rec.effective_date;
        }
        await pool.query(
          `UPDATE book_of_business SET
             agent_name = COALESCE(NULLIF($1,''), agent_name),
             effective_date = COALESCE(NULLIF($2,''), effective_date),
             last_commission_date = $3,
             last_commission_amount = $4,
             status = $5,
             resolution = $6,
             updated_at = NOW()
           WHERE id = $7`,
          [rec.agent_name, newEffDate, rec.payment_period, rec.commission, bobStatus, resolution, existing.rows[0].id]
        );
        updated++;
      }
    }

    res.json({ added, updated, total: added + updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST reset-and-rebuild — clears ALL BOB and rebuilds fresh ───────────────
router.post('/reset-and-rebuild', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    // Delete all BOB records
    const deleted = await pool.query('DELETE FROM book_of_business');

    // Rebuild from statements using upsert logic with name normalization
    const records = await pool.query(
      `SELECT DISTINCT ON (
         LOWER(TRIM(
           CASE 
             WHEN client_full_name ~ ',' THEN
               CONCAT(
                 TRIM(SPLIT_PART(SPLIT_PART(client_full_name, ',', 2), ' ', 1)),
                 ' ',
                 TRIM(regexp_replace(SPLIT_PART(client_full_name, ',', 1), '\\s+[A-Z]\\.?\\s*$', '', 'i'))
               )
             ELSE
               regexp_replace(TRIM(client_full_name), '\\s+[A-Z]\\.?\\s+', ' ', 'gi')
           END
         )),
         LOWER(carrier)
       )
         client_full_name, carrier, agent_name, effective_date, commission, payment_period
       FROM commission_records
       WHERE client_full_name != '' AND client_full_name IS NOT NULL AND commission > 0
       ORDER BY 
         LOWER(TRIM(
           CASE 
             WHEN client_full_name ~ ',' THEN
               CONCAT(
                 TRIM(SPLIT_PART(SPLIT_PART(client_full_name, ',', 2), ' ', 1)),
                 ' ',
                 TRIM(regexp_replace(SPLIT_PART(client_full_name, ',', 1), '\\s+[A-Z]\\.?\\s*$', '', 'i'))
               )
             ELSE
               regexp_replace(TRIM(client_full_name), '\\s+[A-Z]\\.?\\s+', ' ', 'gi')
           END
         )),
         LOWER(carrier),
         CASE WHEN effective_date IS NOT NULL AND effective_date != '' THEN 0 ELSE 1 END,
         created_at DESC`
    );

    let added = 0;
    for (const rec of records.rows) {
      // Check MedicarePro for status (Deceased, Prospect, etc.)
      const mpStatus = await pool.query(
        `SELECT status FROM medicarepro_sales
         WHERE LOWER(TRIM(client_name)) = LOWER(TRIM($1)) AND LOWER(carrier) = LOWER($2)
         ORDER BY uploaded_at DESC LIMIT 1`,
        [rec.client_full_name, rec.carrier]
      );
      
      // Map MedicarePro status → BOB status + resolution
      let bobStatus = 'active';
      let resolution = null;
      
      if (mpStatus.rows.length > 0) {
        const status = (mpStatus.rows[0].status || '').toLowerCase();
        if (status === 'deceased') {
          bobStatus = 'inactive';
          resolution = 'Deceased';
        } else if (status === 'inactive') {
          bobStatus = 'inactive';
          resolution = 'Termed';
        } else if (status === 'prospect') {
          bobStatus = 'active';
          resolution = 'Prospect';
        }
      }

      await pool.query(
        `INSERT INTO book_of_business
           (agent_name, carrier, client_full_name, effective_date, last_commission_date, last_commission_amount, source, status, resolution)
         VALUES ($1, $2, $3, $4, $5, $6, 'statement', $7, $8)`,
        [rec.agent_name, rec.carrier, rec.client_full_name, rec.effective_date, rec.payment_period, rec.commission, bobStatus, resolution]
      );
      added++;
    }

    res.json({ deleted: deleted.rowCount, added, message: `Cleared ${deleted.rowCount} duplicates and rebuilt ${added} clean clients.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST bulk-delete by carrier ──────────────────────────────────────────────
router.post('/bulk-delete', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { carrier, ids } = req.body;

    // Delete by array of IDs (for checkbox bulk select)
    if (ids && Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(`DELETE FROM book_of_business WHERE id IN (${placeholders})`, ids);
      return res.json({ success: true, deleted: result.rowCount });
    }

    // Delete all by carrier
    if (!carrier) return res.status(400).json({ error: 'Carrier or ids required' });
    const result = await pool.query('DELETE FROM book_of_business WHERE carrier = $1', [carrier]);
    res.json({ success: true, deleted: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE single client ─────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM book_of_business WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET policy-status ────────────────────────────────────────────────────────
router.get('/policy-status', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT client_full_name, carrier, agent_name, status, termed_date, updated_by, updated_at 
       FROM policy_status 
       ORDER BY updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT policy-status ────────────────────────────────────────────────────────
router.put('/policy-status', requireAuth, async (req, res) => {
  console.log('[BOB-API] PUT /policy-status called');
  console.log('[BOB-API] Request body:', req.body);
  
  const pool = getPool();
  const dbClient = await pool.connect();
  
  try {
    const { client, carrier, agent, status, notes, termedDate } = req.body;
    console.log('[BOB-API] Parsed fields:', { client, carrier, agent, status, notes, termedDate });
    
    // Validate status values
    const validStatuses = ['active', 'termed', 'chase', 'pending', 'plan_change'];
    if (!validStatuses.includes(status)) {
      console.log('[BOB-API] Invalid status:', status);
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    console.log('[BOB-API] Status validation passed');
    
    const updated_by = req.user.name || req.user.email;
    
    // Start transaction - all 3 updates must succeed or roll back
    await dbClient.query('BEGIN');
    
    // 1. Save to policy_status (with termed_date)
    await dbClient.query(`
      INSERT INTO policy_status (client_full_name, carrier, agent_name, status, notes, termed_date, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (client_full_name, carrier, agent_name)
      DO UPDATE SET status = $4, notes = $5, termed_date = $6, updated_by = $7, updated_at = NOW()
    `, [client, carrier, agent, status, notes, termedDate || null, updated_by]);
    
    // 2. If status is 'termed', cascade to book_of_business and commission_records
    if (status === 'termed') {
      console.log('[BOB-API] Cascading TERMED status to BOB...');
      const bobResult = await dbClient.query(`
        UPDATE book_of_business
        SET status = 'termed',
            termed_date = $4,
            updated_at = NOW()
        WHERE LOWER(TRIM(client_full_name)) = LOWER(TRIM($1))
          AND LOWER(TRIM(carrier)) = LOWER(TRIM($2))
          AND LOWER(TRIM(agent_name)) = LOWER(TRIM($3))
      `, [client, carrier, agent, termedDate || null]);
      console.log('[BOB-API] BOB rows updated:', bobResult.rowCount);
      
      // 3. Flag commission_records
      console.log('[BOB-API] Flagging commission_records as termed...');
      const recordsResult = await dbClient.query(`
        UPDATE commission_records
        SET is_termed = true
        WHERE LOWER(TRIM(client_full_name)) = LOWER(TRIM($1))
          AND LOWER(TRIM(carrier)) = LOWER(TRIM($2))
          AND LOWER(TRIM(agent_name)) = LOWER(TRIM($3))
      `, [client, carrier, agent]);
      console.log('[BOB-API] Commission records updated:', recordsResult.rowCount);
    }
    
    // Commit transaction - all 3 updates succeeded
    console.log('[BOB-API] Committing transaction...');
    await dbClient.query('COMMIT');
    console.log('[BOB-API] Transaction committed successfully');
    res.json({ success: true });
  } catch (err) {
    // Roll back all changes if any update failed
    console.error('[BOB-API] Error occurred, rolling back:', err);
    await dbClient.query('ROLLBACK');
    console.log('[BOB-API] Transaction rolled back');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

// ─── GET /api/bob/coverage — check statement coverage for period ───────────
router.get('/coverage', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { period } = req.query;

    if (!period) {
      return res.status(400).json({ error: 'period required' });
    }

    // Get all carriers in Book of Business
    const bobCarriers = await pool.query(
      `SELECT DISTINCT carrier FROM book_of_business WHERE carrier IS NOT NULL AND carrier != '' ORDER BY carrier`
    );

    // Get all carriers that have records in commission_records for this period
    const coveredCarriers = await pool.query(
      `SELECT DISTINCT carrier FROM commission_records WHERE payment_period = $1 AND carrier IS NOT NULL AND carrier != ''`,
      [period]
    );

    const covered = new Set(coveredCarriers.rows.map(r => r.carrier.toLowerCase().trim()));

    const missing = bobCarriers.rows
      .filter(r => !covered.has(r.carrier.toLowerCase().trim()))
      .map(r => r.carrier);

    res.json({
      period,
      covered: coveredCarriers.rows.map(r => r.carrier),
      missingStatements: missing
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

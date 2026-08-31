const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getPool } = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');
const { normalizeAgentName } = require('./normalize');
const { safeUploadFilename, isAllowedUploadName } = require('./uploadSafe');
const { clientNameKey, clientNameKeySql } = require('../src/clientNameKey');
const { namesLooseMatch, normalizeCarrier, carriersMatch } = require('../src/matchingNormalize.cjs');
const {
  detectBobExportColumns,
  mapBobExportRow,
  identifiersFromRecord,
  namesMatchForIdentifiers,
  enrichBobClientsWithIdentifiers,
  stripPolicySuffix,
} = require('../src/bobClientIdentifiers');
const { backfillBobIdentifiers } = require('../src/bobIdentifierBackfill');
const { nhpHouseOnlyClientSql } = require('../src/nhpStatementParse');
const {
  buildMissingRenewalRows,
  buildMissingRenewalsPeriodOptions,
  isTheiPrincipalAgent,
  normName,
  normCarrier,
  normPeriod,
  MIN_STATEMENT_MONTH_RECORDS,
} = require('../src/missingRenewalsLogic');
const UPLOADS_DIR = path.join('/tmp', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, safeUploadFilename(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, isAllowedUploadName(file.originalname)),
});

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

  const columns = detectBobExportColumns(Object.keys(rows[0]));
  return rows
    .map((row) => mapBobExportRow(row, columns, { normalizeAgentName }))
    .filter((r) => r.client && r.client.length > 1);
}

function productionCarrierLikes(carrier) {
  const c = normalizeCarrier(carrier);
  if (c === 'humana') return ['%humana%'];
  if (c === 'devoted health') return ['%devoted%'];
  if (c === 'unitedhealthcare') return ['%unitedhealth%', '%uhc%'];
  if (c) return [`%${c.replace(/[^a-z0-9]+/g, '%')}%`];
  return [];
}

function normSqlId(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s\-]/g, '');
}

function recMatchesId(row, targetId) {
  if (!targetId) return false;
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  const candidates = [
    row.carrier_member_id, row.mbi, row.policy_number, row.policy_number_production,
    raw.UMID, raw.HIC, raw.MemberRecordLocator, raw.MBI, raw.MEDICARE_IDENTIFIER,
  ];
  return candidates.some((value) => {
    const recId = normSqlId(value);
    return recId && (recId === targetId || stripPolicySuffix(recId) === stripPolicySuffix(targetId));
  });
}

async function lookupRelatedIdentifiers(pool, bob) {
  const clientName = bob.client_full_name;
  const carrier = bob.carrier;
  const nameKey = clientNameKey(clientName);
  if (!nameKey || !carrier) return [];

  const memberId = normSqlId(bob.member_id);
  const policyNumber = String(bob.policy_number || '').trim();
  const lastToken = String(clientName || '').trim().split(/\s+/).filter(Boolean).pop() || '';
  const lastLike = lastToken.length > 1 ? `%${lastToken}%` : '';

  const [commission, productionByName, medicarepro] = await Promise.all([
    pool.query(
      `SELECT client_full_name, carrier, agent_name, policy_number, mbi, carrier_member_id, raw_data, plan_type,
              effective_date, 'commission' AS identifier_source
       FROM commission_records cr
       WHERE ${clientNameKeySql('cr')} = $1
          OR ($2 <> '' AND cr.client_full_name ILIKE $2)
       ORDER BY
         CASE WHEN NULLIF(TRIM(COALESCE(cr.carrier_member_id, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
         CASE WHEN NULLIF(TRIM(COALESCE(cr.mbi, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
         CASE WHEN NULLIF(TRIM(COALESCE(cr.policy_number, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
         cr.created_at DESC NULLS LAST
       LIMIT 80`,
      [nameKey, lastLike]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT client_name AS client_full_name, carrier, agent_name, policy_number, policy_number_production,
              mbi, carrier_member_id, raw_data, plan_name, policy_type, effective_date,
              'production' AS identifier_source
       FROM agency_production ap
       WHERE ${clientNameKeySql('ap', 'client_name')} = $1
          OR ($2 <> '' AND ap.client_name ILIKE $2)
       ORDER BY
         CASE WHEN NULLIF(TRIM(COALESCE(ap.carrier_member_id, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
         CASE WHEN NULLIF(TRIM(COALESCE(ap.mbi, '')), '') IS NOT NULL THEN 0 ELSE 1 END,
         ap.uploaded_at DESC NULLS LAST
       LIMIT 80`,
      [nameKey, lastLike]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT client_name AS client_full_name, carrier, agent_name, policy_number, raw_data, plan_name, policy_type,
              effective_date, 'medicarepro' AS identifier_source
       FROM medicarepro_sales mp
       WHERE ${clientNameKeySql('mp', 'client_name')} = $1
          OR ($2 <> '' AND mp.client_name ILIKE $2)
       ORDER BY mp.uploaded_at DESC NULLS LAST
       LIMIT 24`,
      [nameKey, lastLike]
    ).catch(() => ({ rows: [] })),
  ]);

  const sameCarrier = (row) => carriersMatch(row.carrier, carrier);
  const nameOrAgentMatch = (row) => (
    namesMatchForIdentifiers(clientName, row.client_full_name)
    || namesLooseMatch(clientName, row.client_full_name)
  );
  let production = productionByName.rows.filter((row) => sameCarrier(row) && nameOrAgentMatch(row));
  let commissionRows = commission.rows.filter((row) => sameCarrier(row) && nameOrAgentMatch(row));
  const medicareproRows = medicarepro.rows.filter((row) => sameCarrier(row) && nameOrAgentMatch(row));

  if (!commissionRows.length) {
    commissionRows = commission.rows.filter(sameCarrier);
  }
  if (!production.length) {
    production = productionByName.rows.filter(sameCarrier);
  }

  const likes = productionCarrierLikes(carrier);
  const needsLoose = !production.length;
  const needsIdLookup = Boolean(memberId || policyNumber);
  if ((needsLoose || needsIdLookup) && likes.length) {
    try {
      const extra = await pool.query(
        `SELECT client_name AS client_full_name, carrier, agent_name, policy_number, policy_number_production,
                mbi, carrier_member_id, raw_data, plan_name, policy_type, effective_date,
                'production' AS identifier_source
         FROM agency_production ap
         WHERE client_name IS NOT NULL AND TRIM(client_name) <> ''
           AND (${likes.map((_, i) => `LOWER(ap.carrier) LIKE $${i + 1}`).join(' OR ')})`,
        likes
      );
      const extraRows = extra.rows.filter(sameCarrier);
      if (needsLoose) {
        const named = extraRows.filter((row) => nameOrAgentMatch(row));
        production = named.length ? named : extraRows.filter((row) => namesLooseMatch(clientName, row.client_full_name));
      }
      const idTargets = [memberId, normSqlId(policyNumber)].filter(Boolean);
      for (const rec of commissionRows) {
        const recIds = identifiersFromRecord(rec);
        if (recIds.memberId) idTargets.push(normSqlId(recIds.memberId));
        if (rec.mbi) idTargets.push(normSqlId(rec.mbi));
        if (recIds.policyNumber) idTargets.push(normSqlId(recIds.policyNumber));
      }
      for (const target of [...new Set(idTargets)]) {
        const byId = extraRows.filter((row) => recMatchesId(row, target));
        production = [...production, ...byId.filter((row) => !production.includes(row))];
      }
    } catch (err) {
      console.error('BOB production loose match failed:', err.message);
    }
  }

  let related = [...production, ...medicareproRows, ...commissionRows];
  const idTargets = [...new Set(related.flatMap((row) => {
    const ids = identifiersFromRecord(row);
    return [ids.memberId, ids.policyNumber, row.mbi, row.carrier_member_id, row.policy_number_production]
      .map(stripPolicySuffix)
      .filter((id) => id.length >= 8);
  }))];
  if (idTargets.length) {
    try {
      const dobExtra = await pool.query(
        `SELECT client_name AS client_full_name, carrier, agent_name, policy_number, policy_number_production,
                mbi, carrier_member_id, raw_data, plan_name, policy_type, effective_date,
                'production' AS identifier_source
         FROM agency_production ap
         WHERE client_name IS NOT NULL AND TRIM(client_name) <> ''
           AND (
             UPPER(REPLACE(REPLACE(COALESCE(ap.mbi, ''), '-', ''), ' ', '')) = ANY($1)
             OR UPPER(REPLACE(REPLACE(COALESCE(ap.carrier_member_id, ''), '-', ''), ' ', '')) = ANY($1)
             OR UPPER(REPLACE(REPLACE(COALESCE(ap.policy_number, ''), '-', ''), ' ', '')) = ANY($1)
             OR UPPER(REPLACE(REPLACE(COALESCE(ap.policy_number_production, ''), '-', ''), ' ', '')) = ANY($1)
           )
         LIMIT 40`,
        [idTargets]
      );
      related = [...related, ...dobExtra.rows.filter((row) => !related.includes(row))];
    } catch (err) {
      console.error('BOB cross-carrier DOB lookup failed:', err.message);
    }
  }

  return related;
}

async function persistBobIdentifiers(pool, id, identifiers) {
  if (!id || !identifiers) return;
  try {
    await pool.query(
      `UPDATE book_of_business SET
         member_id = COALESCE(NULLIF($1, ''), member_id),
         policy_number = COALESCE(NULLIF($2, ''), policy_number),
         date_of_birth = COALESCE(NULLIF($3, ''), date_of_birth),
         plan_type = COALESCE(NULLIF($4, ''), plan_type)
       WHERE id = $5`,
      [
        identifiers.memberId || '',
        identifiers.policyNumber || '',
        identifiers.dateOfBirth || '',
        identifiers.planType || '',
        id,
      ]
    );
  } catch (err) {
    console.error('BOB identifier persist error:', err.message);
  }
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
    const { carrier, carriers, agent, agents, status, missing, lob, lobs } = req.query;
    let where = ['1=1'];
    let params = [];
    let idx = 1;
    if (req.user.role === 'agent') { where.push(`b.agent_name ILIKE $${idx++}`); params.push(`%${req.user.name}%`); }
    else {
      const af = agencyFilter(req, null);
      if (af) { where.push(af); }
    }
    // Support both single and multiple carriers
    if (carriers) { 
      const list = carriers.split(',').map(c=>c.trim()).filter(Boolean); 
      if (list.length) { where.push(`b.carrier = ANY($${idx++})`); params.push(list); } 
    } else if (carrier) { 
      where.push(`b.carrier = $${idx++}`); params.push(carrier); 
    }
    // Support both single and multiple agents
    if (agents) { 
      const list = agents.split(',').map(a=>a.trim()).filter(Boolean); 
      if (list.length) { where.push(`b.agent_name = ANY($${idx++})`); params.push(list); } 
    } else if (agent) { 
      where.push(`b.agent_name = $${idx++}`); params.push(agent); 
    }
    if (status === 'never_paid') {
      where.push(`(b.last_commission_amount = 0 OR b.last_commission_date IS NULL)`);
    } else if (status) {
      where.push(`b.status = $${idx++}`);
      params.push(status);
    }
    if (missing === 'true') { where.push(`b.months_missing > 0 AND b.status = 'active'`); }
    
    // Support both single and multiple LOBs
    const hasLobFilter = lobs || lob;
    if (lobs) {
      const list = lobs.split(',').map(l=>l.trim()).filter(Boolean);
      if (list.length) { where.push(`LOWER(cr.lob) = ANY($${idx++}::text[])`); params.push(list.map(l=>l.toLowerCase())); }
    } else if (lob) {
      where.push(`($${idx} = 'all' OR LOWER(cr.lob) = LOWER($${idx}))`); params.push(lob); idx++;
    }
    
    // If LOB filter is present, join with commission_records to get LOB
    let query;
    if (hasLobFilter) {
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
    const params = [];
    let af = '';
    if (req.user.role === 'agent') {
      params.push(`%${req.user.name}%`);
      af = `AND agent_name ILIKE $1`;
    } else if (req.user.role === 'admin' && getAgency(req)) {
      af = `AND carrier IN (SELECT DISTINCT carrier FROM commission_records WHERE ${agencyFilter(req, null)})`;
    }
    const total = await pool.query(`SELECT COUNT(*) as count FROM book_of_business WHERE status = 'active' ${af}`, params);
    const missing = await pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(last_commission_amount),0) as at_risk FROM book_of_business WHERE months_missing > 0 AND status = 'active' ${af}`, params);
    const newThis = await pool.query(`SELECT COUNT(*) as count FROM book_of_business WHERE created_at > NOW() - INTERVAL '35 days' ${af}`, params);
    const byCarrier = await pool.query(`SELECT carrier, COUNT(*) as count, MAX(updated_at) as last_updated FROM book_of_business WHERE status = 'active' ${af} GROUP BY carrier ORDER BY count DESC`, params);
    const bySource = await pool.query(`SELECT source, COUNT(*) as count FROM book_of_business WHERE status = 'active' ${af} GROUP BY source`, params);
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

// ─── POST backfill member ID / policy / DOB onto existing BOB rows ────────────
router.post('/backfill-identifiers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await backfillBobIdentifiers(getPool());
    res.json(result);
  } catch (err) {
    console.error('BOB identifier backfill error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET client details (member ID, policy #, DOB) ────────────────────────────
router.get('/:id/details', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const bobResult = await pool.query(`SELECT * FROM book_of_business WHERE id = $1`, [req.params.id]);
    if (!bobResult.rows.length) return res.status(404).json({ error: 'Client not found' });
    const bob = bobResult.rows[0];

    if (req.user.role === 'agent') {
      const agentName = String(bob.agent_name || '').toLowerCase();
      const userName = String(req.user.name || '').toLowerCase();
      if (!userName || !agentName.includes(userName)) {
        return res.status(403).json({ error: 'Not authorized' });
      }
    } else if (req.user.role === 'admin') {
      const af = agencyFilter(req, null);
      if (af) {
        const allowed = await pool.query(
          `SELECT 1 FROM book_of_business WHERE id = $1 AND ${af}`,
          [req.params.id]
        );
        if (!allowed.rows.length) return res.status(403).json({ error: 'Not authorized' });
      }
    }

    const related = await lookupRelatedIdentifiers(pool, bob);
    const [enriched] = enrichBobClientsWithIdentifiers([bob], related);
    const identifiers = {
      memberId: enriched.member_id || '',
      policyNumber: enriched.policy_number || '',
      dateOfBirth: enriched.date_of_birth || '',
      planType: enriched.plan_type || '',
    };
    await persistBobIdentifiers(pool, bob.id, identifiers);

    res.json({
      id: bob.id,
      client_full_name: bob.client_full_name,
      agent_name: bob.agent_name,
      carrier: bob.carrier,
      effective_date: bob.effective_date,
      plan_type: identifiers.planType || bob.plan_type,
      status: bob.status,
      resolution: bob.resolution,
      last_commission_date: bob.last_commission_date,
      last_commission_amount: bob.last_commission_amount,
      source: bob.source,
      notes: bob.notes,
      member_id: identifiers.memberId || '',
      policy_number: identifiers.policyNumber || '',
      date_of_birth: identifiers.dateOfBirth || '',
    });
  } catch (err) {
    console.error('BOB details error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH single client ──────────────────────────────────────────────────────
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
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
    const queryParams = [];
    if (req.user.role === 'agent') {
      queryParams.push(`%${req.user.name}%`);
      af = `AND agent_name ILIKE $1`;
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
    // Include ALL commission records (including chargebacks with negative amounts)
    // Netting logic needs complete picture: e.g., David Mosley Jr +$70 -$70 = $0 net (not owed)
    const allRecords = await pool.query(
      `SELECT LOWER(TRIM(client_full_name)) as client_key, carrier, agent_name, commission, payment_period FROM commission_records WHERE 1=1 ${af}`,
      queryParams
    );
    const matchingRecords = allRecords.rows.filter(r => {
      const norm = normalizePeriod(r.payment_period);
      return norm && targetNorm && norm === targetNorm;
    });

    function normName(name) {
      if (!name) return '';
      const s = String(name).trim();
      
      // Helper: Convert to Title Case
      function toTitleCase(str) {
        return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      }
      
      // Handle comma-separated "LAST, FIRST" format
      // Everything before the comma is the full surname (handles compound surnames)
      if (s.includes(',')) {
        let [last, first] = s.split(',').map(p => p.trim());
        
        // Strip common suffixes from surname
        last = last.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
        
        // Return "FIRST LAST" in Title Case
        const normalized = `${first} ${last}`.replace(/\s+/g, ' ').trim();
        return toTitleCase(normalized);
      }
      
      // For non-comma format, just normalize spaces and title case
      const normalized = s.replace(/\s+/g, ' ').trim();
      return toTitleCase(normalized);
    }
    function normCarrier(c) {
      const s = String(c || '').toLowerCase();
      if (s.includes('united') || s.includes('uhc')) return 'unitedhealthcare';
      if (s.includes('humana')) return 'humana';
      if (s.includes('aetna')) return 'aetna';
      if (s.includes('devoted')) return 'devoted health';
      return s;
    }
    
    // Extract surname from name (handles compound surnames)
    function extractSurname(name) {
      if (!name) return '';
      const s = String(name).trim();
      
      // If comma-separated, everything before comma is surname
      if (s.includes(',')) {
        let surname = s.split(',')[0].trim();
        // Strip suffixes
        surname = surname.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
        return surname.toLowerCase();
      }
      
      // Fallback: take last word
      return s.split(/\s+/).pop().toLowerCase();
    }

    // CRITICAL: Match on client_name|carrier ONLY - do NOT include effective_date
    // Effective dates vary across different statement sources (BSI, NHP, direct carrier)
    // and would cause false "missing" flags for the same client
    const paidSet = new Set(matchingRecords.map(r => `${normName(r.client_key)}|${normCarrier(r.carrier)}`));
    const paidLastNameSet = new Set(matchingRecords.map(r => {
      const surname = extractSurname(r.client_key);
      return `${surname}|${normCarrier(r.carrier)}`;
    }));

    const bobClients = await pool.query(`SELECT * FROM book_of_business WHERE status = 'active' ${af}`, queryParams);
    let missingCount = 0, recoveredCount = 0;

    for (const client of bobClients.rows) {
      const normN = normName(client.client_full_name);
      const normC = normCarrier(client.carrier);
      const key = `${normN}|${normC}`;
      const surname = extractSurname(client.client_full_name);
      const lastKey = `${surname}|${normC}`;
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
router.post('/upload', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const pool = getPool();
    const { carrier: rawCarrier } = req.body;
    // Normalize known casing variants — everything else passes through unchanged
    const _cs = (rawCarrier || '').toLowerCase().trim();
    const carrier = (_cs.includes('healthsun') || _cs.includes('health sun')) ? 'HealthSun'
                  : _cs.includes('devoted')                                    ? 'Devoted Health'
                  : _cs.includes('doctors')                                    ? 'Doctors Healthcare'
                  : (_cs.includes('avmed') || _cs.includes('av med'))          ? 'AvMed'
                  : rawCarrier;
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
          `UPDATE book_of_business SET
             agent_name = COALESCE(NULLIF($1,''), agent_name),
             policy_number = COALESCE(NULLIF($2,''), policy_number),
             member_id = COALESCE(NULLIF($3,''), member_id),
             date_of_birth = COALESCE(NULLIF($4,''), date_of_birth),
             effective_date = COALESCE(NULLIF($5,''), effective_date),
             plan_type = COALESCE(NULLIF($6,''), plan_type),
             source = 'bob_export', status = $7, updated_at = NOW()
           WHERE id = $8`,
          [r.agent, r.policyNumber, r.memberId, r.dateOfBirth, r.effectiveDate, r.planType, recordStatus, existing.rows[0].id]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO book_of_business (agent_name, carrier, client_full_name, policy_number, member_id, date_of_birth, effective_date, plan_type, source, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'bob_export', $9)`,
          [r.agent, carrier, r.client, r.policyNumber, r.memberId, r.dateOfBirth, r.effectiveDate, r.planType, recordStatus]
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
router.post('/build-from-statements', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const isAdmin = req.user.role === 'admin' && !getAgency(req);
    const queryParams = [];
    let af = '';
    if (req.user.role === 'agent') {
      queryParams.push(`%${req.user.name}%`);
      af = `AND agent_name ILIKE $1`;
    } else if (req.user.role === 'admin' && getAgency(req)) {
      af = `AND carrier IN (SELECT DISTINCT carrier FROM commission_records WHERE ${agencyFilter(req, null)})`;
    }

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
         client_full_name, carrier, agent_name, effective_date, commission, payment_period,
         policy_number, mbi, carrier_member_id, raw_data, plan_type
       FROM commission_records
       WHERE client_full_name != '' AND client_full_name IS NOT NULL AND commission > 0
         AND ${nhpHouseOnlyClientSql('client_full_name')} ${af}
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
         created_at DESC`,
      queryParams
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

      const ids = identifiersFromRecord(rec);

      if (existing.rows.length === 0) {
        // Insert new
        await pool.query(
          `INSERT INTO book_of_business
             (agent_name, carrier, client_full_name, effective_date, last_commission_date, last_commission_amount, source, status, resolution, policy_number, member_id, date_of_birth, plan_type)
           VALUES ($1, $2, $3, $4, $5, $6, 'statement', $7, $8, $9, $10, $11, $12)`,
          [rec.agent_name, rec.carrier, rec.client_full_name, rec.effective_date, rec.payment_period, rec.commission, bobStatus, resolution, ids.policyNumber, ids.memberId, ids.dateOfBirth, ids.planType]
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
             policy_number = COALESCE(NULLIF($7,''), policy_number),
             member_id = COALESCE(NULLIF($8,''), member_id),
             date_of_birth = COALESCE(NULLIF($9,''), date_of_birth),
             plan_type = COALESCE(NULLIF($10,''), plan_type),
             updated_at = NOW()
           WHERE id = $11`,
          [rec.agent_name, newEffDate, rec.payment_period, rec.commission, bobStatus, resolution, ids.policyNumber, ids.memberId, ids.dateOfBirth, ids.planType, existing.rows[0].id]
        );
        updated++;
      }
    }

    let identifiers = null;
    try {
      identifiers = await backfillBobIdentifiers(pool);
    } catch (err) {
      console.error('BOB identifier backfill after build failed:', err.message);
    }

    res.json({ added, updated, total: added + updated, identifiers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST reset-and-rebuild — clears ALL BOB and rebuilds fresh ───────────────
router.post('/reset-and-rebuild', requireAuth, requireAdmin, async (req, res) => {
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
         client_full_name, carrier, agent_name, effective_date, commission, payment_period,
         policy_number, mbi, carrier_member_id, raw_data, plan_type
       FROM commission_records
       WHERE client_full_name != '' AND client_full_name IS NOT NULL AND commission > 0
         AND ${nhpHouseOnlyClientSql('client_full_name')}
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

      const ids = identifiersFromRecord(rec);

      await pool.query(
        `INSERT INTO book_of_business
           (agent_name, carrier, client_full_name, effective_date, last_commission_date, last_commission_amount, source, status, resolution, policy_number, member_id, date_of_birth, plan_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'statement', $7, $8, $9, $10, $11, $12)`,
        [rec.agent_name, rec.carrier, rec.client_full_name, rec.effective_date, rec.payment_period, rec.commission, bobStatus, resolution, ids.policyNumber, ids.memberId, ids.dateOfBirth, ids.planType]
      );
      added++;
    }

    try {
      await backfillBobIdentifiers(pool);
    } catch (err) {
      console.error('BOB identifier backfill after reset failed:', err.message);
    }

    res.json({ deleted: deleted.rowCount, added, message: `Cleared ${deleted.rowCount} duplicates and rebuilt ${added} clean clients.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST bulk-delete by carrier ──────────────────────────────────────────────
router.post('/bulk-delete', requireAuth, requireAdmin, async (req, res) => {
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
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
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
router.put('/policy-status', requireAuth, requireAdmin, async (req, res) => {
  console.log('[BOB-API] PUT /policy-status called');
  console.log('[BOB-API] Request body:', req.body);
  
  const pool = getPool();
  const dbClient = await pool.connect();
  
  try {
    const { client, carrier, agent, status, notes, termedDate } = req.body;
    console.log('[BOB-API] Parsed fields:', { client, carrier, agent, status, notes, termedDate });
    
    // Validate status values
    const validStatuses = ['active', 'termed', 'chase', 'pending', 'plan_change', 'ignore'];
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
    
    // 2. Cascade BOB / commission_records for terminal workflow statuses
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
      
      console.log('[BOB-API] Flagging commission_records as termed...');
      const recordsResult = await dbClient.query(`
        UPDATE commission_records
        SET is_termed = true
        WHERE LOWER(TRIM(client_full_name)) = LOWER(TRIM($1))
          AND LOWER(TRIM(carrier)) = LOWER(TRIM($2))
          AND LOWER(TRIM(agent_name)) = LOWER(TRIM($3))
      `, [client, carrier, agent]);
      console.log('[BOB-API] Commission records updated:', recordsResult.rowCount);
    } else if (status === 'plan_change') {
      // Keep BOB roster in sync so Missing Renewals / BOB don't keep chasing
      await dbClient.query(`
        UPDATE book_of_business
        SET status = 'plan_change',
            resolution = 'plan_change',
            updated_at = NOW()
        WHERE LOWER(TRIM(client_full_name)) = LOWER(TRIM($1))
          AND LOWER(TRIM(carrier)) = LOWER(TRIM($2))
          AND LOWER(TRIM(agent_name)) = LOWER(TRIM($3))
      `, [client, carrier, agent]);
    } else if (status === 'active') {
      // Clear chase / undo — restore BOB to active if it was plan_change only
      await dbClient.query(`
        UPDATE book_of_business
        SET status = 'active',
            resolution = NULL,
            updated_at = NOW()
        WHERE LOWER(TRIM(client_full_name)) = LOWER(TRIM($1))
          AND LOWER(TRIM(carrier)) = LOWER(TRIM($2))
          AND LOWER(TRIM(agent_name)) = LOWER(TRIM($3))
          AND status = 'plan_change'
      `, [client, carrier, agent]);
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

// ─── GET /api/bob/missing-renewals-periods ─────────────────────────────────
// Statement months with commission volume. Defaults to latest viable month
// (>= MIN_STATEMENT_MONTH_RECORDS) so stub periods (Aug/Sep with 1–2 rows)
// do not make every renewal look missing.
router.get('/missing-renewals-periods', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT payment_period, COUNT(*)::int AS record_count
       FROM commission_records
       WHERE payment_period IS NOT NULL
         AND TRIM(payment_period) <> ''
         AND payment_period <> 'Unknown'
       GROUP BY payment_period`
    );
    const payload = buildMissingRenewalsPeriodOptions(result.rows);
    res.json(payload);
  } catch (err) {
    console.error('[BOB] missing-renewals-periods error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/bob/missing-renewals-check ───────────────────────────────────
// Proper Missing Renewals engine: Yahoska/Katy active BOB × period commissions.
// Replaces fragile client-side /records?limit=10000 matching.
router.get('/missing-renewals-check', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const period = normPeriod(req.query.period);
    if (!period) {
      return res.status(400).json({ error: 'period required (YYYYMM)' });
    }

    const scope = String(req.query.scope || '').toLowerCase();

    let bobResult;
    if (req.user.role === 'agent') {
      bobResult = await pool.query(
        `SELECT * FROM book_of_business
         WHERE status = 'active' AND agent_name ILIKE $1
         ORDER BY agent_name, client_full_name`,
        [`%${req.user.name}%`]
      );
    } else if (scope === 'all') {
      bobResult = await pool.query(
        `SELECT * FROM book_of_business WHERE status = 'active'
         ORDER BY agent_name, client_full_name`
      );
    } else {
      // Default: THEI principals only (Yahoska + Katy)
      bobResult = await pool.query(
        `SELECT * FROM book_of_business
         WHERE status = 'active'
           AND (
             LOWER(agent_name) LIKE '%yahoska%'
             OR LOWER(agent_name) LIKE '%katy%'
             OR LOWER(agent_name) LIKE '%perez, yahoska%'
             OR LOWER(agent_name) LIKE '%robles, katy%'
           )
         ORDER BY agent_name, client_full_name`
      );
    }

    // Period commissions — no artificial 10k cap; filter in SQL
    const recResult = await pool.query(
      `SELECT id, client_full_name, carrier, agent_name, commission, classification,
              lob, payment_period, effective_date
       FROM commission_records
       WHERE payment_period = $1
          OR payment_period = $2
          OR payment_period = $3`,
      [
        period,
        `${period.slice(4, 6)}/${period.slice(0, 4)}`, // MM/YYYY
        `${period.slice(4, 6)}/01/${period.slice(0, 4)}`, // MM/01/YYYY uncommon
      ]
    );

    // Also catch alternate period formats via JS norm (safety net)
    const periodRecords = recResult.rows.filter((r) => {
      const n = normPeriod(r.payment_period);
      return n === period;
    });

    const heldResult = await pool.query(`
      SELECT cr.client_full_name, cr.carrier
      FROM commission_records cr
      JOIN uploads u ON cr.upload_id = u.id
      WHERE u.category = 'bsi_statement'
        AND cr.classification = 'Held'
        AND (
          cr.raw_data::jsonb->>'Hold Reason' ILIKE '%not licensed%'
          OR cr.raw_data::jsonb->>'Hold Reason' ILIKE '%not appointed%'
        )
        AND cr.client_full_name IS NOT NULL
    `);
    const heldKeySet = new Set();
    for (const h of heldResult.rows) {
      heldKeySet.add(`${normName(h.client_full_name)}|${normCarrier(h.carrier)}`);
    }

    const psResult = await pool.query(
      `SELECT client_full_name, carrier, agent_name, status, termed_date, notes
       FROM policy_status`
    );
    const policyStatusMap = {};
    for (const ps of psResult.rows) {
      const key = `${normName(ps.client_full_name)}|${normCarrier(ps.carrier)}|${normName(ps.agent_name)}`;
      policyStatusMap[key] = ps;
    }

    const bobClients = bobResult.rows.filter((c) =>
      scope === 'all' || req.user.role === 'agent' ? true : isTheiPrincipalAgent(c.agent_name)
    );

    const payload = buildMissingRenewalRows({
      bobClients,
      periodRecords,
      period,
      heldKeySet,
      policyStatusMap,
    });

    payload.sparsePeriod = periodRecords.length < MIN_STATEMENT_MONTH_RECORDS;
    payload.minStatementRecords = MIN_STATEMENT_MONTH_RECORDS;

    res.json(payload);
  } catch (err) {
    console.error('[BOB] missing-renewals-check error:', err);
    res.status(500).json({ error: err.message });
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

    // Carriers that report through NHP consolidator (not separate statements)
    const NHP_CONSOLIDATED_CARRIERS = [
      'avmed',
      'cigna', // Sometimes direct, sometimes NHP - if NHP uploaded, don't warn
      'oscar',
      'oscar health',
      'molina',
      'elevance',
      'elevance medicare',
      'wellcare',
      'simply',
      'florida blue' // Sometimes consolidated through NHP
    ];
    
    // Carriers that report through BSI consolidator
    const BSI_CONSOLIDATED_CARRIERS = [
      'mutual of omaha',
      'united of omaha',
      'fidelity life',
      'fidelity & guaranty',
      'f&g',
      'american amicable',
      'transamerica',
      'ethos',
      'american home life',
      'national life group'
    ];

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

    // Check if NHP statement uploaded for this period
    const nhpUploaded = await pool.query(
      `SELECT COUNT(*) as count FROM commission_records 
       WHERE payment_period = $1 
       AND (payee = 'NHP' OR LOWER(carrier) LIKE '%nhp%')
       LIMIT 1`,
      [period]
    );
    const hasNHP = parseInt(nhpUploaded.rows[0]?.count || 0) > 0;
    
    // Check if BSI statement uploaded for this period
    const bsiUploaded = await pool.query(
      `SELECT COUNT(*) as count FROM commission_records 
       WHERE payment_period = $1 
       AND payee = 'BSI'
       LIMIT 1`,
      [period]
    );
    const hasBSI = parseInt(bsiUploaded.rows[0]?.count || 0) > 0;

    const missing = bobCarriers.rows
      .filter(r => {
        const carrierLower = r.carrier.toLowerCase().trim();
        
        // If carrier has direct statement, not missing
        if (covered.has(carrierLower)) return false;
        
        // If carrier reports through NHP and NHP uploaded, not missing
        if (hasNHP && NHP_CONSOLIDATED_CARRIERS.some(nhp => carrierLower.includes(nhp))) {
          return false;
        }
        
        // If carrier reports through BSI and BSI uploaded, not missing
        if (hasBSI && BSI_CONSOLIDATED_CARRIERS.some(bsi => carrierLower.includes(bsi))) {
          return false;
        }
        
        // Otherwise, missing
        return true;
      })
      .map(r => r.carrier);

    res.json({
      period,
      covered: coveredCarriers.rows.map(r => r.carrier),
      missingStatements: missing,
      hasNHP, // Include for debugging
      hasBSI  // Include for debugging
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

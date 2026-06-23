const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB limit
  }
});

// Phase 2: Validate MBI format (11 chars: #A[#A]#[AA][#A]##)
// Real MBI format from production data - positions 3, 6, and 9 can be digit OR letter
function validateMBI(value) {
  if (!value) return null;
  const cleaned = String(value).trim().toUpperCase();
  if (cleaned.length !== 11) return null;
  // Pattern: 1=digit, 2=letter, 3=alphanum, 4=digit, 5=letter, 6=alphanum, 7=digit, 8=letter, 9=alphanum, 10-11=digits
  // Tested against real production MBIs: 1YJ9E76GC17, 8C73N39QN86, 2D15P42UY89, etc.
  const mbiPattern = /^[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}$/;
  if (!mbiPattern.test(cleaned)) return null;
  return cleaned;
}

// Phase 2: Extract MBI and carrier_member_id per carrier schema
function extractMemberIdentifiers(row, carrier) {
  let mbi = null;
  let carrier_member_id = null;
  let policy_number_production = null;
  
  switch(carrier) {
    case 'Aetna':
      mbi = validateMBI(row.MEDICARE_NUMBER);
      carrier_member_id = row.Affinitypolicyid ? String(row.Affinitypolicyid).trim() : null;
      break;
    case 'Anthem':
      mbi = validateMBI(row.Beneficiary_Claim_Number);
      carrier_member_id = row.HCID ? String(row.HCID).trim() : null;
      break;
    case 'Humana':
      mbi = validateMBI(row.MEDICARE_IDENTIFIER);
      carrier_member_id = row.UMID ? String(row.UMID).trim() : null;
      break;
    case 'UnitedHealthcare':
      if (row['Policy Number'] && row['HICN/MBI']) {
        // UHC Med Supp - SPECIAL: Policy Number is the statement key
        mbi = validateMBI(row['HICN/MBI']);
        policy_number_production = row['Policy Number'] ? String(row['Policy Number']).trim() : null;
      } else if (row.HIC) {
        // UHC MA
        mbi = validateMBI(row.HIC);
      }
      break;
    case 'Devoted':
      mbi = validateMBI(row.MBI);
      carrier_member_id = row.MemberRecordLocator ? String(row.MemberRecordLocator).trim() : null;
      break;
    case 'HealthSpring':
      mbi = validateMBI(row.Medicare_Number);
      carrier_member_id = row.Member_ID ? String(row.Member_ID).trim() : null;
      break;
    case 'Freedom':
      mbi = validateMBI(row['HIC#'] || row.HIC);
      carrier_member_id = (row.POLICY_NUMBER || row.CONTRACT) ? String(row.POLICY_NUMBER || row.CONTRACT).trim() : null;
      break;
    default:
      // Unmapped carrier - try common column names but warn if none found
      const possibleMBI = row.MBI || row.HICN || row['HICN/MBI'] || row.HIC || row['HIC#'] || row.Medicare_Number || row.MEDICARE_IDENTIFIER || row.Beneficiary_Claim_Number;
      mbi = validateMBI(possibleMBI);
      
      // Flag for review if no MBI column found
      if (!possibleMBI && carrier) {
        console.warn(`⚠️  Unmapped carrier "${carrier}" - no MBI column found. Add explicit mapping to extractMemberIdentifiers().`);
      }
  }
  
  return { mbi, carrier_member_id, policy_number_production };
}

// Phase 2: Filter policies - KEEP only Active + Future Active (confirmed enrollments that earn overrides)
// DROP everything else: Cancelled, Inactive, Terminated, Denied, Withdrawn, In Progress, Submitted, Pending
function isActivePolicy(row, carrier) {
  let statusValue = '';
  
  switch(carrier) {
    case 'Aetna':
      // Aetna has three status columns to check
      const enrollStatus = (row.Enroll_Status || '').trim().toUpperCase();
      const exitStatus = (row.Exit_Status || '').trim().toUpperCase();
      const termStatus = (row.Term_Status || '').trim().toUpperCase();
      
      // Drop if any status contains Cancel/Voluntary
      if (enrollStatus.includes('CANCEL')) return false;
      if (exitStatus.includes('VOLUNTARY') || exitStatus.includes('CANCEL')) return false;
      if (termStatus.includes('VOLUNTARY') || termStatus.includes('CANCEL')) return false;
      
      // For Aetna, only keep if Enroll_Status is Active or Future Active
      if (enrollStatus.includes('ACTIVE') || enrollStatus.includes('FUTURE')) return true;
      
      // Otherwise drop (pending, in progress, etc.)
      return false;
      
    case 'Humana':
      statusValue = (row.Status || '').trim();
      break;
    case 'Anthem':
      statusValue = (row.App_Status || '').trim();
      break;
    case 'HealthSpring':
      statusValue = (row.POLICY_STATUS || '').trim();
      break;
    default:
      statusValue = (row.Status || row.App_Status || row.Consumer_Status || row.POLICY_STATUS || '').trim();
  }
  
  if (!statusValue) return false; // No status = drop (manual review needed)
  
  const status = statusValue.toUpperCase().trim();
  
  // WHITELIST approach - exact match on known KEEP statuses (safer than substring)
  const keepStatuses = [
    'ACTIVE',
    'ACTIVE POLICY',
    'FUTURE ACTIVE',
    'FUTURE ACTIVE POLICY',
    'ACCEPTED',  // UHC Med Supp
    'COMPLETED'  // UHC MA
  ];
  
  for (const keepStatus of keepStatuses) {
    if (status === keepStatus) return true;
  }
  
  // BLACKLIST as fallback - drop known inactive statuses
  const dropStatuses = [
    'CANCEL', 'CANCELLED', 'CANCELED', 'CANCELLED APPLICATION',
    'INACTIVE', 'INACTIVE POLICY',
    'TERMINATED', 'TERMED',
    'DENIED', 'WITHDRAWN',
    'IN PROGRESS', 'IN PROGRESS APPLICATION',
    'SUBMITTED', 'PENDING',
    'REJECTED', 'DECLINED'
  ];
  
  for (const dropStatus of dropStatuses) {
    if (status.includes(dropStatus)) return false;
  }
  
  // Unknown status - log warning and drop (conservative)
  console.warn(`⚠️  Unknown status "${statusValue}" for ${carrier} - defaulting to DROP. Add to whitelist if valid.`);
  return false;
}

// Helper: Convert Excel serial date to ISO date string
function excelDateToISO(excelDate) {
  if (!excelDate) return null;
  
  // If it's already a Date object
  if (excelDate instanceof Date) {
    return excelDate.toISOString().split('T')[0];
  }
  
  // If it's an Excel serial number (number > 1000)
  if (typeof excelDate === 'number' && excelDate > 1000) {
    // Excel epoch is Dec 30, 1899
    const excelEpoch = new Date(1899, 11, 30);
    const days = Math.floor(excelDate);
    const date = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
    return date.toISOString().split('T')[0];
  }
  
  // Try parsing as string
  try {
    const d = new Date(excelDate);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch (e) {
    // Invalid
  }
  
  return null;
}

// POST /api/agency-production/upload
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const filename = req.file.originalname.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      return res.status(400).json({ error: 'File must be Excel format (.xlsx or .xls)' });
    }

    // Parse Excel file
    let workbook, rows;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return res.status(400).json({ error: 'Excel file has no sheets' });
      }
      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(worksheet);
    } catch (parseErr) {
      console.error('Excel parse error:', parseErr);
      return res.status(400).json({ 
        error: 'Failed to parse Excel file',
        details: parseErr.message 
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty or has no data rows' });
    }
    
    // Check if we have required columns
    const firstRow = rows[0];
    const hasAgent = firstRow.AGENT || firstRow['Agent Name'] || firstRow.Agent_Name || firstRow.Agent_First_Name || firstRow.AgentName || firstRow.Current_Agent_Name || firstRow.agent || firstRow['agent name'];
    const hasMember = firstRow.MEMBER || firstRow['Member Name'] || firstRow.Member_First_Name || firstRow.Member_Last_Name || firstRow['First Name'] || firstRow['Last Name'] || firstRow.Beneficiary_First_Name || firstRow.Beneficiary_Last_Name || firstRow.FIRST || firstRow.LAST || firstRow.FullName || firstRow['Full Name'] || firstRow.Application_Application_Name || firstRow.member || firstRow['member name'];
    
    if (!hasAgent && !hasMember) {
      return res.status(400).json({ 
        error: 'Excel file is missing required columns',
        details: `Expected columns like AGENT, Agent_First_Name, MEMBER, Beneficiary_First_Name, etc. Found: ${Object.keys(firstRow).slice(0, 10).join(', ')}...`
      });
    }

    const pool = getPool();
    const uploadDate = new Date();
    const uploadMonth = `${uploadDate.getFullYear()}-${String(uploadDate.getMonth() + 1).padStart(2, '0')}`;

    // Detect carrier from filename or first row
    let carrier = 'Unknown';
    if (filename.includes('humana')) carrier = 'Humana';
    else if (filename.includes('uhc') || filename.includes('united')) carrier = 'UnitedHealthcare';
    else if (filename.includes('aetna')) carrier = 'Aetna';
    else if (filename.includes('careplus')) carrier = 'CarePlus';
    else if (filename.includes('anthem')) carrier = 'Anthem';
    else if (filename.includes('freedom')) carrier = 'Freedom';
    else if (filename.includes('devoted')) carrier = 'Devoted';
    else if (filename.includes('healthspring')) carrier = 'HealthSpring';
    else if (filename.includes('oscar')) carrier = 'Oscar';
    else if (filename.includes('wellcare')) carrier = 'WellCare';
    else if (filename.includes('cigna')) carrier = 'Cigna';

    let inserted = 0;
    let skipped = 0;

    console.log(`Processing agency production file: ${req.file.originalname}`);
    console.log(`Detected carrier: ${carrier}`);
    console.log(`Total rows: ${rows.length}`);
    
    // Debug: Show first row column names
    if (rows.length > 0) {
      console.log('=== COLUMN NAMES ===');
      console.log(Object.keys(rows[0]));
      console.log('=== FIRST ROW DATA ===');
      console.log(rows[0]);
    }

    // Process each row
    for (const row of rows) {
      // Handle different agent name formats
      let agentName = '';
      if (row.AGENT || row['Agent Name'] || row.Agent_Name || row.AgentName || row.Current_Agent_Name) {
        agentName = (row.AGENT || row['Agent Name'] || row.Agent_Name || row.AgentName || row.Current_Agent_Name || '').trim().substring(0, 255);
      } else if (row.Agent_First_Name || row.Agent_Last_Name) {
        // Anthem format: separate agent first/last names
        const firstName = (row.Agent_First_Name || '').trim();
        const lastName = (row.Agent_Last_Name || '').trim();
        agentName = `${firstName} ${lastName}`.trim().substring(0, 255);
      }
      
      // Skip if no agent name found
      if (!agentName) continue;
      
      // Handle different member name formats
      let clientName = '';
      if (row.Application_Application_Name) {
        // HealthSpring format: "LAST - FIRST - DATE" - strip the date
        const fullValue = String(row.Application_Application_Name || '').trim();
        const parts = fullValue.split(' - ');
        if (parts.length >= 2) {
          // Take first two parts (LAST - FIRST), skip the date
          clientName = `${parts[1]} ${parts[0]}`.trim().substring(0, 255);
        } else {
          clientName = fullValue.substring(0, 255);
        }
      } else if (row.FullName || row['Full Name']) {
        // Devoted format: FullName column
        clientName = (row.FullName || row['Full Name'] || '').trim().substring(0, 255);
      } else if (row.MEMBER || row['Member Name']) {
        clientName = (row.MEMBER || row['Member Name'] || '').trim().substring(0, 255);
      } else if (row.Member_First_Name || row.Member_Last_Name) {
        // UHC Medicare Advantage format: separate first/last names (underscores)
        const firstName = (row.Member_First_Name || '').trim();
        const lastName = (row.Member_Last_Name || '').trim();
        clientName = `${firstName} ${lastName}`.trim().substring(0, 255);
      } else if (row['First Name'] || row['Last Name']) {
        // UHC Med Sup format: separate first/last names (spaces)
        const firstName = (row['First Name'] || '').trim();
        const lastName = (row['Last Name'] || '').trim();
        clientName = `${firstName} ${lastName}`.trim().substring(0, 255);
      } else if (row.Beneficiary_First_Name || row.Beneficiary_Last_Name) {
        // Anthem format: beneficiary first/last names
        const firstName = (row.Beneficiary_First_Name || '').trim();
        const lastName = (row.Beneficiary_Last_Name || '').trim();
        clientName = `${firstName} ${lastName}`.trim().substring(0, 255);
      } else if (row.FIRST || row.LAST) {
        // Freedom format: FIRST + LAST columns
        const firstName = (row.FIRST || '').trim();
        const lastName = (row.LAST || '').trim();
        clientName = `${firstName} ${lastName}`.trim().substring(0, 255);
      }
      const planName = (row.PLAN_NAME || row['Plan Name'] || row.Plan_Name || row.PlanName || '').trim().substring(0, 255);
      const policyNumber = (row.DOC_ID || row['Policy Number'] || row.Application_ID || row.HIC || '').toString().substring(0, 100);
      const statusValue = (row.Status || row.App_Status || row.Consumer_Status || '').substring(0, 50);
      const policyType = (row.PRODUCT_DESCRIPTION || row['Policy Type'] || row.Product || row.SubProduct || '').substring(0, 50);
      const enrollmentType = (row.Enrollment_Type || row['Enrollment Type'] || row.Application_Type || '').substring(0, 50);
      const state = (row.STATE || row.State || '').substring(0, 2);
      const county = (row.COUNTY || row.County || row.App_County || '').substring(0, 100);

      // Parse effective date (handles Excel serial dates)
      const effectiveDateValue = row.EFF_DT || row['Effective Date'] || row.Effective_Date || row.StartDate;
      const effectiveDate = excelDateToISO(effectiveDateValue);

      // Parse transaction date (handles Excel serial dates)
      const transactionDateValue = row.TRANSACTION_DATE || row['Transaction Date'] || row.System_Received || row.Agent_Signature_Date;
      const transactionDate = excelDateToISO(transactionDateValue);

      // Skip if missing essential data
      if (!clientName || !agentName) {
        skipped++;
        continue;
      }
      
      // Phase 2: Extract MBI and carrier-specific member IDs
      const identifiers = extractMemberIdentifiers(row, carrier);
      
      // Phase 2: Filter out inactive policies (don't create false "Override Missing" rows)
      if (!isActivePolicy(row, carrier)) {
        console.log(`Skipping inactive policy: ${clientName} (${statusValue})`);
        skipped++;
        continue;
      }

      // Check for duplicate (same agent + client + effective_date in same batch)
      const existingQuery = `
        SELECT id FROM agency_production 
        WHERE upload_batch = $1 
          AND agent_name = $2
          AND client_name = $3
          AND effective_date = $4
        LIMIT 1
      `;
      
      const existingResult = await pool.query(existingQuery, [
        uploadMonth,
        agentName,
        clientName,
        effectiveDate
      ]);

      if (existingResult.rows.length > 0) {
        skipped++;
        continue;
      }

      // Insert the row
      try {
        await pool.query(
          `INSERT INTO agency_production 
           (agent_name, client_name, carrier, plan_name, policy_number, effective_date, 
            transaction_date, status, policy_type, enrollment_type, state, county, 
            upload_batch, uploaded_at, raw_data, mbi, carrier_member_id, policy_number_production)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            agentName,
            clientName,
            carrier,
            planName,
            policyNumber,
            effectiveDate,
            transactionDate,
            statusValue,
            policyType,
            enrollmentType,
            state,
            county,
            uploadMonth,
            uploadDate,
            JSON.stringify(row),
            identifiers.mbi,                      // Phase 2: Medicare Beneficiary Identifier
            identifiers.carrier_member_id,        // Phase 2: Carrier-specific member ID
            identifiers.policy_number_production  // Phase 2: Policy# (UHC Med Supp only)
          ]
        );
        inserted++;
      } catch (err) {
        console.error('Row insert error:', err.message);
        skipped++;
      }
    }

    // Log the upload to agency_production_uploads table
    const uploadedBy = req.user?.name || 'Unknown';
    await pool.query(
      `INSERT INTO agency_production_uploads (filename, carrier, upload_batch, uploaded_by, record_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.file.originalname, carrier, uploadMonth, uploadedBy, inserted]
    );

    return res.json({
      success: true,
      inserted: inserted,
      skipped: skipped,
      carrier: carrier,
      upload_batch: uploadMonth,
      total_processed: rows.length,
      message: `Uploaded ${inserted} ${carrier} production records, skipped ${skipped} duplicates for batch ${uploadMonth}`
    });

  } catch (err) {
    console.error('Upload error:', err);
    console.error('Stack trace:', err.stack);
    return res.status(500).json({ 
      error: err.message || 'Upload failed',
      details: err.stack || 'No stack trace available'
    });
  }
});

// GET /api/agency-production
router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { batch, carrier, agent, limit = 100, offset = 0 } = req.query;

    let query = `SELECT 
      ap.*, 
      apu.filename as upload_filename,
      apu.uploaded_at as upload_date,
      apu.uploaded_by as uploaded_by_user
    FROM agency_production ap
    LEFT JOIN LATERAL (
      SELECT filename, uploaded_at, uploaded_by
      FROM agency_production_uploads
      WHERE upload_batch = ap.upload_batch
      ORDER BY uploaded_at DESC
      LIMIT 1
    ) apu ON true
    WHERE 1=1`;
    const params = [];

    if (batch) {
      query += ` AND upload_batch = $${params.length + 1}`;
      params.push(batch);
    }

    if (carrier) {
      query += ` AND carrier = $${params.length + 1}`;
      params.push(carrier);
    }

    if (agent) {
      query += ` AND agent_name ILIKE $${params.length + 1}`;
      params.push(`%${agent}%`);
    }

    query += ` ORDER BY effective_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM agency_production ap WHERE 1=1';
    const countParams = [];
    if (batch) {
      countQuery += ` AND upload_batch = $${countParams.length + 1}`;
      countParams.push(batch);
    }
    if (carrier) {
      countQuery += ` AND carrier = $${countParams.length + 1}`;
      countParams.push(carrier);
    }
    if (agent) {
      countQuery += ` AND agent_name ILIKE $${countParams.length + 1}`;
      countParams.push(`%${agent}%`);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    return res.json({
      production: result.rows,
      total: total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/agency-production/uploads - Fetch upload history
router.get('/uploads', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM agency_production_uploads ORDER BY uploaded_at DESC`
    );

    return res.json({ uploads: result.rows });

  } catch (err) {
    console.error('Upload history error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/agency-production/upload/:id - Delete a single upload
router.delete('/upload/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    // Get upload details first
    const uploadResult = await pool.query(
      'SELECT * FROM agency_production_uploads WHERE id = $1',
      [id]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const upload = uploadResult.rows[0];
    const { carrier, upload_batch, uploaded_at } = upload;

    // Delete production records for this specific upload
    // Match by carrier + batch + uploaded within 5 minutes of upload time
    const uploadTime = new Date(uploaded_at);
    const beforeTime = new Date(uploadTime.getTime() - 5 * 60 * 1000);
    const afterTime = new Date(uploadTime.getTime() + 5 * 60 * 1000);

    const productionResult = await pool.query(
      `DELETE FROM agency_production 
       WHERE carrier = $1 
         AND upload_batch = $2 
         AND uploaded_at >= $3 
         AND uploaded_at <= $4`,
      [carrier, upload_batch, beforeTime, afterTime]
    );

    // Delete the upload log entry
    await pool.query(
      'DELETE FROM agency_production_uploads WHERE id = $1',
      [id]
    );

    return res.json({
      success: true,
      deleted_production: productionResult.rowCount,
      carrier: carrier,
      filename: upload.filename,
      message: `Deleted ${carrier} upload (${productionResult.rowCount} production records)`
    });

  } catch (err) {
    console.error('Delete upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/agency-production/batch/:batch - Delete a batch
router.delete('/batch/:batch', requireAuth, async (req, res) => {
  try {
    const { batch } = req.params;
    const pool = getPool();

    // Delete all production records for this batch
    const productionResult = await pool.query(
      'DELETE FROM agency_production WHERE upload_batch = $1',
      [batch]
    );

    // Delete upload log entries for this batch
    const uploadsResult = await pool.query(
      'DELETE FROM agency_production_uploads WHERE upload_batch = $1',
      [batch]
    );

    return res.json({
      success: true,
      deleted_production: productionResult.rowCount,
      deleted_uploads: uploadsResult.rowCount,
      message: `Deleted batch ${batch} (${productionResult.rowCount} production records, ${uploadsResult.rowCount} upload logs)`
    });

  } catch (err) {
    console.error('Delete batch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/agency-production/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_production,
        COUNT(DISTINCT agent_name) as unique_agents,
        COUNT(DISTINCT carrier) as carriers,
        COUNT(DISTINCT upload_batch) as batches,
        COUNT(CASE WHEN status ILIKE '%active%' THEN 1 END) as active_policies
       FROM agency_production`
    );

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

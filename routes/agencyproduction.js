const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');

// str() — safe Excel cell coercion: null/undefined → '', numbers/booleans → String, Dates → ISO date
// Prevents TypeError when a numeric or null Excel cell value hits .trim() or .substring()
function str(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return String(val);
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB limit (handles large production files like Aetna 2.8MB)
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
//
// CRITICAL PRINCIPLE: "Application completed" ≠ "policy active"
// When a carrier has BOTH application-status AND enrollment/consumer-status columns:
//   - Application status = paperwork processing (Completed, Submitted, Issued)
//   - Enrollment status = actual member on the books (Active, Enrolled, Effective)
//   - ALWAYS use enrollment status for override filtering
//   - Example: UHC MA has 382 App_Status=COMPLETED but only 287 Consumer_Status=ACTIVE
//     The 95 difference = completed apps that never activated (no override earned)
//
// Check Aetna, Humana, all carriers for similar splits (Issued_Status vs Enroll_Status, etc.)
function isActivePolicy(row, carrier) {
  let statusValue = '';
  
  switch(carrier) {
    case 'UnitedHealthcare':
      // CRITICAL: Use Consumer_Status (true enrollment), NOT App_Status (application processing)
      // App_Status=COMPLETED includes 95 policies that never became active:
      //   - 33 NEVER ACTIVE (app finished, never enrolled)
      //   - 18 DER - VOLUNTARY (disenrolled)
      //   - ~44 NA/blank (not active)
      // Consumer_Status=ACTIVE (287) reflects actual enrollment = actual override payment
      // Med Supp uses POLICY_STATUS instead
      statusValue = str(row.Consumer_Status || row.POLICY_STATUS).trim();
      break;
    case 'HealthSpring':
      // HealthSpring uses Status (not POLICY_STATUS)
      statusValue = str(row.Status).trim();
      break;
    case 'Freedom':
      // FINAL_STATUS is authoritative for Freedom:
      //   NEW_EFFECTIVE = active, PLAN TRANSFER = active (our agent wrote the transfer, client retained)
      //   CANCEL, Plan Denied = drop even if POLICY_STATUS = CMS Accepted
      // Precedence: FINAL_STATUS → POLICY_STATUS → APP_STATUS
      statusValue = str(row.FINAL_STATUS).trim() || str(row.POLICY_STATUS || row.APP_STATUS).trim();
      break;
    case 'Aetna':
      // Aetna has three status columns to check
      const enrollStatus = str(row.Enroll_Status).trim().toUpperCase();
      const exitStatus = str(row.Exit_Status).trim().toUpperCase();
      const termStatus = str(row.Term_Status).trim().toUpperCase();
      
      // Drop if any status contains Cancel/Voluntary
      if (enrollStatus.includes('CANCEL')) return false;
      if (exitStatus.includes('VOLUNTARY') || exitStatus.includes('CANCEL')) return false;
      if (termStatus.includes('VOLUNTARY') || termStatus.includes('CANCEL')) return false;
      
      // For Aetna, only keep if Enroll_Status is Active or Future Active
      if (enrollStatus.includes('ACTIVE') || enrollStatus.includes('FUTURE')) return true;
      
      // Otherwise drop (pending, in progress, etc.)
      return false;
      
    case 'Humana':
      statusValue = str(row.Status).trim();
      break;
    case 'Anthem':
      // Anthem files use Enrollment_Status (not Consumer_Status or App_Status)
      statusValue = str(row.Enrollment_Status || row.Consumer_Status || row.App_Status).trim();
      break;
    case 'Devoted':
      statusValue = str(row.Status).trim();
      break;
    default:
      statusValue = str(row.Status || row.App_Status || row.Consumer_Status || row.POLICY_STATUS).trim();
  }
  
  if (!statusValue) return false; // No status = drop (manual review needed)
  
  const status = statusValue.toUpperCase().trim();
  
  // WHITELIST approach - exact match on known KEEP statuses (safer than substring)
  // CRITICAL PRINCIPLE: Prefer enrollment/consumer status over application status
  // "Application completed" ≠ "policy active" - only active members earn overrides
  const keepStatuses = [
    'ACTIVE',         // UHC Consumer_Status, Humana, most carriers (actual active member)
    'ACTIVE POLICY',  // Humana
    'FUTURE ACTIVE',  // Aetna, Humana (confirmed enrollment, future start date - earns override)
    'FUTURE ACTIVE POLICY', // Humana
    'ACCEPTED',       // UHC Med Supp (policy accepted and active)
    'ENROLLED',       // HealthSpring, Devoted (actual enrollment, not just app submitted)
    'APPROVED',       // Devoted (approved for enrollment)
    'CMS ACCEPTED',   // Freedom POLICY_STATUS fallback (CMS accepted the enrollment)
    'NEW_EFFECTIVE',  // Freedom FINAL_STATUS — fresh active policy
    'PLAN TRANSFER'   // Freedom FINAL_STATUS — our agent wrote the transfer, client retained
  ];
  
  for (const keepStatus of keepStatuses) {
    if (status === keepStatus) return true;
  }
  
  // BLACKLIST as fallback - drop known inactive statuses
  const dropStatuses = [
    'CANCEL', 'CANCELLED', 'CANCELED', 'CANCELLED APPLICATION',
    'INACTIVE', 'INACTIVE POLICY',
    'NEVER ACTIVE',  // UHC Consumer_Status - completed app but never activated
    'DER',           // UHC Consumer_Status - disenrolled (DER - VOLUNTARY, etc.)
    'NA',            // UHC Consumer_Status - Not Active
    'TERMINATED', 'TERMED',
    'DENIED', 'WITHDRAWN',
    'IN PROGRESS', 'IN PROGRESS APPLICATION',
    'SUBMITTED', 'PENDING',
    'REJECTED', 'DECLINED',
    'DISENROLL', 'DISENROLLED',  // Devoted
    'COMPLETED'      // APPLICATION status (not enrollment) - app finished ≠ member active
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
    const client = await pool.connect(); // 3b: transaction client
    const uploadDate = new Date();
    const uploadMonth = `${uploadDate.getFullYear()}-${String(uploadDate.getMonth() + 1).padStart(2, '0')}`;
    const uploadedBy = req.user?.name || 'Unknown'; // 3b: moved up from bottom
    let uploadId; // 3b: set after log row INSERT

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
    let skippedMissingData = 0;
    let skippedInactive = 0;
    let skippedDuplicate = 0;

    console.log(`Processing agency production file: ${req.file.originalname}`);
    console.log(`Detected carrier: ${carrier}`);
    console.log(`Total rows (raw): ${rows.length}`);

    // Pre-dedup rows within this file: some carrier reports (e.g. Freedom)
    // list the same client 2-3x across sections — once with no effective date,
    // once with one. Score each row and keep the best one per agent+client.
    // Score: +2 for a real effective date, +1 for a non-blank status.
    const scoreRow = (r) => {
      const eff = r.EFF_DTE || r.EFF_DT || r['Effective Date'] || r.Effective_Date ||
                  r.StartDate || r.EffectiveDate || r.Application_Effective_Date;
      const st  = r.Status || r.App_Status || r.Consumer_Status || r.POLICY_STATUS || '';
      return (eff ? 2 : 0) + (st ? 1 : 0);
    };
    {
      const best = new Map();
      for (const r of rows) {
        const ag = (r.AGENT || r['Agent Name'] || r.Agent_Name || r.AgentName ||
          r.Current_Agent_Name ||
          (r.Agent_First_Name ? `${r.Agent_First_Name} ${r.Agent_Last_Name}` : '') ||
          (r.FIRST !== undefined ? '' : '') || '').trim().toLowerCase();
        const cl = (r.Application_Application_Name || r.FullName || r['Full Name'] ||
          r.MEMBER || r['Member Name'] ||
          (r.Member_First_Name ? `${r.Member_First_Name} ${r.Member_Last_Name}` : '') ||
          (r['First Name'] !== undefined ? `${(r['First Name']||'')} ${(r['Last Name']||'')}` : '') ||
          (r.Beneficiary_First_Name ? `${r.Beneficiary_First_Name} ${r.Beneficiary_Last_Name}` : '') ||
          (r.FIRST !== undefined ? `${(r.FIRST||'')} ${(r.LAST||'')}` : '') || '').trim().toLowerCase();
        const key = `${ag}|${cl}`;
        if (!best.has(key) || scoreRow(r) > scoreRow(best.get(key))) best.set(key, r);
      }
      const deduped = [...best.values()];
      console.log(`In-file dedup: ${rows.length} → ${deduped.length} rows (removed ${rows.length - deduped.length})`);
      rows = deduped;
    }

    // 3b: wrap entire insert loop in a transaction
    try {
      await client.query('BEGIN');

      const logResult = await client.query(
        `INSERT INTO agency_production_uploads (filename, carrier, upload_batch, uploaded_by, record_count)
         VALUES ($1, $2, $3, $4, 0) RETURNING id`,
        [req.file.originalname, carrier, uploadMonth, uploadedBy]
      );
      uploadId = logResult.rows[0].id;

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
      // Carrier-specific plan name column fallbacks
      let planName = '';
      if (carrier === 'Freedom') {
        // Freedom Health report: PLAN_DESC, CONTRACT_DESC, PRODUCT_DESCRIPTION, then generic fallbacks
        planName = (row.PLAN_DESC || row.CONTRACT_DESC || row.PLAN_DESCRIPTION || row.PRODUCT_DESCRIPTION ||
                    row.PLAN_NAME || row['Plan Name'] || row.Plan_Name || row.PlanName || '').trim().substring(0, 255);
      } else if (carrier === 'HealthSpring') {
        // HealthSpring uses Application_ prefix: Application_Plan_Name, Application_Plan
        planName = (row.Application_Plan_Name || row.Application_Plan || row.Plan_Name ||
                    row.PLAN_NAME || row['Plan Name'] || row.PlanName || '').trim().substring(0, 255);
      } else {
        planName = (row.PLAN_NAME || row['Plan Name'] || row.Plan_Name || row.PlanName || '').trim().substring(0, 255);
      }
      const policyNumber = (row.DOC_ID || row['Policy Number'] || row.Application_ID || row.HIC || '').toString().substring(0, 100);
      const statusValue = (row.Status || row.App_Status || row.Consumer_Status || '').substring(0, 50);
      const policyType = (row.PRODUCT_DESCRIPTION || row['Policy Type'] || row.Product || row.SubProduct || '').substring(0, 50);
      const enrollmentType = (row.Enrollment_Type || row['Enrollment Type'] || row.Application_Type || '').substring(0, 50);
      const state = (row.STATE || row.State || '').substring(0, 2);
      const county = (row.COUNTY || row.County || row.App_County || '').substring(0, 100);

      // Parse effective date (handles Excel serial dates)
      const effectiveDateValue = row.EFF_DTE || row.EFF_DT || row['Effective Date'] || row.Effective_Date || row.StartDate || row.EffectiveDate;
      const effectiveDate = excelDateToISO(effectiveDateValue);

      // Parse transaction date (handles Excel serial dates)
      const transactionDateValue = row.TRANSACTION_DATE || row['Transaction Date'] || row.System_Received || row.Agent_Signature_Date;
      const transactionDate = excelDateToISO(transactionDateValue);

      // Skip if missing essential data
      if (!clientName || !agentName) {
        skippedMissingData++;
        continue;
      }
      
      // Phase 2: Extract MBI and carrier-specific member IDs
      const identifiers = extractMemberIdentifiers(row, carrier);
      
      // Phase 2: Filter out inactive policies (don't create false "Override Missing" rows)
      if (!isActivePolicy(row, carrier)) {
        console.log(`Skipping inactive policy: ${clientName} (${statusValue})`);
        skippedInactive++;
        continue;
      }

      // Check for duplicate (same agent + client + carrier + effective_date in same batch)
      // carrier is required: same client enrolled in two carriers same month is NOT a duplicate
      const existingQuery = `
        SELECT id FROM agency_production 
        WHERE upload_batch = $1 
          AND agent_name = $2
          AND client_name = $3
          AND effective_date IS NOT DISTINCT FROM $4
          AND carrier = $5
        LIMIT 1
      `;
      
      const existingResult = await client.query(existingQuery, [ // 3b: use transaction client
        uploadMonth,
        agentName,
        clientName,
        effectiveDate,
        carrier
      ]);

      if (existingResult.rows.length > 0) {
        skippedDuplicate++;
        continue;
      }

      // Insert the row
      try {
        await client.query( // 3b: use transaction client
          `INSERT INTO agency_production 
           (agent_name, client_name, carrier, plan_name, policy_number, effective_date, 
            transaction_date, status, policy_type, enrollment_type, state, county, 
            upload_batch, uploaded_at, raw_data, mbi, carrier_member_id, policy_number_production,
            upload_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
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
            identifiers.policy_number_production, // Phase 2: Policy# (UHC Med Supp only)
            uploadId                               // 3c: batch identity
          ]
        );
        inserted++;
      } catch (err) {
        console.error('Row insert error, aborting batch:', err.message);
        throw err; // 3d: inside transaction — fail whole upload, never leave partial batches
      }
    } // end for loop

      // 3b: update final record count, then commit
      await client.query(
        `UPDATE agency_production_uploads SET record_count = $1 WHERE id = $2`,
        [inserted, uploadId]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    // 3b: old uploadedBy + uploads-log INSERT removed (moved to top of transaction)

    const totalSkipped = skippedMissingData + skippedInactive + skippedDuplicate;
    const skipDetails = [];
    if (skippedInactive > 0)     skipDetails.push(`${skippedInactive} inactive/filtered`);
    if (skippedDuplicate > 0)    skipDetails.push(`${skippedDuplicate} duplicate`);
    if (skippedMissingData > 0)  skipDetails.push(`${skippedMissingData} missing-data`);

    return res.json({
      success: true,
      inserted: inserted,
      skipped: totalSkipped,
      skipped_inactive: skippedInactive,
      skipped_duplicate: skippedDuplicate,
      skipped_missing_data: skippedMissingData,
      carrier: carrier,
      upload_batch: uploadMonth,
      total_processed: rows.length,
      message: `Uploaded ${inserted} ${carrier} production records${
        totalSkipped > 0 ? `, skipped ${totalSkipped} (${skipDetails.join(', ')})` : ''
      } for batch ${uploadMonth}`
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
    const { batch, carrier, agent, upload_id, limit = 100, offset = 0 } = req.query;

    let query = `SELECT 
      ap.*, 
      apu.filename as upload_filename,
      apu.uploaded_at as upload_date,
      apu.uploaded_by as uploaded_by_user
    FROM agency_production ap
    LEFT JOIN LATERAL (
      SELECT u.filename, u.uploaded_at, u.uploaded_by
      FROM agency_production_uploads u
      WHERE u.id = ap.upload_id
         OR (ap.upload_id IS NULL
             AND u.upload_batch = ap.upload_batch
             AND u.carrier = ap.carrier)
      ORDER BY u.uploaded_at DESC
      LIMIT 1
    ) apu ON true -- 3e: join by upload_id; fallback for legacy rows
    WHERE 1=1`;
    const params = [];

    if (upload_id) {
      query += ` AND ap.upload_id = $${params.length + 1}`;
      params.push(parseInt(upload_id));
    }

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
    if (upload_id) {
      countQuery += ` AND upload_id = $${countParams.length + 1}`;
      countParams.push(parseInt(upload_id));
    }
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

    // 3f: delete by upload_id (exact identity); legacy ±5min fallback for pre-migration rows
    let productionResult = await pool.query(
      `DELETE FROM agency_production WHERE upload_id = $1`,
      [id]
    );

    if (productionResult.rowCount === 0) {
      // Legacy fallback: rows created before the upload_id migration
      const uploadTime = new Date(uploaded_at);
      const beforeTime = new Date(uploadTime.getTime() - 5 * 60 * 1000);
      const afterTime = new Date(uploadTime.getTime() + 5 * 60 * 1000);
      productionResult = await pool.query(
        `DELETE FROM agency_production
         WHERE upload_id IS NULL
           AND carrier = $1
           AND upload_batch = $2
           AND uploaded_at >= $3
           AND uploaded_at <= $4`,
        [carrier, upload_batch, beforeTime, afterTime]
      );
    }

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

// PATCH /api/agency-production/:id/override - Set or clear manual override status
// Body: { status: 'paid' | 'chase_bsi' | 'request_audit' | 'pending' | null }
// null clears the override and restores system-matched status
router.patch('/:id/override', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const pool = getPool();

    const VALID_STATUSES = ['paid', 'chase_bsi', 'request_audit', 'held_licensing', 'no_pay_expected', 'pending', null];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.filter(s => s !== null).join(', ')}, or null to clear.` });
    }

    // Verify row exists
    const existing = await pool.query('SELECT id FROM agency_production WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Production record not found' });
    }

    if (status === null) {
      // Clear override — restore system-matched status
      await pool.query(
        `UPDATE agency_production
         SET manual_override_status = NULL,
             manual_override_by     = NULL,
             manual_override_at     = NULL
         WHERE id = $1`,
        [id]
      );
      return res.json({ success: true, id, manual_override_status: null, cleared: true });
    } else {
      // Set override
      const by = req.user?.name || req.user?.email || 'Unknown';
      await pool.query(
        `UPDATE agency_production
         SET manual_override_status = $1,
             manual_override_by     = $2,
             manual_override_at     = NOW()
         WHERE id = $3`,
        [status, by, id]
      );
      return res.json({ success: true, id, manual_override_status: status, set_by: by });
    }
  } catch (err) {
    console.error('Override error:', err);
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

// ─── THREE-WAY RECONCILIATION ────────────────────────────────────────────────
// GET /api/agency-production/reconcile
//
// Leg 1 (source of truth): agency_production (Hector's reports)
// Leg 2 (BSI→THEI):        commission_records from NHP/BSI/THE statement uploads
// Leg 3 (Carrier→BSI):     commission_records from bsi_statement uploads
//
// ─────────────────────────────────────────────────────────────────────────────
// Shared reconciliation helpers — used by /reconcile AND /export-bsi-recon
// Extract once here so both routes stay in sync automatically.
//
// Match key: normReconClient(col) + normReconCarrier(col) — period-agnostic (v1 limitation)
// Status (manual_override_status wins when set):
//   paid          — Leg 2 match found (BSI paid THEI)
//   chase_bsi     — Leg 3 match with commission > 0, no Leg 2 (carrier paid BSI, BSI hasn’t paid THEI)
//   request_audit — Leg 3 $0 record OR carrier month uploaded but client absent
//   pending       — no carrier statement uploaded for this carrier yet
//
// v1 limitations: period-agnostic; single best match per client+carrier; chargebacks not de-duped;
//   pagination accuracy not guaranteed when status filter is applied
// ─────────────────────────────────────────────────────────────────────────────
function normReconCarrier(col) {
  return `CASE
    WHEN LOWER(${col}) LIKE '%humana%'                                           THEN 'humana'
    WHEN LOWER(${col}) LIKE '%aetna%'                                            THEN 'aetna'
    WHEN LOWER(${col}) LIKE '%uhc%' OR LOWER(${col}) LIKE '%united%'             THEN 'unitedhealthcare'
    WHEN LOWER(${col}) LIKE '%doctors%'                                          THEN 'doctors'
    WHEN LOWER(${col}) LIKE '%careplus%' OR LOWER(${col}) LIKE '%care plus%'     THEN 'careplus'
    WHEN LOWER(${col}) LIKE '%devoted%'                                          THEN 'devoted'
    WHEN LOWER(${col}) LIKE '%solis%'                                            THEN 'solis'
    WHEN LOWER(${col}) LIKE '%healthsun%' OR LOWER(${col}) LIKE '%health sun%'   THEN 'healthsun'
    WHEN LOWER(${col}) LIKE '%oscar%'                                            THEN 'oscar health'
    WHEN LOWER(${col}) LIKE '%molina%'                                           THEN 'molina'
    WHEN LOWER(${col}) LIKE '%wellcare%'                                         THEN 'wellcare'
    WHEN LOWER(${col}) LIKE '%freedom%'                                          THEN 'freedom'
    ELSE LOWER(TRIM(${col}))
  END`;
}

// Normalize client name for recon matching:
//   “LAST, FIRST MI” → “first last”  (strips trailing middle initials from first-name part)
//   “LAST, FIRST”   → “first last”
//   non-comma → lowercase + strip trailing single-letter initial (e.g. Humana BSI: “ALAN KITCHMAN L” → “alan kitchman”)
// Both paths mirror AgencyProductionRecon.js normName() comma branch (first.replace(/(\s+[A-Z]\.?)+$/i, ''))
function normReconClient(col) {
  return `CASE
    WHEN ${col} LIKE '%,%'
    THEN TRIM(REGEXP_REPLACE(LOWER(TRIM(SPLIT_PART(${col}, ',', 2))), '(\\s+[a-z]\\.?)+$', '')) || ' ' || LOWER(TRIM(SPLIT_PART(${col}, ',', 1)))
    ELSE TRIM(REGEXP_REPLACE(LOWER(TRIM(REGEXP_REPLACE(COALESCE(${col}, ''), '\\s+', ' ', 'g'))), '\\s+[a-z]\\.?$', ''))
  END`;
}

// Shared CTE query builder — returns the WITH...SELECT string for both /reconcile and /export-bsi-recon.
// apWhere: extra AND conditions on ap rows (caller-supplied, already parameterized).
function buildReconCTE(apWhere) {
  return `
    WITH
    leg2 AS (
      SELECT id, client_full_name, carrier, policy_number, commission,
             payment_period, classification, agent_name, nc, ncarr
      FROM (
        SELECT cr.id, cr.client_full_name, cr.carrier, cr.policy_number,
               cr.commission, cr.payment_period, cr.classification, cr.agent_name,
               ${normReconClient('cr.client_full_name')} AS nc,
               ${normReconCarrier('cr.carrier')}         AS ncarr,
               ROW_NUMBER() OVER (
                 PARTITION BY ${normReconClient('cr.client_full_name')}, ${normReconCarrier('cr.carrier')}
                 ORDER BY cr.id DESC
               ) AS rn
        FROM commission_records cr
        JOIN uploads u ON cr.upload_id = u.id
        WHERE (u.category IS NULL OR u.category = 'commission_statement')
          AND cr.payee IN ('BSI','NHP','THE')
          AND cr.client_full_name IS NOT NULL
          AND TRIM(cr.client_full_name) <> ''
      ) sub WHERE rn = 1
    ),
    leg3 AS (
      SELECT id, client_full_name, carrier, policy_number, commission,
             payment_period, classification, hold_reason, member_state, nc, ncarr
      FROM (
        SELECT cr.id, cr.client_full_name, cr.carrier, cr.policy_number,
               cr.commission, cr.payment_period, cr.classification,
               cr.raw_data::jsonb->>'Hold Reason'    AS hold_reason,
               cr.raw_data::jsonb->>'Member State'   AS member_state,
               ${normReconClient('cr.client_full_name')} AS nc,
               ${normReconCarrier('cr.carrier')}         AS ncarr,
               ROW_NUMBER() OVER (
                 PARTITION BY ${normReconClient('cr.client_full_name')}, ${normReconCarrier('cr.carrier')}
                 ORDER BY cr.id DESC
               ) AS rn
        FROM commission_records cr
        JOIN uploads u ON cr.upload_id = u.id
        WHERE u.category = 'bsi_statement'
          AND cr.client_full_name IS NOT NULL
          AND TRIM(cr.client_full_name) <> ''
      ) sub WHERE rn = 1
    ),
    carrier_has_uploads AS (
      SELECT DISTINCT ${normReconCarrier('TRIM(cv.c)')} AS ncarr
      FROM (
        SELECT TRIM(unnest(STRING_TO_ARRAY(u.carrier, ','))) AS c
        FROM uploads u
        WHERE u.category = 'bsi_statement'
          AND u.carrier IS NOT NULL AND TRIM(u.carrier) <> ''
      ) cv
      WHERE TRIM(cv.c) <> ''
    )
    SELECT
      ap.id, ap.agent_name, ap.client_name, ap.carrier, ap.policy_number,
      ap.effective_date, ap.upload_batch, ap.status AS production_status,
      ap.enrollment_type, ap.plan_name, ap.manual_override_status,
      l2.id              AS l2_id,
      l2.commission      AS l2_commission,
      l2.payment_period  AS l2_period,
      l2.classification  AS l2_classification,
      l2.policy_number   AS l2_policy,
      l2.client_full_name AS l2_client,
      l2.agent_name      AS l2_agent,
      l3.id              AS l3_id,
      l3.commission      AS l3_commission,
      l3.payment_period  AS l3_period,
      l3.classification  AS l3_classification,
      l3.policy_number   AS l3_policy,
      l3.client_full_name AS l3_client,
      l3.hold_reason     AS l3_hold_reason,
      l3.member_state    AS l3_member_state,
      (chu.ncarr IS NOT NULL) AS carrier_has_uploads,
      COALESCE(
        NULLIF(TRIM(COALESCE(ap.manual_override_status, '')), ''),
        CASE
          WHEN l2.id IS NOT NULL                                   THEN 'paid'
          WHEN UPPER(TRIM(ap.status)) IN ('WITHDRAWN','IN PROGRESS','CANCELLED','DENIED') THEN 'no_pay_expected'
          WHEN l3.id IS NOT NULL AND COALESCE(l3.commission,0) > 0 THEN 'chase_bsi'
          WHEN l3.id IS NOT NULL
           AND l3.classification = 'Held'
           AND (l3.hold_reason ILIKE '%not licensed%' OR l3.hold_reason ILIKE '%not appointed%')
                                                                   THEN 'held_licensing'
          WHEN l3.id IS NOT NULL                                   THEN 'request_audit'
          WHEN chu.ncarr IS NOT NULL                               THEN 'request_audit'
          ELSE 'pending'
        END
      ) AS recon_status
    FROM agency_production ap
    LEFT JOIN leg2 l2  ON ${normReconClient('ap.client_name')} = l2.nc
                      AND ${normReconCarrier('ap.carrier')}    = l2.ncarr
    LEFT JOIN leg3 l3  ON ${normReconClient('ap.client_name')} = l3.nc
                      AND ${normReconCarrier('ap.carrier')}    = l3.ncarr
    LEFT JOIN carrier_has_uploads chu ON ${normReconCarrier('ap.carrier')} = chu.ncarr
    WHERE 1=1 ${apWhere}
  `;
}

// Alba Hernandez exclusion — BSI principal (agency-level production, not individual override validation)
// Matches the single known variant in agency_production: 'HERNANDEZ, ALBA R'
// If new variants are added to the table, extend this list.
const ALBA_EXCLUSION_NAMES = ['hernandez, alba r', 'hernandez, alba', 'alba hernandez', 'alba ritela hernandez', 'broker society insurance'];
const ALBA_EXCLUSION_REASON = 'BSI principal — agency-level production; not subject to individual override validation';

router.get('/reconcile', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { batch, carrier, agent, status: statusFilter, limit = 500, offset = 0 } = req.query;

    const params = [];
    const apConds = [];
    if (batch)   { apConds.push(`ap.upload_batch = $${params.length + 1}`);          params.push(batch); }
    if (carrier) { apConds.push(`ap.carrier ILIKE $${params.length + 1}`);            params.push(`%${carrier}%`); }
    if (agent)   { apConds.push(`ap.agent_name ILIKE $${params.length + 1}`);         params.push(`%${agent}%`); }

    // Exclude Alba rows from main reconciliation — pulled into excluded[] separately
    apConds.push(`LOWER(TRIM(ap.agent_name)) != ALL($${params.length + 1})`);
    params.push(ALBA_EXCLUSION_NAMES);

    const apWhere = apConds.length ? `AND ${apConds.join(' AND ')}` : '';

    // Use shared module-level CTE builder — normReconClient/normReconCarrier/CASE are defined once above
    const q = buildReconCTE(apWhere) + `
      ORDER BY ap.carrier, ap.agent_name, ap.effective_date DESC NULLS LAST
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(parseInt(limit), parseInt(offset));
    const result = await pool.query(q, params);

    // Real db_total: COUNT of non-excluded rows matching filters (independent of LIMIT/OFFSET)
    const countParams = params.slice(0, -2); // strip LIMIT and OFFSET
    const countConditions = `WHERE ${apConds.join(' AND ')}`;
    const countResult = await pool.query(
      `SELECT COUNT(*) AS db_total FROM agency_production ap ${countConditions}`,
      countParams
    );
    const db_total = parseInt(countResult.rows[0].db_total);

    // Fetch excluded rows (Alba) separately — NOT included in main counts
    const albaParams = params.slice(0, params.length - 2 - 1); // strip limit, offset, and the alba exclusion param
    const albaUserConds = apConds.slice(0, -1); // remove the alba exclusion condition
    const albaWhere = albaUserConds.length
      ? `WHERE ${albaUserConds.join(' AND ')} AND LOWER(TRIM(ap.agent_name)) = ANY($${albaParams.length + 1})`
      : `WHERE LOWER(TRIM(ap.agent_name)) = ANY($${albaParams.length + 1})`;
    albaParams.push(ALBA_EXCLUSION_NAMES);
    const albaResult = await pool.query(
      `SELECT ap.id, ap.agent_name, ap.client_name, ap.carrier, ap.effective_date, ap.upload_batch
       FROM agency_production ap ${albaWhere}
       ORDER BY ap.carrier, ap.effective_date DESC NULLS LAST`,
      albaParams
    );
    const excluded = albaResult.rows.map(r => ({ ...r, exclusion_reason: ALBA_EXCLUSION_REASON }));

    // Post-query status filter (v1: pagination accuracy not guaranteed with this active)
    const rows = statusFilter
      ? result.rows.filter(r => r.recon_status === statusFilter)
      : result.rows;

    // Summary counts built from the current page result set (Alba rows NOT included)
    const counts = result.rows.reduce((acc, r) => {
      const s = r.recon_status || 'pending';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      summary: {
        db_total,                                      // non-excluded rows matching filters
        page_count:    result.rows.length,             // rows in this page (excludes Alba)
        paid:          counts['paid']          || 0,
        chase_bsi:     counts['chase_bsi']     || 0,
        request_audit:    counts['request_audit']    || 0,
        held_licensing:   counts['held_licensing']   || 0,
        no_pay_expected:  counts['no_pay_expected']  || 0,
        pending:          counts['pending']          || 0,
        excluded_count: excluded.length               // Alba rows pulled out separately
      },
      rows,
      excluded,                                        // Alba rows with exclusion_reason
      limit:  parseInt(limit),
      offset: parseInt(offset),
      _note: [
        'v1: period-agnostic matching — client+carrier key only',
        'single best record per client+carrier per leg (latest id)',
        'chargebacks not de-duped from positive records',
        'pagination may not be accurate when status filter is applied',
        'Alba Hernandez rows excluded from counts — see excluded[]'
      ].join('; ')
    });

  } catch (err) {
    console.error('[RECON-3WAY]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agency-production/export-bsi-recon
// Produces a .xlsx workbook for the monthly BSI audit/chase package.
// Required query param: cutoffDate (YYYY-MM-DD) — "BSI has paid through ___"
// Tabs: Summary | BSI Audit Requests | BSI Chase | Held — Licensing |
//       No Payment Expected | Needs Effective Date
// Rows with effective_date > cutoff are excluded and counted on Summary.
// Alba rows are excluded entirely (same as /reconcile).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/export-bsi-recon', requireAuth, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const pool = getPool();
    const { cutoffDate } = req.query;

    if (!cutoffDate || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
      return res.status(400).json({ error: 'cutoffDate is required (YYYY-MM-DD). Enter the date BSI has paid through.' });
    }

    // ── Run full reconcile using shared CTE builder (no LIMIT — export needs all rows) ──
    const params = [ALBA_EXCLUSION_NAMES];
    const q = buildReconCTE('AND LOWER(TRIM(ap.agent_name)) != ALL($1)') + `
      ORDER BY ap.carrier, ap.agent_name, ap.effective_date DESC NULLS LAST
    `;

    const result = await pool.query(q, params);
    const allRows = result.rows;

    // ── Bucket rows by scope ─────────────────────────────────────────────────
    const cutoff = new Date(cutoffDate + 'T23:59:59Z');
    const noEffDate   = [];
    const afterCutoff = [];
    const audit       = [];
    const chase       = [];
    const held        = [];
    const withdrawn   = [];  // WITHDRAWN + CANCELLED + DENIED (no action)
    const inProgress  = [];  // IN PROGRESS (internal flag, not sent to BSI)

    for (const r of allRows) {
      // No effective date → its own tab
      if (!r.effective_date) { noEffDate.push(r); continue; }
      // After cutoff → excluded, counted on summary
      if (new Date(r.effective_date) > cutoff) { afterCutoff.push(r); continue; }
      // Skip paid and pending — not BSI-facing
      if (r.recon_status === 'paid' || r.recon_status === 'pending') continue;

      switch (r.recon_status) {
        case 'request_audit':  audit.push(r);      break;
        case 'chase_bsi':      chase.push(r);      break;
        case 'held_licensing': held.push(r);       break;
        case 'no_pay_expected':
          if (UPPER_STATUS(r.production_status) === 'IN PROGRESS') inProgress.push(r);
          else withdrawn.push(r);  // WITHDRAWN, CANCELLED, DENIED
          break;
      }
    }

    function UPPER_STATUS(s) { return (s || '').toUpperCase().trim(); }

    // Change 2: split audit by carrier coverage
    // TODO: remove UHC-only guard once normClient trailing-initial bug is fixed and
    // Humana/Devoted re-verified. Bug confirmed 2026-07-07: SQL normClient() doesn't
    // strip trailing middle initials ("ALAN KITCHMAN L" ≠ "KITCHMAN, ALAN"), causing
    // ~58 false request_audits on Jan-2026 Humana alone. Fix = one REGEXP_REPLACE in
    // normClient() in routes/agencyproduction.js. Until then, only UHC rows are
    // evidence-backed enough to go into Audit Requests; Humana+Devoted go to Verify.
    const auditBacked = audit.filter(r => r.carrier_has_uploads &&
      (r.carrier || '').toLowerCase().includes('united')); // TEMP: UHC only
    const auditVerify = audit.filter(r => !auditBacked.includes(r)); // all others

    // Change 1: map raw production status values to BSI-readable app-level labels.
    // "Paid" on Hector's report = carrier finalized the app, not that BSI paid THEI.
    function mapAppStatus(raw) {
      const s = UPPER_STATUS(raw);
      if (['COMPLETED','PAID','ACTIVE POLICY','ENROLLED'].includes(s)) return 'Finalized';
      if (s === 'APPROVED') return 'Approved';
      return raw || '';
    }

    // ── Build workbook ───────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'OliComm — The Health Experts Insurance';
    wb.created = new Date();

    // Shared style constants
    const HEADER_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }; // dark blue
    const AMBER_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; // amber tint
    const GRAY_FILL    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }; // gray tint
    const HEADER_FONT  = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const BODY_FONT    = { name: 'Arial', size: 10 };
    const THIN_BORDER  = { style: 'thin', color: { argb: 'FFB0B0B0' } };
    const CELL_BORDER  = { top: THIN_BORDER, left: THIN_BORDER, bottom: THIN_BORDER, right: THIN_BORDER };

    const COL_DEFS = [
      { header: 'Agent',          key: 'agent_name',       width: 28 },
      { header: 'Client',         key: 'client_name',      width: 30 },
      { header: 'Carrier',        key: 'carrier',          width: 20 },
      { header: 'Eff Date',       key: 'effective_date',   width: 13 },
      { header: 'App Status (Carrier)', key: 'production_status', width: 20 },
      { header: 'Carrier→BSI $',  key: 'l3_commission',    width: 15 },
      { header: 'BSI Pd Period',  key: 'l3_period',        width: 14 },
      { header: 'BSI→THEI $',     key: 'l2_commission',    width: 13 },
      { header: 'THEI Pd Period', key: 'l2_period',        width: 14 },
      { header: 'Override Status',key: 'manual_override_status', width: 18 },
      { header: 'Policy #',       key: 'policy_number',    width: 18 },
    ];

    // subtitle param (optional): inserts a merged row above the header with descriptive text.
    // Uses spliceRows to push header+data down — verified on ExcelJS 4.4.0.
    function addSheetWithRows(name, rows, rowFill, extraCols, subtitle) {
      const cols = extraCols ? [...COL_DEFS, ...extraCols] : COL_DEFS;
      const ws = wb.addWorksheet(name);
      ws.columns = cols.map(c => ({ header: c.header, key: c.key, width: c.width }));

      // Style header row
      const hdrRow = ws.getRow(1);
      hdrRow.eachCell(cell => {
        cell.fill   = HEADER_FILL;
        cell.font   = HEADER_FONT;
        cell.border = CELL_BORDER;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      hdrRow.height = 18;
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      // Data rows
      rows.forEach(r => {
        const baseRowData = {
          agent_name:      r.agent_name || '',
          client_name:     r.client_name || '',
          carrier:         r.carrier || '',
          effective_date:  r.effective_date ? new Date(r.effective_date).toLocaleDateString('en-US') : '—',
          production_status: mapAppStatus(r.production_status),
          l3_commission:   r.l3_commission != null ? parseFloat(r.l3_commission) : '',
          l3_period:       r.l3_period || '',
          l2_commission:   r.l2_commission != null ? parseFloat(r.l2_commission) : '',
          l2_period:       r.l2_period || '',
          manual_override_status: r.manual_override_status || '',
          policy_number:   r.policy_number || '',
        };
        if (extraCols) extraCols.forEach(c => { baseRowData[c.key] = r[c.key] || ''; });
        const row = ws.addRow(baseRowData);
        row.font = BODY_FONT;
        if (rowFill) {
          row.eachCell(cell => {
            cell.fill = rowFill;
            cell.border = CELL_BORDER;
          });
        } else {
          row.eachCell(cell => { cell.border = CELL_BORDER; });
        }
        // Currency formatting
        ['l3_commission', 'l2_commission'].forEach(key => {
          const cell = row.getCell(key);
          if (cell.value !== '') cell.numFmt = '$#,##0.00';
        });
      });

      // Insert subtitle row above header if specified
      if (subtitle) {
        ws.spliceRows(1, 0, []);
        const subRow = ws.getRow(1);
        ws.mergeCells(1, 1, 1, cols.length);
        subRow.getCell(1).value = subtitle;
        subRow.getCell(1).font  = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF444444' } };
        subRow.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF8' } };
        subRow.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
        subRow.height = 30;
        ws.views = [{ state: 'frozen', ySplit: 2 }];
      }

      return ws;
    }

    // ── Tab 1: Summary (first sheet — created first so it appears first in workbook) ──
    // Note: ExcelJS 4.x has no moveSheet(); create Summary before data tabs instead.
    const summaryWs = wb.addWorksheet('Summary');
    summaryWs.getColumn(1).width = 35;
    summaryWs.getColumn(2).width = 20;

    const genDate  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const summaryRows = [
      ['BSI RECON EXPORT — THE HEALTH EXPERTS INSURANCE', ''],
      ['', ''],
      ['Generated',            genDate],
      ['BSI Paid Through',     cutoffDate],
      ['Effective dates through', `${cutoffDate} (BSI confirmed paid-through period)`],
      ['', ''],
      ['PAYMENT REQUEST SUMMARY', ''],
      ['Audit requests (statement-backed, UHC)',  auditBacked.length],
      ['Verify status (no statements held)',       auditVerify.length],
      ['Pass-through owed (carrier paid BSI)',     chase.length],
      ['Held – licensing (visibility only)',        held.length],
      ['No payment expected (visibility only)',    withdrawn.length + inProgress.length],
      ['', ''],
      ['Rows excluded (eff date after cutoff)', afterCutoff.length],
      ['Rows excluded (no effective date)',      noEffDate.length],
      ['', ''],
      ['WHAT EACH TAB MEANS', ''],
      ['BSI — Audit Requests',   'Send to BSI. App finalized on Hector’s report. We hold carrier statements for these enrollments and find no payment in either leg — no carrier-to-BSI record and no BSI-to-THEI record. Payment or written audit response requested.'],
      ['BSI — Verify Status',    'Send to BSI. We do not hold carrier statements for these carriers. Production is finalized on our records — please confirm payment status on your carrier statements.'],
      ['BSI — Chase',            'Send to BSI. Carrier paid BSI (shown on carrier→BSI statement). BSI has not remitted to THEI. Chase BSI for the outstanding amount.'],
      ['Held — Licensing',       'Informational only — do not send to BSI. Carrier held payment due to licensing/appointment issue. No audit owed; track for resolution.'],
      ['No Pay — No Action',     'Do not send to BSI. Production status is Withdrawn, Cancelled, or Denied. No commission expected.'],
      ['No Pay — In Progress',   'INTERNAL USE ONLY — do not send to BSI. Application still in progress. Monitor internally.'],
    ];

    summaryRows.forEach((rowData, i) => {
      const row = summaryWs.getRow(i + 1);
      row.getCell(1).value = rowData[0];
      row.getCell(2).value = rowData[1];
      row.font = { name: 'Arial', size: 10 };

      // Title row
      if (i === 0) {
        row.getCell(1).font = { name: 'Arial', bold: true, size: 13 };
      }
      // Section headers
      if (rowData[0] === 'PAYMENT REQUEST SUMMARY' || rowData[0] === 'WHAT EACH TAB MEANS') {
        row.getCell(1).font = { name: 'Arial', bold: true, size: 10 };
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
      }
      // Data labels
      if (['Generated','BSI Paid Through','Effective dates through','Rows excluded (eff date after cutoff)','Rows excluded (no effective date)'].includes(rowData[0])) {
        row.getCell(1).font = { name: 'Arial', bold: true, size: 10 };
      }
      // Wrap the description cells
      if (i >= 16) {
        summaryWs.getColumn(2).width = 80;
        row.getCell(2).alignment = { wrapText: true };
        row.height = 30;
      }
    });

    // ── Tab 2–5: Data tabs ───────────────────────────────────────────────────
    addSheetWithRows('BSI — Audit Requests', auditBacked, null, null,
      'Production on Hector’s report with no matching BSI-to-THEI record AND no payment shown on your carrier statements. App finalized, effective date through ' + cutoffDate + '. Payment or audit response requested.');
    addSheetWithRows('BSI — Verify Status',  auditVerify, null, null,
      'Production finalized on our records; we do not hold carrier statements for these carriers. Please check your carrier statements and confirm payment status for each.');
    addSheetWithRows('BSI — Chase',          chase,       null);
    addSheetWithRows('Held — Licensing',      held,       AMBER_FILL,
      [
        { header: 'State',       key: 'l3_member_state',  width: 8  },
        { header: 'Hold Reason', key: 'l3_hold_reason',   width: 55 },
      ]);

    // No Payment Expected — two sections within one sheet
    const noPayWs = wb.addWorksheet('No Payment Expected');
    noPayWs.columns = COL_DEFS.map(c => ({ header: c.header, key: c.key, width: c.width }));

    function addNoPaySection(ws, label, rows, startRow) {
      // Section header row
      const labelRow = ws.getRow(startRow);
      labelRow.getCell(1).value = label;
      labelRow.getCell(1).font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF595959' } };
      labelRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      ws.mergeCells(startRow, 1, startRow, COL_DEFS.length);
      startRow++;

      // Column headers for this section
      const hdrRow = ws.getRow(startRow);
      COL_DEFS.forEach((c, idx) => {
        const cell = hdrRow.getCell(idx + 1);
        cell.value  = c.header;
        cell.fill   = HEADER_FILL;
        cell.font   = HEADER_FONT;
        cell.border = CELL_BORDER;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      hdrRow.height = 18;
      startRow++;

      rows.forEach(r => {
        const row = ws.getRow(startRow);
        const vals = {
          agent_name: r.agent_name || '', client_name: r.client_name || '',
          carrier: r.carrier || '',
          effective_date: r.effective_date ? new Date(r.effective_date).toLocaleDateString('en-US') : '—',
          production_status: mapAppStatus(r.production_status),
          l3_commission: r.l3_commission != null ? parseFloat(r.l3_commission) : '',
          l3_period: r.l3_period || '',
          l2_commission: r.l2_commission != null ? parseFloat(r.l2_commission) : '',
          l2_period: r.l2_period || '',
          manual_override_status: r.manual_override_status || '',
          policy_number: r.policy_number || '',
        };
        COL_DEFS.forEach((c, idx) => {
          const cell = row.getCell(idx + 1);
          cell.value  = vals[c.key];
          cell.font   = BODY_FONT;
          cell.fill   = GRAY_FILL;
          cell.border = CELL_BORDER;
          if ((c.key === 'l3_commission' || c.key === 'l2_commission') && vals[c.key] !== '') {
            cell.numFmt = '$#,##0.00';
          }
        });
        startRow++;
      });

      return startRow + 1; // blank gap between sections
    }

    let noPayRow = 1;
    noPayRow = addNoPaySection(noPayWs, 'NO ACTION — Withdrawn / Cancelled / Denied (do not send to BSI)', withdrawn, noPayRow);
    noPayRow = addNoPaySection(noPayWs, 'INTERNAL FLAG — In Progress (do not send to BSI — monitor internally)', inProgress, noPayRow);
    noPayWs.views = [{ state: 'frozen', ySplit: 2 }];

    // ── Tab 6: Needs Effective Date ──────────────────────────────────────────
    addSheetWithRows('Needs Effective Date',  noEffDate,  null);

    // ── Stream response ──────────────────────────────────────────────────────
    const safeDate = cutoffDate.replace(/-/g, '');
    const filename = `BSI_Recon_Export_through_${safeDate}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('[BSI-EXPORT]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

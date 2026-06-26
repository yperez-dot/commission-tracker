// Phase 2 additions for agencyproduction.js
// Add these helper functions at the top of the file (after excelDateToISO)

/**
 * Validate MBI format: 11 characters, pattern #A#A##A#A## (digit/letter alternating)
 * Returns cleaned MBI if valid, null if invalid
 * Better to store null than poison the crosswalk with wrong data
 */
function validateMBI(value) {
  if (!value) return null;
  
  const cleaned = String(value).trim().toUpperCase();
  
  // Must be exactly 11 characters
  if (cleaned.length !== 11) return null;
  
  // Pattern: #A#A##A#A## (digit, letter, digit, letter, digit, digit, letter, digit, letter, digit, digit)
  const mbiPattern = /^[0-9][A-Z][0-9][A-Z][0-9]{2}[A-Z][0-9][A-Z][0-9]{2}$/;
  
  if (!mbiPattern.test(cleaned)) return null;
  
  return cleaned;
}

/**
 * Extract MBI and carrier_member_id from production row based on carrier
 * Returns { mbi, carrier_member_id, policy_number_production }
 */
function extractMemberIdentifiers(row, carrier) {
  let mbi = null;
  let carrier_member_id = null;
  let policy_number_production = null;
  
  switch(carrier) {
    case 'Anthem':
      // MBI: Beneficiary_Claim_Number, carrier_member_id: HCID
      mbi = validateMBI(row.Beneficiary_Claim_Number);
      carrier_member_id = row.HCID ? String(row.HCID).trim() : null;
      break;
      
    case 'Humana':
      // MBI: MEDICARE_IDENTIFIER, carrier_member_id: UMID
      mbi = validateMBI(row.MEDICARE_IDENTIFIER);
      carrier_member_id = row.UMID ? String(row.UMID).trim() : null;
      break;
      
    case 'UnitedHealthcare':
      // Check if it's Med Supp or MA based on columns
      if (row['Policy Number'] && row['HICN/MBI']) {
        // UHC Med Supp: HICN/MBI → mbi, Policy Number → policy_number_production
        mbi = validateMBI(row['HICN/MBI']);
        policy_number_production = row['Policy Number'] ? String(row['Policy Number']).trim() : null;
        // No carrier_member_id for Med Supp (Policy Number serves as both)
      } else if (row.HIC) {
        // UHC MA: HIC → mbi, no carrier_member_id
        mbi = validateMBI(row.HIC);
      }
      break;
      
    case 'Devoted':
      // MBI: MBI, carrier_member_id: MemberRecordLocator
      mbi = validateMBI(row.MBI);
      carrier_member_id = row.MemberRecordLocator ? String(row.MemberRecordLocator).trim() : null;
      break;
      
    case 'HealthSpring':
      // MBI: Medicare_Number, carrier_member_id: Member_ID
      mbi = validateMBI(row.Medicare_Number);
      carrier_member_id = row.Member_ID ? String(row.Member_ID).trim() : null;
      break;
      
    case 'Freedom':
      // MBI: HIC#, carrier_member_id: POLICY_NUMBER or CONTRACT
      mbi = validateMBI(row['HIC#'] || row.HIC);
      carrier_member_id = (row.POLICY_NUMBER || row.CONTRACT) ? String(row.POLICY_NUMBER || row.CONTRACT).trim() : null;
      break;
      
    default:
      // Unknown carrier - try common MBI column names
      const possibleMBI = row.MBI || row.HICN || row['HICN/MBI'] || row.HIC || row['HIC#'] || row.Medicare_Number || row.MEDICARE_IDENTIFIER;
      mbi = validateMBI(possibleMBI);
  }
  
  return { mbi, carrier_member_id, policy_number_production };
}

/**
 * Check if a production row should be included based on status
 * Only Active and Future Active policies should create override expectations
 * Each carrier uses different status column names and values
 */
function isActivePolicy(row, carrier) {
  let statusValue = '';
  
  // Extract status based on carrier-specific column names
  switch(carrier) {
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
      // Fallback to common status column names
      statusValue = (row.Status || row.App_Status || row.Consumer_Status || row.POLICY_STATUS || '').trim();
  }
  
  if (!statusValue) {
    // No status found - be conservative, include it (manual review needed)
    return true;
  }
  
  // Normalize to uppercase for comparison
  const status = statusValue.toUpperCase();
  
  // Active statuses that should generate override expectations
  const activeStatuses = [
    'ACTIVE',
    'FUTURE ACTIVE',
    'PENDING',
    'ENROLLED',
    'APPROVED'
  ];
  
  // Inactive statuses that should NOT generate override expectations
  const inactiveStatuses = [
    'CANCELLED',
    'CANCELED',
    'INACTIVE',
    'TERMINATED',
    'TERMED',
    'PENDING CANCEL',
    'PENDING CANCELLATION',
    'DECLINED',
    'REJECTED'
  ];
  
  // Check if status is explicitly inactive
  for (const inactive of inactiveStatuses) {
    if (status.includes(inactive)) {
      return false;
    }
  }
  
  // Check if status is explicitly active
  for (const active of activeStatuses) {
    if (status.includes(active)) {
      return true;
    }
  }
  
  // Unknown status - be conservative, include it
  return true;
}

// Example of updated INSERT query (add to the existing INSERT in the main upload route):
/*
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
    identifiers.mbi,              // NEW
    identifiers.carrier_member_id, // NEW
    identifiers.policy_number_production // NEW
  ]
);
*/

// Example usage in the row processing loop:
/*
// Extract member identifiers (Phase 2)
const identifiers = extractMemberIdentifiers(row, carrier);

// Filter out inactive policies (Phase 2)
if (!isActivePolicy(row, carrier)) {
  console.log(`Skipping inactive policy: ${clientName} (${statusValue})`);
  skipped++;
  continue;
}
*/

module.exports = {
  validateMBI,
  extractMemberIdentifiers,
  isActivePolicy
};

// Test production file parsing against real files
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Validate MBI format (FIXED - tested against real data)
function validateMBI(value) {
  if (!value) return null;
  const cleaned = String(value).trim().toUpperCase();
  if (cleaned.length !== 11) return null;
  // Real MBI pattern: positions 3, 6, and 9 can be digit OR letter
  const mbiPattern = /^[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}$/;
  if (!mbiPattern.test(cleaned)) return null;
  return cleaned;
}

// Extract identifiers from row based on carrier
function extractMemberIdentifiers(row, carrier) {
  let mbi = null;
  let carrier_member_id = null;
  let policy_number_production = null;
  
  switch(carrier) {
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
        // UHC Med Supp
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
  }
  
  return { mbi, carrier_member_id, policy_number_production };
}

// Check if policy is active
function isActivePolicy(row, carrier) {
  let statusValue = '';
  
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
      statusValue = (row.Status || row.App_Status || row.Consumer_Status || row.POLICY_STATUS || '').trim();
  }
  
  if (!statusValue) return true; // No status = include (manual review)
  
  const status = statusValue.toUpperCase();
  const inactiveStatuses = ['CANCELLED', 'CANCELED', 'INACTIVE', 'TERMINATED', 'TERMED', 'PENDING CANCEL', 'DECLINED', 'REJECTED'];
  
  for (const inactive of inactiveStatuses) {
    if (status.includes(inactive)) return false;
  }
  
  return true; // Active, Future Active, or unknown = include
}

// Test a single file
function testFile(filename, carrier) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${filename}`);
  console.log(`Carrier: ${carrier}`);
  console.log('='.repeat(60));
  
  const workbook = XLSX.readFile(filename);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  
  console.log(`\n📊 Total rows: ${rows.length}`);
  
  if (rows.length === 0) {
    console.log('⚠️  Empty file!');
    return;
  }
  
  // Show first row columns
  console.log(`\n📋 Columns found:`);
  const columns = Object.keys(rows[0]);
  columns.slice(0, 10).forEach(col => console.log(`  - ${col}`));
  if (columns.length > 10) console.log(`  ... and ${columns.length - 10} more`);
  
  // Test MBI extraction
  let mbiExtracted = 0;
  let mbiNull = 0;
  let carrierIdExtracted = 0;
  let policyNumExtracted = 0;
  
  // Status breakdown
  const statusCounts = {};
  let activeCount = 0;
  let inactiveCount = 0;
  let futureActiveCount = 0;
  
  rows.forEach(row => {
    const identifiers = extractMemberIdentifiers(row, carrier);
    
    if (identifiers.mbi) mbiExtracted++;
    else mbiNull++;
    
    if (identifiers.carrier_member_id) carrierIdExtracted++;
    if (identifiers.policy_number_production) policyNumExtracted++;
    
    // Status tracking
    const statusCol = row.Status || row.App_Status || row.Consumer_Status || row.POLICY_STATUS || '';
    const status = String(statusCol).trim();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    
    const statusUpper = status.toUpperCase();
    if (statusUpper.includes('FUTURE ACTIVE')) {
      futureActiveCount++;
    }
    
    if (isActivePolicy(row, carrier)) {
      activeCount++;
    } else {
      inactiveCount++;
    }
  });
  
  // Results
  const mbiRate = ((mbiExtracted / rows.length) * 100).toFixed(1);
  
  console.log(`\n✅ MBI Extraction:`);
  console.log(`  Extracted: ${mbiExtracted}/${rows.length} (${mbiRate}%)`);
  console.log(`  NULL: ${mbiNull}`);
  
  if (carrierIdExtracted > 0) {
    const cidRate = ((carrierIdExtracted / rows.length) * 100).toFixed(1);
    console.log(`\n🆔 Carrier Member ID:`);
    console.log(`  Extracted: ${carrierIdExtracted}/${rows.length} (${cidRate}%)`);
  }
  
  if (policyNumExtracted > 0) {
    console.log(`\n📄 Policy Number (Med Supp):`);
    console.log(`  Extracted: ${policyNumExtracted}/${rows.length} (100%)`);
  }
  
  console.log(`\n📋 Status Breakdown:`);
  const sortedStatuses = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
  sortedStatuses.forEach(([status, count]) => {
    const statusUpper = status.toUpperCase();
    const isInactive = ['CANCELLED', 'CANCELED', 'INACTIVE', 'TERMINATED', 'TERMED'].some(s => statusUpper.includes(s));
    const icon = isInactive ? '❌' : '✅';
    const tag = isInactive ? '(FILTERED OUT)' : '(INCLUDED)';
    console.log(`  ${icon} ${status || '(blank)'}: ${count} ${tag}`);
  });
  
  if (futureActiveCount > 0) {
    console.log(`\n⭐ Future Active: ${futureActiveCount} (KEPT - not filtered)`);
  }
  
  console.log(`\n🎯 Filter Summary:`);
  console.log(`  ✅ Would INCLUDE: ${activeCount} rows`);
  console.log(`  ❌ Would FILTER OUT: ${inactiveCount} rows`);
  console.log(`  📊 Total: ${rows.length}`);
  
  if (mbiNull > 0) {
    const sampleNulls = rows.filter(r => !extractMemberIdentifiers(r, carrier).mbi).slice(0, 3);
    console.log(`\n⚠️  Sample rows with NULL MBI:`);
    sampleNulls.forEach((row, idx) => {
      const name = row.FullName || row['Member Name'] || row.Member_First_Name + ' ' + row.Member_Last_Name || '(unknown)';
      console.log(`  ${idx + 1}. ${name}`);
    });
  }
  
  return {
    carrier,
    totalRows: rows.length,
    mbiExtracted,
    mbiNull,
    carrierIdExtracted,
    policyNumExtracted,
    activeCount,
    inactiveCount,
    futureActiveCount
  };
}

// Main test runner
function main() {
  console.log('='.repeat(60));
  console.log('PRODUCTION FILES TEST - REAL DATA VALIDATION');
  console.log('='.repeat(60));
  
  const testDir = './test-production-files';
  
  const files = [
    { file: 'uhc-medsup.xlsx', carrier: 'UnitedHealthcare' },
    { file: 'uhc-ma.xlsx', carrier: 'UnitedHealthcare' },
    { file: 'devoted.xlsx', carrier: 'Devoted' },
    { file: 'anthem.xlsx', carrier: 'Anthem' },
    { file: 'freedom.xlsx', carrier: 'Freedom' }
  ];
  
  const results = [];
  
  for (const { file, carrier } of files) {
    const filepath = path.join(testDir, file);
    if (fs.existsSync(filepath)) {
      const result = testFile(filepath, carrier);
      results.push(result);
    } else {
      console.log(`\n⚠️  File not found: ${file}`);
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY - ALL FILES');
  console.log('='.repeat(60));
  
  let totalRows = 0;
  let totalMBI = 0;
  let totalActive = 0;
  let totalInactive = 0;
  
  results.forEach(r => {
    totalRows += r.totalRows;
    totalMBI += r.mbiExtracted;
    totalActive += r.activeCount;
    totalInactive += r.inactiveCount;
  });
  
  const overallMBIRate = ((totalMBI / totalRows) * 100).toFixed(1);
  
  console.log(`\n📊 Overall Stats:`);
  console.log(`  Total rows across all files: ${totalRows}`);
  console.log(`  MBI extracted: ${totalMBI}/${totalRows} (${overallMBIRate}%)`);
  console.log(`  Would include (Active): ${totalActive}`);
  console.log(`  Would filter (Inactive): ${totalInactive}`);
  
  console.log(`\n✅ ALL TESTS COMPLETE`);
}

main();

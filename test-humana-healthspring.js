// Test Humana and HealthSpring production files
const XLSX = require('xlsx');
const path = require('path');

// Validate MBI format (FIXED - tested against real data)
function validateMBI(value) {
  if (!value) return null;
  const cleaned = String(value).trim().toUpperCase();
  if (cleaned.length !== 11) return null;
  const mbiPattern = /^[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}$/;
  if (!mbiPattern.test(cleaned)) return null;
  return cleaned;
}

// Extract identifiers
function extractMemberIdentifiers(row, carrier) {
  let mbi = null;
  let carrier_member_id = null;
  
  if (carrier === 'Humana') {
    mbi = validateMBI(row.MEDICARE_IDENTIFIER);
    carrier_member_id = row.UMID ? String(row.UMID).trim() : null;
  } else if (carrier === 'HealthSpring') {
    mbi = validateMBI(row.Medicare_Number);
    carrier_member_id = row.Member_ID ? String(row.Member_ID).trim() : null;
  }
  
  return { mbi, carrier_member_id };
}

// Check if policy is active
function isActivePolicy(row, carrier) {
  let statusValue = '';
  
  if (carrier === 'Humana') {
    statusValue = (row.Status || '').trim();
  } else if (carrier === 'HealthSpring') {
    statusValue = (row.POLICY_STATUS || '').trim();
  }
  
  if (!statusValue) return true;
  
  const status = statusValue.toUpperCase();
  
  // Future Active should be KEPT
  if (status.includes('FUTURE ACTIVE')) return true;
  
  const inactiveStatuses = ['CANCELLED', 'CANCELED', 'INACTIVE', 'TERMINATED', 'TERMED', 'PENDING CANCEL', 'DECLINED', 'REJECTED'];
  
  for (const inactive of inactiveStatuses) {
    if (status.includes(inactive)) return false;
  }
  
  return true;
}

// Test a file
function testFile(filename, carrier, expectedTotal, expectedKeep, expectedDrop) {
  console.log('\n' + '='.repeat(70));
  console.log(`${carrier.toUpperCase()} PRODUCTION FILE`);
  if (expectedTotal) {
    console.log(`Expected: ${expectedTotal} total, ${expectedKeep} keep / ${expectedDrop} drop`);
  }
  console.log('='.repeat(70));
  
  const workbook = XLSX.readFile(filename);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  
  console.log(`\n📊 Total rows: ${rows.length}`);
  
  // Show columns
  console.log(`\n📋 First 10 columns:`);
  Object.keys(rows[0]).slice(0, 10).forEach(col => console.log(`  - ${col}`));
  
  // Test extraction
  let mbiExtracted = 0;
  let mbiNull = 0;
  let carrierIdExtracted = 0;
  
  const statusCounts = {};
  let activeCount = 0;
  let inactiveCount = 0;
  let futureActiveCount = 0;
  
  rows.forEach(row => {
    const identifiers = extractMemberIdentifiers(row, carrier);
    
    if (identifiers.mbi) mbiExtracted++;
    else mbiNull++;
    
    if (identifiers.carrier_member_id) carrierIdExtracted++;
    
    const statusCol = carrier === 'Humana' ? row.Status : row.POLICY_STATUS;
    const status = String(statusCol || '').trim();
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
  
  const mbiRate = ((mbiExtracted / rows.length) * 100).toFixed(1);
  const cidRate = ((carrierIdExtracted / rows.length) * 100).toFixed(1);
  
  console.log(`\n✅ MBI Extraction:`);
  console.log(`  Extracted: ${mbiExtracted}/${rows.length} (${mbiRate}%)`);
  console.log(`  NULL: ${mbiNull}`);
  
  console.log(`\n🆔 Carrier Member ID:`);
  console.log(`  Extracted: ${carrierIdExtracted}/${rows.length} (${cidRate}%)`);
  
  console.log(`\n📋 Status Breakdown:`);
  const sortedStatuses = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
  sortedStatuses.forEach(([status, count]) => {
    const statusUpper = status.toUpperCase();
    const isInactive = ['CANCELLED', 'CANCELED', 'INACTIVE', 'TERMINATED', 'TERMED'].some(s => statusUpper.includes(s));
    const isFutureActive = statusUpper.includes('FUTURE ACTIVE');
    
    let icon = '✅';
    let tag = '(INCLUDED)';
    
    if (isInactive) {
      icon = '❌';
      tag = '(FILTERED OUT)';
    } else if (isFutureActive) {
      icon = '⭐';
      tag = '(INCLUDED - Future Active)';
    }
    
    console.log(`  ${icon} ${status || '(blank)'}: ${count} ${tag}`);
  });
  
  if (futureActiveCount > 0) {
    console.log(`\n⭐ Future Active: ${futureActiveCount} (KEPT - not filtered)`);
  }
  
  console.log(`\n🎯 Filter Summary:`);
  console.log(`  ✅ Would INCLUDE: ${activeCount} rows`);
  console.log(`  ❌ Would FILTER OUT: ${inactiveCount} rows`);
  console.log(`  📊 Total: ${rows.length}`);
  
  if (expectedTotal) {
    console.log(`\n📊 COMPARISON TO EXPECTED:`);
    console.log(`  Total: ${rows.length} (expected ${expectedTotal}) ${rows.length === expectedTotal ? '✅' : '❌'}`);
    console.log(`  Keep: ${activeCount} (expected ${expectedKeep}) ${activeCount === expectedKeep ? '✅' : `❌ diff: ${activeCount - expectedKeep}`}`);
    console.log(`  Drop: ${inactiveCount} (expected ${expectedDrop}) ${inactiveCount === expectedDrop ? '✅' : `❌ diff: ${inactiveCount - expectedDrop}`}`);
    
    if (rows.length === expectedTotal && activeCount === expectedKeep && inactiveCount === expectedDrop) {
      console.log(`\n  🎉 ALL COUNTS MATCH PERFECTLY! 🎉`);
    }
  }
  
  return { carrier, totalRows: rows.length, mbiExtracted, carrierIdExtracted, activeCount, inactiveCount, futureActiveCount };
}

// Main
const testDir = './test-production-files';

console.log('='.repeat(70));
console.log('HUMANA + HEALTHSPRING PRODUCTION FILES TEST');
console.log('='.repeat(70));

const humanaResult = testFile(
  path.join(testDir, 'humana.xlsx'),
  'Humana',
  444,  // Expected total
  313,  // Expected keep
  131   // Expected drop
);

const healthspringResult = testFile(
  path.join(testDir, 'healthspring.xlsx'),
  'HealthSpring',
  null, null, null  // No expectations provided
);

console.log('\n' + '='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log(`\nHumana: ${humanaResult.totalRows} rows, ${humanaResult.mbiExtracted} MBI (${((humanaResult.mbiExtracted/humanaResult.totalRows)*100).toFixed(1)}%), ${humanaResult.activeCount} keep / ${humanaResult.inactiveCount} drop`);
console.log(`HealthSpring: ${healthspringResult.totalRows} rows, ${healthspringResult.mbiExtracted} MBI (${((healthspringResult.mbiExtracted/healthspringResult.totalRows)*100).toFixed(1)}%), ${healthspringResult.activeCount} keep / ${healthspringResult.inactiveCount} drop`);

console.log('\n✅ TEST COMPLETE\n');

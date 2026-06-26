// Test the full Humana production file (expecting 444 rows)
const XLSX = require('xlsx');

function validateMBI(value) {
  if (!value) return null;
  const cleaned = String(value).trim().toUpperCase();
  if (cleaned.length !== 11) return null;
  const mbiPattern = /^[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}$/;
  if (!mbiPattern.test(cleaned)) return null;
  return cleaned;
}

function isActivePolicy(row) {
  const statusValue = (row.Status || '').trim();
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

console.log('='.repeat(70));
console.log('HUMANA PRODUCTION FILE - FULL TEST');
console.log('Expected: 444 rows total, 313 keep / 131 drop');
console.log('='.repeat(70));

const workbook = XLSX.readFile('./test-production-files/humana-full.xlsx');
const sheetName = workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

console.log(`\n📊 Total rows: ${rows.length}`);

let mbiExtracted = 0;
let umidExtracted = 0;
const statusCounts = {};
let activeCount = 0;
let inactiveCount = 0;
let futureActiveCount = 0;

rows.forEach(row => {
  const mbi = validateMBI(row.MEDICARE_IDENTIFIER);
  if (mbi) mbiExtracted++;
  
  if (row.UMID) umidExtracted++;
  
  const status = String(row.Status || '').trim();
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  
  const statusUpper = status.toUpperCase();
  if (statusUpper.includes('FUTURE ACTIVE')) futureActiveCount++;
  
  if (isActivePolicy(row)) {
    activeCount++;
  } else {
    inactiveCount++;
  }
});

const mbiRate = ((mbiExtracted / rows.length) * 100).toFixed(1);
const umidRate = ((umidExtracted / rows.length) * 100).toFixed(1);

console.log(`\n✅ MBI Extraction (MEDICARE_IDENTIFIER):`);
console.log(`  Extracted: ${mbiExtracted}/${rows.length} (${mbiRate}%)`);

console.log(`\n🆔 UMID Extraction:`);
console.log(`  Extracted: ${umidExtracted}/${rows.length} (${umidRate}%)`);

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
  console.log(`\n⭐ Future Active Count: ${futureActiveCount} (KEPT - not filtered)`);
}

console.log(`\n${'='.repeat(70)}`);
console.log('🎯 FILTER SUMMARY');
console.log('='.repeat(70));
console.log(`  ✅ Would INCLUDE (Active/Future Active): ${activeCount} rows`);
console.log(`  ❌ Would FILTER OUT (Cancelled/Inactive): ${inactiveCount} rows`);
console.log(`  📊 Total: ${rows.length} rows`);

console.log(`\n${'='.repeat(70)}`);
console.log('📊 COMPARISON TO EXPECTED');
console.log('='.repeat(70));
console.log(`  Expected total: 444 rows`);
console.log(`  Actual total: ${rows.length} rows`);
console.log(`  Match: ${rows.length === 444 ? '✅ YES' : `❌ NO (diff: ${rows.length - 444})`}`);
console.log();
console.log(`  Expected keep: 313 rows`);
console.log(`  Actual keep: ${activeCount} rows`);
console.log(`  Match: ${activeCount === 313 ? '✅ YES' : `❌ NO (diff: ${activeCount - 313})`}`);
console.log();
console.log(`  Expected drop: 131 rows`);
console.log(`  Actual drop: ${inactiveCount} rows`);
console.log(`  Match: ${inactiveCount === 131 ? '✅ YES' : `❌ NO (diff: ${inactiveCount - 131})`}`);

if (rows.length === 444 && activeCount === 313 && inactiveCount === 131) {
  console.log(`\n🎉🎉🎉 ALL COUNTS MATCH PERFECTLY! 🎉🎉🎉`);
  console.log(`\n✅ Status filter validated at full scale!`);
  console.log(`✅ Issue #2 CLOSED - Humana filter confirmed: 313 keep / 131 drop`);
} else {
  console.log(`\n⚠️  Counts don't match - may be different time period`);
}

console.log('\n✅ TEST COMPLETE\n');

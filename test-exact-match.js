// Test exact-match whitelist approach
const XLSX = require('xlsx');

function isActivePolicy(row, carrier) {
  const statusValue = (row.Status || '').trim();
  
  if (!statusValue) return false;
  
  const status = statusValue.toUpperCase().trim();
  
  // WHITELIST - exact match
  const keepStatuses = [
    'ACTIVE',
    'ACTIVE POLICY',
    'FUTURE ACTIVE',
    'FUTURE ACTIVE POLICY',
    'ACCEPTED',
    'COMPLETED'
  ];
  
  for (const keepStatus of keepStatuses) {
    if (status === keepStatus) return true;
  }
  
  // BLACKLIST - substring for flexibility on variations
  const dropStatuses = [
    'CANCEL', 'CANCELLED', 'CANCELED',
    'INACTIVE',
    'TERMINATED', 'TERMED',
    'DENIED', 'WITHDRAWN',
    'IN PROGRESS',
    'SUBMITTED', 'PENDING',
    'REJECTED', 'DECLINED'
  ];
  
  for (const dropStatus of dropStatuses) {
    if (status.includes(dropStatus)) return false;
  }
  
  // Unknown - default drop
  console.warn(`⚠️  Unknown status "${statusValue}" - DROP`);
  return false;
}

console.log('='.repeat(70));
console.log('EXACT-MATCH WHITELIST TEST');
console.log('='.repeat(70));

const workbook = XLSX.readFile('./test-production-files/humana-full.xlsx');
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

console.log(`\n📊 Total: ${rows.length}`);

const statusCounts = {};
let keepCount = 0;
let dropCount = 0;

rows.forEach(row => {
  const status = String(row.Status || '').trim();
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  
  if (isActivePolicy(row, 'Humana')) {
    keepCount++;
  } else {
    dropCount++;
  }
});

console.log(`\n📋 Status Breakdown:`);
Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
  const result = isActivePolicy({ Status: status }, 'Humana');
  const icon = result ? '✅' : '❌';
  console.log(`  ${icon} ${status || '(blank)'}: ${count}`);
});

console.log(`\n🎯 Results:`);
console.log(`  KEEP: ${keepCount} (expected 312)`);
console.log(`  DROP: ${dropCount} (expected 132)`);
console.log(`  Match: ${keepCount === 312 && dropCount === 132 ? '✅ PERFECT' : '❌ NO'}`);

// Test edge cases
console.log(`\n🧪 Edge Case Tests:`);
const edgeCases = ['Reactivated', 'Pre-Active', 'Non-Active', 'Inactive Policy'];
edgeCases.forEach(status => {
  const result = isActivePolicy({ Status: status }, 'Test');
  console.log(`  ${status}: ${result ? '✅ KEEP' : '❌ DROP'} ${!result ? '(correct)' : '(WRONG!)'}`);
});

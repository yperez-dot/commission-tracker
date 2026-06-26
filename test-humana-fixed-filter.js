// Re-test with FIXED filter logic (checks INACTIVE before ACTIVE)
const XLSX = require('xlsx');

function isActivePolicy(row) {
  const statusValue = (row.Status || '').trim();
  
  if (!statusValue) return false;
  
  const status = statusValue.toUpperCase();
  
  // DROP: Check explicit inactive statuses FIRST
  const dropStatuses = [
    'CANCEL', 'INACTIVE', 'TERMINATED', 'TERMED',
    'DENIED', 'WITHDRAWN', 'IN PROGRESS', 'SUBMITTED',
    'PENDING', 'REJECTED', 'DECLINED'
  ];
  
  for (const dropStatus of dropStatuses) {
    if (status.includes(dropStatus)) return false;
  }
  
  // KEEP: Only Active and Future Active
  if (status.includes('ACTIVE')) return true;
  if (status.includes('FUTURE')) return true;
  
  // DROP: Everything else
  return false;
}

console.log('='.repeat(70));
console.log('HUMANA - FIXED STRICT FILTER (Inactive checked before Active)');
console.log('='.repeat(70));

const workbook = XLSX.readFile('./test-production-files/humana-full.xlsx');
const sheetName = workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

console.log(`\n📊 Total rows: ${rows.length}`);

const statusCounts = {};
let activeCount = 0;
let inactiveCount = 0;

rows.forEach(row => {
  const status = String(row.Status || '').trim();
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  
  if (isActivePolicy(row)) {
    activeCount++;
  } else {
    inactiveCount++;
  }
});

console.log(`\n📋 Status Breakdown:`);
Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
  const result = isActivePolicy({ Status: status });
  const icon = result ? '✅' : '❌';
  const tag = result ? '(KEPT)' : '(DROPPED)';
  console.log(`  ${icon} ${status || '(blank)'}: ${count} ${tag}`);
});

console.log(`\n🎯 Filter Summary:`);
console.log(`  ✅ KEEP: ${activeCount} rows`);
console.log(`  ❌ DROP: ${inactiveCount} rows`);
console.log(`  📊 Total: ${rows.length}`);

console.log(`\n📊 Comparison:`);
console.log(`  Expected keep: 312 (288 Active + 24 Future Active, NOT In Progress)`);
console.log(`  Actual keep: ${activeCount}`);
console.log(`  Match: ${activeCount === 312 ? '✅ PERFECT!' : `❌ NO (diff: ${activeCount - 312})`}`);

console.log(`\n  Expected drop: 132 (122 Cancelled + 9 Inactive + 1 In Progress)`);
console.log(`  Actual drop: ${inactiveCount}`);
console.log(`  Match: ${inactiveCount === 132 ? '✅ PERFECT!' : `❌ NO (diff: ${inactiveCount - 132})`}`);

console.log('\n✅ TEST COMPLETE\n');

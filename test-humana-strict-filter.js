// Re-test Humana with STRICT filter (only Active + Future Active)
const XLSX = require('xlsx');

function isActivePolicy(row) {
  const statusValue = (row.Status || '').trim();
  
  if (!statusValue) return false; // No status = drop
  
  const status = statusValue.toUpperCase();
  
  // KEEP: Only Active and Future Active
  if (status.includes('ACTIVE')) return true;
  if (status.includes('FUTURE') && status.includes('ACTIVE')) return true;
  
  // DROP: Everything else
  return false;
}

console.log('='.repeat(70));
console.log('HUMANA - STRICT FILTER TEST (Only Active + Future Active)');
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

console.log(`\n📋 Status Breakdown (with STRICT filter):`);
Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
  const statusUpper = status.toUpperCase();
  const isActive = statusUpper.includes('ACTIVE');
  const isFutureActive = statusUpper.includes('FUTURE') && statusUpper.includes('ACTIVE');
  
  let icon = '❌';
  let tag = '(DROPPED)';
  
  if (isActive || isFutureActive) {
    icon = '✅';
    tag = isActive ? '(KEPT - Active)' : '(KEPT - Future Active)';
  }
  
  console.log(`  ${icon} ${status || '(blank)'}: ${count} ${tag}`);
});

console.log(`\n🎯 Filter Summary:`);
console.log(`  ✅ KEEP (Active + Future Active): ${activeCount} rows`);
console.log(`  ❌ DROP (everything else): ${inactiveCount} rows`);
console.log(`  📊 Total: ${rows.length}`);

console.log(`\n📊 Expected vs Actual:`);
console.log(`  Expected keep: 313 (288 Active + 24 Future Active + 1 In Progress)`);
console.log(`  Actual keep: ${activeCount}`);
console.log(`  Match: ${activeCount === 312 ? '✅ YES (312 = 288+24, In Progress now dropped)' : activeCount === 313 ? '⚠️  313 (In Progress still kept?)' : '❌ NO'}`);

console.log('\n✅ TEST COMPLETE\n');

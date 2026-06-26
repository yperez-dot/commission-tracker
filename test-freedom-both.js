const XLSX = require('xlsx');

const keepStatuses = [
  'ACTIVE', 'ACTIVE POLICY', 'FUTURE ACTIVE', 'FUTURE ACTIVE POLICY',
  'ACCEPTED', 'ENROLLED', 'APPROVED', 'CMS ACCEPTED', 'NEW_EFFECTIVE'
];

const dropStatuses = [
  'CANCEL', 'CANCELLED', 'CANCELED',
  'INACTIVE', 'NEVER ACTIVE', 'DER', 'NA',
  'TERMINATED', 'TERMED', 'DENIED', 'WITHDRAWN',
  'IN PROGRESS', 'SUBMITTED', 'PENDING',
  'REJECTED', 'DECLINED', 'DISENROLL', 'DISENROLLED',
  'COMPLETED', 'DUPLICATE'
];

const files = [
  {
    name: 'Freedom May (05.12.26)',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/Freedom_Production_05.12.26_Brokers_Society_Alba_Hernandez_1---cec7eea9-2367-4f63-84e4-b5eaf81d9fa6.xlsx',
    expected: { total: 8, keep: 6, drop: 2 }
  },
  {
    name: 'Freedom January (01.21.26)',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/Freedom_Production_01.21.26_Brokers_Society_Alba_Hernandez---eb6fa6bb-acbc-42ab-b621-36e3390db1b7.xlsx',
    expected: { total: 8, keep: 6, drop: 2 }
  }
];

for (const file of files) {
  console.log('\n' + '='.repeat(70));
  console.log(file.name);
  console.log('Expected: ' + file.expected.total + ' total, ' + file.expected.keep + ' keep / ' + file.expected.drop + ' drop');
  console.log('='.repeat(70));
  
  const wb = XLSX.readFile(file.path);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  
  console.log(`\nTotal rows: ${rows.length}`);
  
  // Check for POLICY_STATUS column
  const hasColumn = rows[0].hasOwnProperty('POLICY_STATUS');
  console.log(`Has POLICY_STATUS column: ${hasColumn ? '✅ YES' : '❌ NO'}`);
  
  if (!hasColumn) {
    console.log('Available columns:', Object.keys(rows[0]).slice(0, 15).join(', '));
    continue;
  }
  
  const statusCounts = {};
  let keepCount = 0;
  let dropCount = 0;
  
  rows.forEach(row => {
    const status = String(row.POLICY_STATUS || '').trim().toUpperCase();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    
    let keep = false;
    
    // Check whitelist
    if (status && keepStatuses.includes(status)) {
      keep = true;
    }
    
    // Check blacklist (substring)
    if (!keep) {
      for (const dropStatus of dropStatuses) {
        if (status.includes(dropStatus)) {
          keep = false;
          break;
        }
      }
    }
    
    if (keep) keepCount++;
    else dropCount++;
  });
  
  console.log('\nPOLICY_STATUS breakdown:');
  Object.entries(statusCounts).sort((a,b) => b[1] - a[1]).forEach(([s, c]) => {
    let result = 'DROP';
    if (keepStatuses.includes(s)) result = 'KEEP';
    else {
      for (const dropStatus of dropStatuses) {
        if (s.includes(dropStatus)) {
          result = 'DROP';
          break;
        }
      }
    }
    const icon = result === 'KEEP' ? '✅' : '❌';
    console.log(`  ${icon} "${s || '(blank)'}": ${c} (${result})`);
  });
  
  console.log('\nResults:');
  console.log(`  Total: ${rows.length} (expected ${file.expected.total}) ${rows.length === file.expected.total ? '✅' : '❌'}`);
  console.log(`  KEEP: ${keepCount} (expected ${file.expected.keep}) ${keepCount === file.expected.keep ? '✅' : '❌'}`);
  console.log(`  DROP: ${dropCount} (expected ${file.expected.drop}) ${dropCount === file.expected.drop ? '✅' : '❌'}`);
  
  if (rows.length === file.expected.total && keepCount === file.expected.keep && dropCount === file.expected.drop) {
    console.log('\n🎉 PERFECT MATCH!');
  }
}

console.log('\n' + '='.repeat(70));
console.log('Note: DUPLICATE is in the blacklist');
console.log('='.repeat(70));

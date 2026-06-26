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
  'COMPLETED', 'DUPLICATE'  // Check if DUPLICATE is here
];

console.log('Testing Freedom status filter...\n');

const filename = '/home/medicare-ai-agent/.openclaw/media/inbound/Freedom_Production_05.12.26_Brokers_Society_Alba_Hernandez_1---6f46d0a3-89af-43ee-a7b1-4921ca4aa71f.xlsx';

const wb = XLSX.readFile(filename);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

console.log(`Total rows: ${rows.length}\n`);

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
  
  // Check blacklist (substring match)
  for (const dropStatus of dropStatuses) {
    if (status.includes(dropStatus)) {
      keep = false;
      break;
    }
  }
  
  if (keep) keepCount++;
  else dropCount++;
});

console.log('POLICY_STATUS breakdown:');
Object.entries(statusCounts).sort((a,b) => b[1] - a[1]).forEach(([s, c]) => {
  let result = 'KEEP';
  if (keepStatuses.includes(s)) {
    result = 'KEEP';
  } else {
    for (const dropStatus of dropStatuses) {
      if (s.includes(dropStatus)) {
        result = 'DROP';
        break;
      }
    }
  }
  console.log(`  ${result === 'KEEP' ? '✅' : '❌'} "${s || '(blank)'}": ${c} (${result})`);
});

console.log(`\nResults:`);
console.log(`  KEEP: ${keepCount} (expected 6)`);
console.log(`  DROP: ${dropCount} (expected 2)`);
console.log(`  Total: ${rows.length} (expected 8)`);

console.log(`\nMatch: ${keepCount === 6 && dropCount === 2 ? '✅ YES' : '❌ NO'}`);

// Check if DUPLICATE is in blacklist
console.log(`\n"DUPLICATE" in blacklist: ${dropStatuses.includes('DUPLICATE') ? '✅ YES' : '❌ NO - NEEDS TO BE ADDED'}`);

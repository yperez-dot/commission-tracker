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

console.log('='.repeat(70));
console.log('DEVOTED JANUARY FILE - Status Filter Test');
console.log('Expected: 47 total, 19 keep / 28 drop');
console.log('='.repeat(70));

const filename = '/home/medicare-ai-agent/.openclaw/media/inbound/Devoted_Production_01.25.26_Brokers_Society_Alba_Hernandez---5c5ac4e2-a915-4387-aa51-67a795c8e2ee.xlsx';

const wb = XLSX.readFile(filename);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

console.log(`\n📊 Total rows: ${rows.length}\n`);

// Check for Status column
console.log('Column check:');
console.log(`  Has "Status" column: ${rows[0].hasOwnProperty('Status') ? '✅ YES' : '❌ NO'}`);
if (!rows[0].hasOwnProperty('Status')) {
  console.log('  Available columns:', Object.keys(rows[0]).slice(0, 15).join(', '));
}

const statusCounts = {};
let keepCount = 0;
let dropCount = 0;

rows.forEach(row => {
  const status = String(row.Status || '').trim().toUpperCase();
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  
  let keep = false;
  
  // Check whitelist (exact match)
  if (status && keepStatuses.includes(status)) {
    keep = true;
  }
  
  // Check blacklist (substring match)
  if (!keep) {
    for (const dropStatus of dropStatuses) {
      if (status.includes(dropStatus)) {
        keep = false;
        break;
      }
    }
  }
  
  // If not in whitelist and not in blacklist, default to DROP (conservative)
  if (status && !keepStatuses.includes(status)) {
    let inBlacklist = false;
    for (const dropStatus of dropStatuses) {
      if (status.includes(dropStatus)) {
        inBlacklist = true;
        break;
      }
    }
    if (!inBlacklist) {
      keep = false; // Unknown status = drop
    }
  }
  
  if (keep) keepCount++;
  else dropCount++;
});

console.log('\n📋 Status Breakdown:');
Object.entries(statusCounts).sort((a,b) => b[1] - a[1]).forEach(([s, c]) => {
  let result = 'DROP';
  
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
  
  const icon = result === 'KEEP' ? '✅' : '❌';
  console.log(`  ${icon} "${s || '(blank)'}": ${c} (${result})`);
});

console.log('\n' + '='.repeat(70));
console.log('🎯 RESULTS');
console.log('='.repeat(70));
console.log(`  Total: ${rows.length} (expected 47) ${rows.length === 47 ? '✅' : '❌'}`);
console.log(`  KEEP: ${keepCount} (expected 19) ${keepCount === 19 ? '✅' : '❌'}`);
console.log(`  DROP: ${dropCount} (expected 28) ${dropCount === 28 ? '✅' : '❌'}`);

if (rows.length === 47 && keepCount === 19 && dropCount === 28) {
  console.log('\n🎉 PERFECT MATCH! Devoted January validated! 🎉');
} else {
  console.log('\n⚠️  Mismatch - investigating...');
  
  if (keepCount !== 19) {
    console.log(`\n  Keep difference: ${keepCount - 19} (got ${keepCount}, expected 19)`);
  }
  if (dropCount !== 28) {
    console.log(`  Drop difference: ${dropCount - 28} (got ${dropCount}, expected 28)`);
  }
}

// Final validation with Consumer_Status for UHC MA and complete whitelist
const XLSX = require('xlsx');

const keepStatuses = [
  'ACTIVE', 'ACTIVE POLICY', 'FUTURE ACTIVE', 'FUTURE ACTIVE POLICY',
  'ACCEPTED', 'ENROLLED', 'APPROVED', 'CMS ACCEPTED', 'NEW_EFFECTIVE'
];

const files = [
  {
    name: 'UHC MA (Jan) - Consumer_Status = ACTIVE',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/UHC_Production_01.26.26_-_Brokers_Society_Alba_Hernandez---3c5270f1-8bc0-4fd1-9ba7-eb169c9e3168.xlsx',
    statusCol: 'Consumer_Status',
    expected: { total: 424, keep: 287, drop: 137 }
  },
  {
    name: 'HealthSpring (Dec) - Status (Enrolled)',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/CIGNA_HealthSpring_12.11.25_Brokers_Society_Alba_Hernandez---131283e4-47f4-418b-9d32-ac7ed7fcf664.xlsx',
    statusCol: 'Status',
    expected: { total: 14, keep: 6, drop: 8 }
  },
  {
    name: 'Freedom (May) - POLICY_STATUS (CMS Accepted)',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/Freedom_Production_05.12.26_Brokers_Society_Alba_Hernandez_1---6f46d0a3-89af-43ee-a7b1-4921ca4aa71f.xlsx',
    statusCol: 'POLICY_STATUS',
    expected: { total: 8, keep: 6, drop: 2 }
  },
  {
    name: 'Devoted (May) - Status (Enrolled/Approved)',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/Devoted_Production_05.13.26_Brokers_Society_1---f502fd0c-55aa-429b-bcc1-52aae245ba16.xlsx',
    statusCol: 'Status',
    expected: { total: 47, keep: 19, drop: 28 }
  }
];

console.log('='.repeat(70));
console.log('FINAL VALIDATION - Corrected Columns + Complete Whitelist');
console.log('='.repeat(70));

let allMatch = true;

for (const file of files) {
  console.log('\n' + file.name);
  console.log('Expected: ' + file.expected.total + ' total, ' + file.expected.keep + ' keep / ' + file.expected.drop + ' drop');
  console.log('-'.repeat(70));
  
  const wb = XLSX.readFile(file.path);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  
  if (!rows[0].hasOwnProperty(file.statusCol)) {
    console.log('❌ Column "' + file.statusCol + '" not found!');
    allMatch = false;
    continue;
  }
  
  const statusCounts = {};
  let keepCount = 0;
  let dropCount = 0;
  
  rows.forEach(row => {
    const status = String(row[file.statusCol] || '').trim().toUpperCase();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    
    if (status && keepStatuses.includes(status)) {
      keepCount++;
    } else {
      dropCount++;
    }
  });
  
  console.log('\nStatus breakdown:');
  Object.entries(statusCounts).sort((a,b) => b[1] - a[1]).forEach(([s, c]) => {
    const isKeep = s && keepStatuses.includes(s);
    const icon = isKeep ? '✅' : '❌';
    console.log('  ' + icon + ' "' + (s || '(blank)') + '": ' + c);
  });
  
  const totalMatch = rows.length === file.expected.total;
  const keepMatch = keepCount === file.expected.keep;
  const dropMatch = dropCount === file.expected.drop;
  
  console.log('\nResults:');
  console.log('  Total: ' + rows.length + ' (expected ' + file.expected.total + ') ' + (totalMatch ? '✅' : '❌'));
  console.log('  KEEP: ' + keepCount + ' (expected ' + file.expected.keep + ') ' + (keepMatch ? '✅' : '❌'));
  console.log('  DROP: ' + dropCount + ' (expected ' + file.expected.drop + ') ' + (dropMatch ? '✅' : '❌'));
  
  if (totalMatch && keepMatch && dropMatch) {
    console.log('\n🎉 PERFECT MATCH!');
  } else {
    console.log('\n⚠️  MISMATCH');
    allMatch = false;
  }
}

console.log('\n' + '='.repeat(70));
if (allMatch) {
  console.log('✅ ALL FILES VALIDATED - Phase 2 COMPLETE!');
} else {
  console.log('⚠️  Some files need adjustment');
}
console.log('='.repeat(70));

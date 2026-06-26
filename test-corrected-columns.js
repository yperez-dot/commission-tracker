// Test with CORRECTED column names and UPDATED whitelist
const XLSX = require('xlsx');

const keepStatuses = [
  'ACTIVE', 'ACTIVE POLICY', 'FUTURE ACTIVE', 'FUTURE ACTIVE POLICY',
  'ACCEPTED', 'COMPLETED', 'ENROLLED', 'APPROVED', 'CMS ACCEPTED', 'NEW_EFFECTIVE'
];

const files = [
  {
    name: 'UHC MA (Jan)',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/UHC_Production_01.26.26_-_Brokers_Society_Alba_Hernandez---3c5270f1-8bc0-4fd1-9ba7-eb169c9e3168.xlsx',
    statusCol: 'App_Status',
    expected: { total: 424, keep: 382, drop: 42 }
  },
  {
    name: 'HealthSpring (Dec)',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/CIGNA_HealthSpring_12.11.25_Brokers_Society_Alba_Hernandez---131283e4-47f4-418b-9d32-ac7ed7fcf664.xlsx',
    statusCol: 'Status',
    expected: { total: 14, keep: 6, drop: 8 }
  },
  {
    name: 'Freedom (May)',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/Freedom_Production_05.12.26_Brokers_Society_Alba_Hernandez_1---6f46d0a3-89af-43ee-a7b1-4921ca4aa71f.xlsx',
    statusCol: 'POLICY_STATUS',
    expected: { total: 8, keep: 6, drop: 2 }
  },
  {
    name: 'Devoted (May)',
    path: '/home/medicare-ai-agent/.openclaw/media/inbound/Devoted_Production_05.13.26_Brokers_Society_1---f502fd0c-55aa-429b-bcc1-52aae245ba16.xlsx',
    statusCol: 'Status',
    expected: { total: 47, keep: 19, drop: 28 }
  }
];

for (const file of files) {
  console.log('\n' + '='.repeat(70));
  console.log(file.name);
  console.log('Expected: ' + file.expected.total + ' total, ' + file.expected.keep + ' keep / ' + file.expected.drop + ' drop');
  console.log('='.repeat(70));
  
  const wb = XLSX.readFile(file.path);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  
  console.log('Total rows: ' + rows.length);
  console.log('Status column: ' + file.statusCol);
  console.log('Has column? ' + (rows[0].hasOwnProperty(file.statusCol) ? 'YES' : 'NO'));
  
  if (!rows[0].hasOwnProperty(file.statusCol)) {
    console.log('⚠️  Column not found! Available columns:');
    console.log('   ' + Object.keys(rows[0]).slice(0, 15).join(', '));
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
  
  console.log('\nStatus values:');
  Object.entries(statusCounts).sort((a,b) => b[1] - a[1]).forEach(([s, c]) => {
    const isKeep = s && keepStatuses.includes(s);
    const icon = isKeep ? '✅ KEEP' : '❌ DROP';
    console.log('  ' + icon + ' "' + (s || '(blank)') + '": ' + c);
  });
  
  console.log('\nResults:');
  console.log('  KEEP: ' + keepCount + ' (expected ' + file.expected.keep + ') ' + (keepCount === file.expected.keep ? '✅' : '❌'));
  console.log('  DROP: ' + dropCount + ' (expected ' + file.expected.drop + ') ' + (dropCount === file.expected.drop ? '✅' : '❌'));
  console.log('  Total: ' + rows.length + ' (expected ' + file.expected.total + ') ' + (rows.length === file.expected.total ? '✅' : '❌'));
  
  if (keepCount === file.expected.keep && dropCount === file.expected.drop) {
    console.log('\n🎉 PERFECT MATCH!');
  }
}

console.log('\n' + '='.repeat(70));
console.log('UHC MA NUANCE - Consumer_Status Check');
console.log('='.repeat(70));

const uhc = XLSX.readFile('/home/medicare-ai-agent/.openclaw/media/inbound/UHC_Production_01.26.26_-_Brokers_Society_Alba_Hernandez---3c5270f1-8bc0-4fd1-9ba7-eb169c9e3168.xlsx');
const uhcRows = XLSX.utils.sheet_to_json(uhc.Sheets[uhc.SheetNames[0]]);

console.log('\nUHC MA has THREE status columns:');
console.log('  App_Status, Consumer_Status, Status_Reason');

const appStatusCounts = {};
const consumerStatusCounts = {};
let consumerActive = 0;

uhcRows.forEach(row => {
  const appStatus = String(row.App_Status || '').trim();
  const consumerStatus = String(row.Consumer_Status || '').trim();
  
  appStatusCounts[appStatus] = (appStatusCounts[appStatus] || 0) + 1;
  consumerStatusCounts[consumerStatus] = (consumerStatusCounts[consumerStatus] || 0) + 1;
  
  if (consumerStatus.toUpperCase() === 'ACTIVE') consumerActive++;
});

console.log('\nApp_Status breakdown:');
Object.entries(appStatusCounts).sort((a,b) => b[1] - a[1]).forEach(([s,c]) => {
  console.log('  ' + (s || '(blank)') + ': ' + c);
});

console.log('\nConsumer_Status breakdown:');
Object.entries(consumerStatusCounts).sort((a,b) => b[1] - a[1]).forEach(([s,c]) => {
  console.log('  ' + (s || '(blank)') + ': ' + c);
});

console.log('\n⚠️  KEY FINDING:');
console.log('  App_Status=COMPLETED: 382 rows (application finished)');
console.log('  Consumer_Status=ACTIVE: ' + consumerActive + ' rows (actually enrolled)');
console.log('  Difference: ~' + (382 - consumerActive) + ' completed apps that never activated');
console.log('\n❓ QUESTION FOR USER:');
console.log('  Which should we use for override purposes?');
console.log('  - App_Status=COMPLETED (382 keep) - includes non-active policies');
console.log('  - Consumer_Status=ACTIVE (' + consumerActive + ' keep) - true active enrollment');

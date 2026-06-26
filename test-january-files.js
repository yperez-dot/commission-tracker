// Test January/recent files with strict filter
const XLSX = require('xlsx');

function validateMBI(value) {
  if (!value) return null;
  const cleaned = String(value).trim().toUpperCase();
  if (cleaned.length !== 11) return null;
  const mbiPattern = /^[1-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9][A-Z][0-9A-Z][0-9]{2}$/;
  if (!mbiPattern.test(cleaned)) return null;
  return cleaned;
}

function isActivePolicy(row, carrier) {
  let statusValue = '';
  
  switch(carrier) {
    case 'HealthSpring':
      statusValue = (row.POLICY_STATUS || '').trim();
      break;
    default:
      statusValue = (row.Status || row.App_Status || row.Consumer_Status || row.POLICY_STATUS || '').trim();
  }
  
  if (!statusValue) {
    console.warn(`⚠️  ${carrier}: No status value - defaulting to DROP`);
    return false;
  }
  
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
  
  // BLACKLIST
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
  
  // UNKNOWN - warn and DROP
  console.warn(`⚠️  ${carrier}: Unknown status "${statusValue}" - defaulting to DROP`);
  return false;
}

const files = [
  { name: 'UHC MA (Jan)', path: '/home/medicare-ai-agent/.openclaw/media/inbound/UHC_Production_01.26.26_-_Brokers_Society_Alba_Hernandez---3c5270f1-8bc0-4fd1-9ba7-eb169c9e3168.xlsx', carrier: 'UnitedHealthcare', expected: { total: 424, keep: 382, drop: 42 } },
  { name: 'HealthSpring (Dec)', path: '/home/medicare-ai-agent/.openclaw/media/inbound/CIGNA_HealthSpring_12.11.25_Brokers_Society_Alba_Hernandez---131283e4-47f4-418b-9d32-ac7ed7fcf664.xlsx', carrier: 'HealthSpring', expected: { total: 14, keep: 6, drop: 8 } },
  { name: 'Devoted (May)', path: '/home/medicare-ai-agent/.openclaw/media/inbound/Devoted_Production_05.13.26_Brokers_Society_1---f502fd0c-55aa-429b-bcc1-52aae245ba16.xlsx', carrier: 'Devoted', expected: { total: 47, keep: 19, drop: 28 } },
  { name: 'Freedom (May)', path: '/home/medicare-ai-agent/.openclaw/media/inbound/Freedom_Production_05.12.26_Brokers_Society_Alba_Hernandez_1---6f46d0a3-89af-43ee-a7b1-4921ca4aa71f.xlsx', carrier: 'Freedom', expected: { total: 8, keep: 7, drop: 1 } }
];

for (const file of files) {
  console.log('\n' + '='.repeat(70));
  console.log(`${file.name} - Expected: ${file.expected.total} total, ${file.expected.keep} keep / ${file.expected.drop} drop`);
  console.log('='.repeat(70));
  
  const workbook = XLSX.readFile(file.path);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  
  console.log(`\nTotal rows: ${rows.length}`);
  
  // Extract MBI
  let mbiCount = 0;
  rows.forEach(row => {
    let mbi = null;
    if (file.carrier === 'HealthSpring') mbi = validateMBI(row.Medicare_Number);
    else if (file.carrier === 'Devoted') mbi = validateMBI(row.MBI);
    else if (file.carrier === 'UnitedHealthcare') mbi = validateMBI(row.HIC);
    else if (file.carrier === 'Freedom') mbi = validateMBI(row['HIC#']);
    if (mbi) mbiCount++;
  });
  
  console.log(`MBI: ${mbiCount}/${rows.length} (${((mbiCount/rows.length)*100).toFixed(1)}%)`);
  
  // Status breakdown
  const statusCounts = {};
  let keepCount = 0;
  let dropCount = 0;
  
  rows.forEach(row => {
    let statusCol = '';
    if (file.carrier === 'HealthSpring') statusCol = row.POLICY_STATUS || '';
    else statusCol = row.Status || row.Consumer_Status || '';
    
    const status = String(statusCol).trim();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    
    if (isActivePolicy(row, file.carrier)) {
      keepCount++;
    } else {
      dropCount++;
    }
  });
  
  console.log(`\nDistinct status values:`);
  Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    const testRow = file.carrier === 'HealthSpring' ? { POLICY_STATUS: status } : { Status: status };
    const result = isActivePolicy(testRow, file.carrier);
    const icon = result ? '✅ KEEP' : '❌ DROP';
    console.log(`  ${icon} "${status}": ${count}`);
  });
  
  console.log(`\nResults:`);
  console.log(`  KEEP: ${keepCount} (expected ${file.expected.keep}) ${keepCount === file.expected.keep ? '✅' : `❌ diff: ${keepCount - file.expected.keep}`}`);
  console.log(`  DROP: ${dropCount} (expected ${file.expected.drop}) ${dropCount === file.expected.drop ? '✅' : `❌ diff: ${dropCount - file.expected.drop}`}`);
  console.log(`  Total: ${rows.length} (expected ${file.expected.total}) ${rows.length === file.expected.total ? '✅' : '❌'}`);
}

console.log('\n' + '='.repeat(70));
console.log('ANSWER: When status is unrecognized, does it default to KEEP or DROP?');
console.log('ANSWER: DROP + console.warn (see warnings above)');
console.log('='.repeat(70));

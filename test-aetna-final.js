// Test Aetna with 3-column status logic
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
  // Aetna: Check 3 status columns
  const enrollStatus = (row.Enroll_Status || '').trim().toUpperCase();
  const exitStatus = (row.Exit_Status || '').trim().toUpperCase();
  const termStatus = (row.Term_Status || '').trim().toUpperCase();
  
  // Drop if any status contains Cancel/Voluntary
  if (enrollStatus.includes('CANCEL')) return false;
  if (exitStatus.includes('VOLUNTARY') || exitStatus.includes('CANCEL')) return false;
  if (termStatus.includes('VOLUNTARY') || termStatus.includes('CANCEL')) return false;
  
  // For Aetna, only keep if Enroll_Status is Active or Future Active
  if (enrollStatus.includes('ACTIVE') || enrollStatus.includes('FUTURE')) return true;
  
  // Otherwise drop (pending, in progress, etc.)
  return false;
}

console.log('='.repeat(70));
console.log('AETNA PRODUCTION FILE - 3-COLUMN STATUS TEST');
console.log('Expected: 63 keep / 32 drop (95 total)');
console.log('='.repeat(70));

const filename = '/home/medicare-ai-agent/.openclaw/media/inbound/Aetna_Production_01.26.26_-_Brokers_Society_Alba_Hernandez---fab2b125-4f02-4804-ba46-8b9f582efd68.xlsx';

const workbook = XLSX.readFile(filename);
const sheetName = workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

console.log(`\n📊 Total rows: ${rows.length}`);

console.log(`\n📋 Column check:`);
const hasEnroll = rows[0].hasOwnProperty('Enroll_Status');
const hasExit = rows[0].hasOwnProperty('Exit_Status');
const hasTerm = rows[0].hasOwnProperty('Term_Status');
console.log(`  Enroll_Status: ${hasEnroll ? '✅ Found' : '❌ Missing'}`);
console.log(`  Exit_Status: ${hasExit ? '✅ Found' : '❌ Missing'}`);
console.log(`  Term_Status: ${hasTerm ? '✅ Found' : '❌ Missing'}`);

// MBI extraction
let mbiExtracted = 0;
let affinityExtracted = 0;

rows.forEach(row => {
  const mbi = validateMBI(row.MEDICARE_NUMBER);
  if (mbi) mbiExtracted++;
  if (row.Affinitypolicyid) affinityExtracted++;
});

console.log(`\n✅ MBI Extraction (MEDICARE_NUMBER):`);
console.log(`  Extracted: ${mbiExtracted}/${rows.length} (${((mbiExtracted/rows.length)*100).toFixed(1)}%)`);

console.log(`\n🆔 Affinitypolicyid:`);
console.log(`  Extracted: ${affinityExtracted}/${rows.length} (${((affinityExtracted/rows.length)*100).toFixed(1)}%)`);

// Status breakdown
const enrollCounts = {};
const exitCounts = {};
const termCounts = {};
let keepCount = 0;
let dropCount = 0;

rows.forEach(row => {
  const enroll = String(row.Enroll_Status || '').trim();
  const exit = String(row.Exit_Status || '').trim();
  const term = String(row.Term_Status || '').trim();
  
  enrollCounts[enroll] = (enrollCounts[enroll] || 0) + 1;
  if (exit) exitCounts[exit] = (exitCounts[exit] || 0) + 1;
  if (term) termCounts[term] = (termCounts[term] || 0) + 1;
  
  if (isActivePolicy(row)) {
    keepCount++;
  } else {
    dropCount++;
  }
});

console.log(`\n📋 Enroll_Status Breakdown:`);
Object.entries(enrollCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
  const result = isActivePolicy({ Enroll_Status: status, Exit_Status: '', Term_Status: '' });
  const icon = result ? '✅' : '❌';
  const tag = result ? '(KEEP)' : '(DROP)';
  console.log(`  ${icon} ${status || '(blank)'}: ${count} ${tag}`);
});

if (Object.keys(exitCounts).length > 0) {
  console.log(`\n📋 Exit_Status (non-blank only):`);
  Object.entries(exitCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    const statusUpper = status.toUpperCase();
    const drops = statusUpper.includes('VOLUNTARY') || statusUpper.includes('CANCEL');
    console.log(`  ${drops ? '❌' : '⚠️ '} ${status}: ${count} ${drops ? '(triggers DROP)' : ''}`);
  });
}

if (Object.keys(termCounts).length > 0) {
  console.log(`\n📋 Term_Status (non-blank only):`);
  Object.entries(termCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    const statusUpper = status.toUpperCase();
    const drops = statusUpper.includes('VOLUNTARY') || statusUpper.includes('CANCEL');
    console.log(`  ${drops ? '❌' : '⚠️ '} ${status}: ${count} ${drops ? '(triggers DROP)' : ''}`);
  });
}

console.log(`\n${'='.repeat(70)}`);
console.log('🎯 FILTER SUMMARY');
console.log('='.repeat(70));
console.log(`  ✅ KEEP: ${keepCount} rows`);
console.log(`  ❌ DROP: ${dropCount} rows`);
console.log(`  📊 Total: ${rows.length}`);

console.log(`\n📊 COMPARISON TO EXPECTED:`);
console.log(`  Expected total: 95`);
console.log(`  Actual total: ${rows.length}`);
console.log(`  Match: ${rows.length === 95 ? '✅ YES' : '❌ NO'}`);
console.log();
console.log(`  Expected keep: 63`);
console.log(`  Actual keep: ${keepCount}`);
console.log(`  Match: ${keepCount === 63 ? '✅ YES' : `❌ NO (diff: ${keepCount - 63})`}`);
console.log();
console.log(`  Expected drop: 32`);
console.log(`  Actual drop: ${dropCount}`);
console.log(`  Match: ${dropCount === 32 ? '✅ YES' : `❌ NO (diff: ${dropCount - 32})`}`);

if (rows.length === 95 && keepCount === 63 && dropCount === 32) {
  console.log(`\n🎉 PERFECT MATCH! Aetna 3-column logic confirmed! 🎉`);
}

console.log('\n✅ TEST COMPLETE\n');

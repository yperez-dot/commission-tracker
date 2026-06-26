// Test Aetna production file with new schema
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
  // Aetna has three status columns
  const enrollStatus = (row.Enroll_Status || '').trim().toUpperCase();
  const exitStatus = (row.Exit_Status || '').trim().toUpperCase();
  const termStatus = (row.Term_Status || '').trim().toUpperCase();
  
  // Drop if Enroll_Status is Cancel
  if (enrollStatus.includes('CANCEL')) return false;
  
  // Also check Exit_Status and Term_Status for Voluntary/Cancel
  if (exitStatus.includes('VOLUNTARY') || exitStatus.includes('CANCEL')) return false;
  if (termStatus.includes('VOLUNTARY') || termStatus.includes('CANCEL')) return false;
  
  return true;
}

console.log('='.repeat(70));
console.log('AETNA PRODUCTION FILE - NEW SCHEMA TEST');
console.log('='.repeat(70));

const filename = '/home/medicare-ai-agent/.openclaw/media/inbound/Aetna_Production_01.26.26_-_Brokers_Society_Alba_Hernandez---fab2b125-4f02-4804-ba46-8b9f582efd68.xlsx';

const workbook = XLSX.readFile(filename);
const sheetName = workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

console.log(`\n📊 Total rows: ${rows.length}`);

console.log(`\n📋 First 15 columns:`);
Object.keys(rows[0]).slice(0, 15).forEach(col => console.log(`  - ${col}`));

// Test MBI extraction
let mbiExtracted = 0;
let affinityIdExtracted = 0;

// Status tracking
const enrollStatusCounts = {};
const exitStatusCounts = {};
const termStatusCounts = {};
let activeCount = 0;
let inactiveCount = 0;

rows.forEach(row => {
  // Extract MBI (MEDICARE_NUMBER column)
  const mbi = validateMBI(row.MEDICARE_NUMBER);
  if (mbi) mbiExtracted++;
  
  // Extract Affinitypolicyid
  if (row.Affinitypolicyid) affinityIdExtracted++;
  
  // Status tracking
  const enroll = String(row.Enroll_Status || '').trim();
  const exit = String(row.Exit_Status || '').trim();
  const term = String(row.Term_Status || '').trim();
  
  enrollStatusCounts[enroll] = (enrollStatusCounts[enroll] || 0) + 1;
  if (exit) exitStatusCounts[exit] = (exitStatusCounts[exit] || 0) + 1;
  if (term) termStatusCounts[term] = (termStatusCounts[term] || 0) + 1;
  
  if (isActivePolicy(row)) {
    activeCount++;
  } else {
    inactiveCount++;
  }
});

const mbiRate = ((mbiExtracted / rows.length) * 100).toFixed(1);
const affinityRate = ((affinityIdExtracted / rows.length) * 100).toFixed(1);

console.log(`\n✅ MBI Extraction (MEDICARE_NUMBER column):`);
console.log(`  Extracted: ${mbiExtracted}/${rows.length} (${mbiRate}%)`);

console.log(`\n🆔 Affinitypolicyid Extraction:`);
console.log(`  Extracted: ${affinityIdExtracted}/${rows.length} (${affinityRate}%)`);

console.log(`\n📋 Enroll_Status Breakdown:`);
Object.entries(enrollStatusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
  const icon = status.toUpperCase().includes('CANCEL') ? '❌' : '✅';
  const tag = status.toUpperCase().includes('CANCEL') ? '(FILTERED OUT)' : '(INCLUDED)';
  console.log(`  ${icon} ${status || '(blank)'}: ${count} ${tag}`);
});

if (Object.keys(exitStatusCounts).length > 0) {
  console.log(`\n📋 Exit_Status Breakdown:`);
  Object.entries(exitStatusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    const icon = status.toUpperCase().includes('VOLUNTARY') || status.toUpperCase().includes('CANCEL') ? '❌' : '✅';
    console.log(`  ${icon} ${status}: ${count}`);
  });
}

if (Object.keys(termStatusCounts).length > 0) {
  console.log(`\n📋 Term_Status Breakdown:`);
  Object.entries(termStatusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    const icon = status.toUpperCase().includes('VOLUNTARY') || status.toUpperCase().includes('CANCEL') ? '❌' : '✅';
    console.log(`  ${icon} ${status}: ${count}`);
  });
}

console.log(`\n🎯 Filter Summary:`);
console.log(`  ✅ Would INCLUDE: ${activeCount} rows`);
console.log(`  ❌ Would FILTER OUT: ${inactiveCount} rows`);
console.log(`  📊 Total: ${rows.length}`);

console.log('\n✅ TEST COMPLETE\n');

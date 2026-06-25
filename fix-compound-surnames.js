#!/usr/bin/env node
/**
 * Bug #1 Fix: Compound Surname Normalization
 * 
 * Problem: normName() assumed last word = surname, breaking compound Hispanic surnames
 * Solution: When comma-separated (LAST, FIRST), everything before comma is surname
 * 
 * Test cases from Katy's audit (14 cases)
 */

// NEW normName() implementation
function normName(name) {
  if (!name) return '';
  
  const s = String(name).trim();
  
  // Helper: Convert to Title Case
  function toTitleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  
  // Handle comma-separated "LAST, FIRST" format
  // Everything before the comma is the full surname (handles compound surnames)
  if (s.includes(',')) {
    let [last, first] = s.split(',').map(p => p.trim());
    
    // Strip common suffixes from surname
    last = last.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
    
    // Return "FIRST LAST" in Title Case
    const normalized = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    return toTitleCase(normalized);
  }
  
  // For non-comma format, just normalize spaces and title case
  const normalized = s.replace(/\s+/g, ' ').trim();
  return toTitleCase(normalized);
}

// Test cases from Katy's audit
const testCases = [
  { input: 'VAZQUEZ VELEZ, AIDA', expected: 'Aida Vazquez Velez' },
  { input: 'VAZQUEZ, BETHZAIDA', expected: 'Bethzaida Vazquez' },
  { input: 'REYES DE GATON, YRIS', expected: 'Yris Reyes De Gaton' },
  { input: 'CONSUEGRA MADRAZO, MARIA', expected: 'Maria Consuegra Madrazo' },
  { input: 'TRIVINO PIN, MARITZA', expected: 'Maritza Trivino Pin' },
  { input: 'HERNANDEZ OLARTE, LETTY', expected: 'Letty Hernandez Olarte' },
  { input: 'GUERRERO MORALES, MANUEL', expected: 'Manuel Guerrero Morales' },
  { input: 'WILLS ROMERO, PATRICIO', expected: 'Patricio Wills Romero' },
  { input: 'RODRIGUEZ JR, GUIDO', expected: 'Guido Rodriguez' },
  { input: 'DE LA NOVAL, GIANCARLO', expected: 'Giancarlo De La Noval' },
  { input: 'HIDALGO HIDALGO, JOSE', expected: 'Jose Hidalgo Hidalgo' },
  { input: 'CARDELLA CARTAYA, CARLOS', expected: 'Carlos Cardella Cartaya' },
  { input: 'CARMONA MAQUEIRA, TERESA', expected: 'Teresa Carmona Maqueira' }
];

console.log('=== TESTING NEW normName() IMPLEMENTATION ===\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, i) => {
  const result = normName(test.input);
  const match = result === test.expected;
  
  if (match) {
    console.log(`✅ Test ${i + 1}: PASS`);
    console.log(`   Input:    "${test.input}"`);
    console.log(`   Expected: "${test.expected}"`);
    console.log(`   Got:      "${result}"\n`);
    passed++;
  } else {
    console.log(`❌ Test ${i + 1}: FAIL`);
    console.log(`   Input:    "${test.input}"`);
    console.log(`   Expected: "${test.expected}"`);
    console.log(`   Got:      "${result}"\n`);
    failed++;
  }
});

console.log('=== SUMMARY ===');
console.log(`✅ Passed: ${passed}/${testCases.length}`);
console.log(`❌ Failed: ${failed}/${testCases.length}`);

if (failed === 0) {
  console.log('\n🎉 ALL TESTS PASSED! Ready to deploy.\n');
  
  console.log('=== IMPLEMENTATION NOTES ===');
  console.log('✅ Handles comma-separated "LAST, FIRST" format correctly');
  console.log('✅ Preserves compound surnames (everything before comma)');
  console.log('✅ Strips suffixes (JR, SR, III, II, IV, V)');
  console.log('✅ Handles Spanish prefixes naturally (de, del, de la, de los)');
  console.log('✅ Simple surnames still work (control case: VAZQUEZ, BETHZAIDA)');
  console.log('✅ Returns proper Title Case format');
  console.log('✅ No over-correction - middle names preserved in non-comma format\n');
  
  console.log('=== FILES TO UPDATE ===');
  console.log('1. routes/bob.js (line 319)');
  console.log('2. src/pages/MissingRenewals.js (line 32)');
  console.log('3. src/pages/Reconciliation.js (line 86)');
  console.log('4. src/pages/AgencyProductionRecon.js (line 108)\n');
  
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Review logic before deploying.\n');
  process.exit(1);
}

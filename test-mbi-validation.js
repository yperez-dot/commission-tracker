// Test MBI validation logic

function validateMBI(value) {
  if (!value) return null;
  const cleaned = String(value).trim().toUpperCase();
  if (cleaned.length !== 11) return null;
  // CMS MBI pattern: #A[#A]AA#A[#A]##
  const mbiPattern = /^[1-9][A-Z][0-9A-Z][0-9][A-Z]{2}[0-9][A-Z][0-9A-Z][0-9]{2}$/;
  if (!mbiPattern.test(cleaned)) return null;
  return cleaned;
}

// Test cases (using real CMS MBI format: #A[#A]AA#A[#A]##)
const testCases = [
  { input: '1EG4TE5MK73', expected: '1EG4TE5MK73', desc: 'Valid MBI (real example)' },
  { input: '9ZX8YT7WK55', expected: '9ZX8YT7WK55', desc: 'Valid MBI (different)' },
  { input: '1eg4te5mk73', expected: '1EG4TE5MK73', desc: 'Valid MBI (lowercase -> uppercase)' },
  { input: '  1EG4TE5MK73  ', expected: '1EG4TE5MK73', desc: 'Valid MBI (trimmed)' },
  { input: '1234567890', expected: null, desc: 'Invalid: too short' },
  { input: '1AB2C34D5E67', expected: null, desc: 'Invalid: too long' },
  { input: 'AB12C34D5E6', expected: null, desc: 'Invalid: starts with letter' },
  { input: '1A2BC34D5E6', expected: null, desc: 'Invalid: position 3 is letter' },
  { input: '123456789AB', expected: null, desc: 'Invalid: all wrong pattern' },
  { input: 'H70056676', expected: null, desc: 'Invalid: UMID not MBI' },
  { input: '746W25493', expected: null, desc: 'Invalid: HCID not MBI' },
  { input: null, expected: null, desc: 'Null input' },
  { input: '', expected: null, desc: 'Empty string' },
  { input: undefined, expected: null, desc: 'Undefined input' }
];

console.log('=== MBI Validation Tests ===\n');

let passed = 0;
let failed = 0;

testCases.forEach(({ input, expected, desc }) => {
  const result = validateMBI(input);
  const pass = result === expected;
  
  if (pass) {
    console.log(`✅ PASS: ${desc}`);
    console.log(`   Input: "${input}" → Output: "${result}"\n`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${desc}`);
    console.log(`   Input: "${input}"`);
    console.log(`   Expected: "${expected}"`);
    console.log(`   Got: "${result}"\n`);
    failed++;
  }
});

console.log(`\n=== Results ===`);
console.log(`✅ Passed: ${passed}/${testCases.length}`);
console.log(`❌ Failed: ${failed}/${testCases.length}`);

if (failed === 0) {
  console.log('\n🎉 All tests passed!');
} else {
  console.log('\n⚠️  Some tests failed - review validation logic');
  process.exit(1);
}

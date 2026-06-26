// Test Aetna file parsing
const XLSX = require('xlsx');
const fs = require('fs');

const filename = '/home/medicare-ai-agent/.openclaw/media/inbound/Aetna_Production_01.26.26_-_Brokers_Society_Alba_Hernandez---fab2b125-4f02-4804-ba46-8b9f582efd68.xlsx';

console.log('Testing Aetna file upload...\n');

// Check file exists and size
const stats = fs.statSync(filename);
console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`File exists: ${fs.existsSync(filename)}`);

try {
  console.log('\nAttempting to parse with XLSX...');
  const buffer = fs.readFileSync(filename);
  console.log(`Buffer size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
  
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  console.log(`Sheets: ${workbook.SheetNames.join(', ')}`);
  
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet);
  
  console.log(`Total rows: ${rows.length}`);
  console.log(`First row keys (first 10): ${Object.keys(rows[0]).slice(0, 10).join(', ')}`);
  
  console.log('\n✅ Aetna file parses successfully!');
  console.log(`Row count: ${rows.length}`);
  
} catch (err) {
  console.error('\n❌ PARSE ERROR:', err.message);
  console.error(err.stack);
}

const XLSX = require('xlsx');

const filePath = '/home/medicare-ai-agent/.openclaw/media/inbound/Aetna_Production_03.31.26_-_Brokers_Society_Alba_Hernandez_3---35f915c1-d384-4767-8573-8c87c97aedc9.xlsx';

try {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  console.log('Sheet name:', sheetName);
  console.log('\nColumn headers:');
  
  // Get range
  const range = XLSX.utils.decode_range(sheet['!ref']);
  
  // Read headers (row 1)
  const headers = [];
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    const cell = sheet[cellAddress];
    headers.push(cell ? cell.v : `Column${col}`);
  }
  
  console.log(headers);
  
  // Convert to JSON to see first few rows
  const data = XLSX.utils.sheet_to_json(sheet);
  
  console.log('\nTotal rows:', data.length);
  console.log('\nFirst row:');
  if (data[0]) {
    Object.keys(data[0]).forEach(key => {
      console.log(`  ${key}: ${data[0][key]}`);
    });
  }
  
} catch (err) {
  console.error('Error:', err.message);
}

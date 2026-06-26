#!/bin/bash
# Test each file individually with small Node scripts

echo "======================================================================="
echo "Testing January/Recent Files with STRICT WHITELIST"
echo "======================================================================="

# UHC MA (Jan) - Expected: 424 total, 382 keep / 42 drop
echo ""
echo "1. UHC MA (Jan) - Expected: 424 total, 382 keep / 42 drop"
node << 'EOF'
const XLSX = require('xlsx');
const wb = XLSX.readFile('/home/medicare-ai-agent/.openclaw/media/inbound/UHC_Production_01.26.26_-_Brokers_Society_Alba_Hernandez---3c5270f1-8bc0-4fd1-9ba7-eb169c9e3168.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const keepStatuses = ['ACTIVE', 'ACTIVE POLICY', 'FUTURE ACTIVE POLICY', 'ACCEPTED', 'COMPLETED'];
let keep = 0, drop = 0;
const statuses = {};
rows.forEach(r => {
  const s = String(r.Status || '').trim().toUpperCase();
  statuses[s] = (statuses[s] || 0) + 1;
  if (s && keepStatuses.includes(s)) keep++; else drop++;
});
console.log('Total:', rows.length);
console.log('KEEP:', keep, '(expected 382)');
console.log('DROP:', drop, '(expected 42)');
console.log('Match:', keep === 382 && drop === 42 ? '✅' : '❌');
console.log('Statuses:', Object.keys(statuses).join(', '));
EOF

echo ""
echo "2. HealthSpring (Dec) - Expected: 14 total, 6 keep / 8 drop"
# This will reveal the bug
node << 'EOF'
const XLSX = require('xlsx');
const wb = XLSX.readFile('/home/medicare-ai-agent/.openclaw/media/inbound/CIGNA_HealthSpring_12.11.25_Brokers_Society_Alba_Hernandez---131283e4-47f4-418b-9d32-ac7ed7fcf664.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
console.log('Total rows:', rows.length);
console.log('First 5 columns:', Object.keys(rows[0]).slice(0,5).join(', '));
console.log('Has POLICY_STATUS?', rows[0].hasOwnProperty('POLICY_STATUS'));
const statuses = {};
rows.forEach(r => {
  const s = String(r.POLICY_STATUS || '').trim();
  statuses[s] = (statuses[s] || 0) + 1;
});
console.log('\nPOLICY_STATUS values:');
Object.entries(statuses).forEach(([s,c]) => console.log('  "' + (s || '(BLANK)') + '":', c));
EOF

echo ""
echo "3. Devoted (May) - Expected: 47 total, 19 keep / 28 drop"
node << 'EOF'
const XLSX = require('xlsx');
const wb = XLSX.readFile('/home/medicare-ai-agent/.openclaw/media/inbound/Devoted_Production_05.13.26_Brokers_Society_1---f502fd0c-55aa-429b-bcc1-52aae245ba16.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const keepStatuses = ['ACTIVE', 'ENROLLED'];
const dropStatuses = ['CANCEL', 'DENIED', 'DISENROLL'];
let keep = 0, drop = 0;
rows.forEach(r => {
  const s = String(r.Status || '').trim().toUpperCase();
  let isKeep = false;
  for(const k of keepStatuses) if(s.includes(k)) { isKeep = true; break; }
  if(!isKeep) for(const d of dropStatuses) if(s.includes(d)) { drop++; return; }
  if(isKeep) keep++; else drop++;
});
console.log('Total:', rows.length);
console.log('KEEP:', keep, '(expected 19)');
console.log('DROP:', drop, '(expected 28)');
console.log('Match:', keep === 19 && drop === 28 ? '✅' : '❌');
EOF

echo ""
echo "4. Freedom (May) - Expected: 8 total, 7 keep / 1 drop"
node << 'EOF'
const XLSX = require('xlsx');
const wb = XLSX.readFile('/home/medicare-ai-agent/.openclaw/media/inbound/Freedom_Production_05.12.26_Brokers_Society_Alba_Hernandez_1---6f46d0a3-89af-43ee-a7b1-4921ca4aa71f.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const keepStatuses = ['CMS ACCEPTED'];
let keep = 0, drop = 0;
const statuses = {};
rows.forEach(r => {
  const s = String(r.Status || '').trim().toUpperCase();
  statuses[s] = (statuses[s] || 0) + 1;
  if (s && s.includes('ACCEPTED')) keep++; else drop++;
});
console.log('Total:', rows.length);
console.log('KEEP:', keep, '(expected 7)');
console.log('DROP:', drop, '(expected 1)');
console.log('Match:', keep === 7 && drop === 1 ? '✅' : '❌');
console.log('Statuses:', Object.keys(statuses).join(', '));
EOF

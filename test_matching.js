
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

function normName(name) {
  if (!name) return '';
  const s = String(name).trim();
  
  function toTitleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  
  if (s.includes(',')) {
    let [last, first] = s.split(',').map(p => p.trim());
    last = last.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
    const normalized = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    return toTitleCase(normalized);
  }
  
  const normalized = s.replace(/\s+/g, ' ').trim();
  return toTitleCase(normalized);
}

async function testMatching() {
  try {
    // Get one production record
    const prod = await pool.query(`
      SELECT client_name, carrier 
      FROM agency_production 
      WHERE effective_date >= '2026-01-01' AND effective_date < '2026-02-01'
      LIMIT 1
    `);
    
    const prodName = prod.rows[0].client_name;
    const prodCarrier = prod.rows[0].carrier.toLowerCase();
    const prodNorm = normName(prodName);
    
    console.log(`Production: "${prodName}" | ${prod.rows[0].carrier}`);
    console.log(`Normalized: "${prodNorm}"\n`);
    
    // Try to find a match in commissions
    const comm = await pool.query(`
      SELECT client_full_name, carrier
      FROM commission_records
      WHERE payee IN ('BSI', 'NHP')
      AND payment_period = '202601'
    `);
    
    let found = false;
    for (const row of comm.rows) {
      const commNorm = normName(row.client_full_name);
      const carrierMatch = row.carrier.toLowerCase().includes(prodCarrier) || prodCarrier.includes(row.carrier.toLowerCase());
      
      if (commNorm === prodNorm && carrierMatch) {
        console.log(`✅ MATCH FOUND!`);
        console.log(`   Commission: "${row.client_full_name}" | ${row.carrier}`);
        console.log(`   Normalized: "${commNorm}"`);
        found = true;
        break;
      }
    }
    
    if (!found) {
      console.log(`❌ NO MATCH for "${prodName}" in ${comm.rows.length} commission records`);
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

testMatching();

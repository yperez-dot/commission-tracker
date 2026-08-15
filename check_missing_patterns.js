
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
    
    let suffix = '';
    const suffixMatch = last.match(/\b(JR|SR|III|II|IV|V)\.?$/i);
    if (suffixMatch) {
      suffix = suffixMatch[1].toUpperCase().replace(/\./g, '');
      last = last.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
    }
    
    first = first.replace(/(\s+[A-Z]\.?)+$/i, '').trim();
    
    let normalized = `${first} ${last}`;
    if (suffix) {
      normalized += ` ${suffix}`;
    }
    normalized = normalized.replace(/\s+/g, ' ').trim();
    return toTitleCase(normalized);
  }
  
  const normalized = s.replace(/\s+/g, ' ').trim();
  return toTitleCase(normalized);
}

async function checkMissing() {
  try {
    // Get all production records
    const prod = await pool.query('SELECT client_name, carrier FROM agency_production');
    
    // Get all override records (with source/payee filter)
    const override = await pool.query(`
      SELECT client_full_name, carrier, source, payee 
      FROM commission_records 
      WHERE payee IN ('BSI', 'NHP', 'THE') OR source IN ('BSI', 'NHP')
    `);
    
    console.log(`Production records: ${prod.rows.length}`);
    console.log(`Override records: ${override.rows.length}\n`);
    
    let missingCount = 0;
    const samples = [];
    
    for (const p of prod.rows) {
      const prodNorm = normName(p.client_name);
      const prodCarrier = p.carrier.toLowerCase();
      
      const found = override.rows.some(o => {
        const overrideNorm = normName(o.client_full_name);
        const overrideCarrier = o.carrier.toLowerCase();
        const carrierMatch = prodCarrier.includes(overrideCarrier) || overrideCarrier.includes(prodCarrier);
        return prodNorm === overrideNorm && carrierMatch;
      });
      
      if (!found) {
        missingCount++;
        if (samples.length < 10) {
          samples.push({ client: p.client_name, norm: prodNorm, carrier: p.carrier });
        }
      }
    }
    
    console.log(`Missing matches: ${missingCount}\n`);
    console.log('Sample missing records:');
    samples.forEach((s, i) => {
      console.log(`${i+1}. "${s.client}" → normalized: "${s.norm}" | ${s.carrier}`);
    });
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkMissing();

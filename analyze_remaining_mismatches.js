
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
  
  // FIXED: Strip trailing middle initials
  let normalized = s.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/(\s+[A-Z]\.?)+$/i, '').trim();
  return toTitleCase(normalized);
}

function normalizeCarrier(carrier) {
  if (!carrier) return '';
  const c = carrier.toLowerCase().trim();
  if (c.includes('humana')) return 'humana';
  if (c.includes('aetna')) return 'aetna';
  if (c.includes('uhc') || c.includes('united')) return 'unitedhealthcare';
  if (c.includes('devoted')) return 'devoted';
  if (c.includes('doctors')) return 'doctors';
  if (c.includes('careplus') || c.includes('care plus')) return 'careplus';
  if (c.includes('solis')) return 'solis';
  if (c.includes('healthsun') || c.includes('health sun')) return 'healthsun';
  if (c.includes('oscar')) return 'oscar';
  if (c.includes('molina')) return 'molina';
  if (c.includes('wellcare')) return 'wellcare';
  if (c.includes('freedom')) return 'freedom';
  if (c.includes('anthem')) return 'anthem';
  return c;
}

async function analyzeRemaining() {
  try {
    // Get all production records
    const prod = await pool.query('SELECT client_name, carrier FROM agency_production');
    
    // Get all override records (with CURRENT filter - no source field check since backend hasn't deployed)
    const override = await pool.query(`
      SELECT client_full_name, carrier, payee, source
      FROM commission_records 
      WHERE classification ILIKE '%override%' 
      OR payee IN ('BSI', 'NHP', 'THE')
    `);
    
    console.log(`Production records: ${prod.rows.length}`);
    console.log(`Override records: ${override.rows.length}\n`);
    
    let missingCount = 0;
    const samples = [];
    
    for (const p of prod.rows) {
      const prodNorm = normName(p.client_name);
      const prodCarrier = normalizeCarrier(p.carrier);
      
      const found = override.rows.some(o => {
        const overrideNorm = normName(o.client_full_name);
        const overrideCarrier = normalizeCarrier(o.carrier);
        const carrierMatch = prodCarrier === overrideCarrier || 
                            prodCarrier.includes(overrideCarrier) || 
                            overrideCarrier.includes(prodCarrier);
        return prodNorm === overrideNorm && carrierMatch;
      });
      
      if (!found) {
        missingCount++;
        if (samples.length < 20) {
          // Try to find close matches to see what's wrong
          let closeMatches = [];
          for (const o of override.rows) {
            const overrideNorm = normName(o.client_full_name);
            const overrideCarrier = normalizeCarrier(o.carrier);
            
            // Name matches but not carrier
            if (prodNorm === overrideNorm) {
              closeMatches.push({
                type: 'name_match_carrier_mismatch',
                override: o.client_full_name,
                overrideCarrier: o.carrier,
                prodCarrier: p.carrier
              });
            }
            
            // Carrier matches but not name (partial name match)
            const carrierMatch = prodCarrier === overrideCarrier || 
                                prodCarrier.includes(overrideCarrier) || 
                                overrideCarrier.includes(prodCarrier);
            if (carrierMatch && overrideNorm.includes(prodNorm.split(' ')[0])) {
              closeMatches.push({
                type: 'carrier_match_name_mismatch',
                override: o.client_full_name,
                overrideNorm: overrideNorm,
                prodNorm: prodNorm
              });
            }
          }
          
          samples.push({ 
            client: p.client_name, 
            norm: prodNorm, 
            carrier: p.carrier,
            closeMatches: closeMatches.slice(0, 2)
          });
        }
      }
    }
    
    console.log(`Missing matches: ${missingCount}\n`);
    console.log('Sample missing records (first 20):\n');
    samples.forEach((s, i) => {
      console.log(`${i+1}. "${s.client}" → "${s.norm}" | ${s.carrier}`);
      if (s.closeMatches.length > 0) {
        s.closeMatches.forEach(cm => {
          if (cm.type === 'name_match_carrier_mismatch') {
            console.log(`   ⚠️  NAME MATCH found: "${cm.override}" but carrier mismatch:`);
            console.log(`       Production: ${cm.prodCarrier}, Override: ${cm.overrideCarrier}`);
          } else {
            console.log(`   ⚠️  CARRIER MATCH found: "${cm.override}" → "${cm.overrideNorm}"`);
            console.log(`       vs Production: "${cm.prodNorm}"`);
          }
        });
      }
      console.log('');
    });
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

analyzeRemaining();


if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

function normNameCurrent(name) {
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
  
  // CURRENT: No middle initial stripping for non-comma format
  const normalized = s.replace(/\s+/g, ' ').trim();
  return toTitleCase(normalized);
}

function normNameFixed(name) {
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
  
  // FIXED: Strip trailing middle initials from non-comma format
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
  return c;
}

async function analyzeImpact() {
  try {
    // Get all override records with trailing single-letter pattern (First Last X)
    const overrideQuery = `
      SELECT client_full_name, carrier, payee, source
      FROM commission_records
      WHERE (payee IN ('BSI', 'NHP', 'THE') OR source IN ('BSI', 'NHP'))
      AND client_full_name ~ '\\s+[A-Z]\\.?$'
      AND client_full_name NOT LIKE '%,%'
    `;
    
    const overrides = await pool.query(overrideQuery);
    
    console.log(`\n📊 Override records with trailing single letter (non-comma format): ${overrides.rows.length}\n`);
    
    // Get all production records
    const production = await pool.query('SELECT client_name, carrier FROM agency_production');
    
    let wouldFixCount = 0;
    const samples = [];
    
    for (const override of overrides.rows) {
      const overrideNormCurrent = normNameCurrent(override.client_full_name);
      const overrideNormFixed = normNameFixed(override.client_full_name);
      const overrideCarrier = normalizeCarrier(override.carrier);
      
      // Check if it currently fails to match
      let currentlyMatches = false;
      for (const prod of production.rows) {
        const prodNorm = normNameCurrent(prod.client_name);
        const prodCarrier = normalizeCarrier(prod.carrier);
        const carrierMatch = prodCarrier === overrideCarrier || 
                            prodCarrier.includes(overrideCarrier) || 
                            overrideCarrier.includes(prodCarrier);
        if (prodNorm === overrideNormCurrent && carrierMatch) {
          currentlyMatches = true;
          break;
        }
      }
      
      // Check if it would match with the fix
      let wouldMatchWithFix = false;
      let matchedProdName = null;
      if (!currentlyMatches) {
        for (const prod of production.rows) {
          const prodNorm = normNameFixed(prod.client_name);
          const prodCarrier = normalizeCarrier(prod.carrier);
          const carrierMatch = prodCarrier === overrideCarrier || 
                              prodCarrier.includes(overrideCarrier) || 
                              overrideCarrier.includes(prodCarrier);
          if (prodNorm === overrideNormFixed && carrierMatch) {
            wouldMatchWithFix = true;
            matchedProdName = prod.client_name;
            break;
          }
        }
      }
      
      if (!currentlyMatches && wouldMatchWithFix) {
        wouldFixCount++;
        if (samples.length < 10) {
          samples.push({
            override: override.client_full_name,
            production: matchedProdName,
            carrier: override.carrier,
            currentNorm: overrideNormCurrent,
            fixedNorm: overrideNormFixed
          });
        }
      }
    }
    
    console.log(`✅ Records that would be FIXED by adding middle initial stripping: ${wouldFixCount}\n`);
    
    if (samples.length > 0) {
      console.log('📋 Sample records that would match after fix:\n');
      samples.forEach((s, i) => {
        console.log(`${i+1}. Override: "${s.override}" | ${s.carrier}`);
        console.log(`   Production: "${s.production}"`);
        console.log(`   Current normalization: "${s.currentNorm}" (NO MATCH)`);
        console.log(`   Fixed normalization: "${s.fixedNorm}" (MATCH!)`);
        console.log('');
      });
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total override records with trailing single letter: ${overrides.rows.length}`);
    console.log(`   Would fix Missing matches: ${wouldFixCount}`);
    console.log(`   Current Missing count: ~393`);
    console.log(`   Estimated Missing after fix: ~${393 - wouldFixCount}`);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

analyzeImpact();

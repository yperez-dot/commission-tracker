#!/usr/bin/env node
/**
 * Normalize carrier names in book_of_business table
 * - DOCTORS → Doctors
 * - SOLIS → Solis
 * - etc.
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway',
  ssl: false
});

function formatCarrier(carrier) {
  if (!carrier) return '';
  
  const c = carrier.trim();
  
  // Special cases
  if (c.toUpperCase() === 'DOCTORS' || c.toLowerCase() === 'doctors healthcare plans') return 'Doctors';
  if (c.toUpperCase() === 'SOLIS') return 'Solis';
  if (c.toUpperCase() === 'UHC' || c.toUpperCase() === 'UNITED HEALTHCARE' || c.toUpperCase() === 'UNITEDHEALTHCARE') return 'UnitedHealthcare';
  if (c.toUpperCase() === 'HUMANA') return 'Humana';
  if (c.toUpperCase() === 'AETNA') return 'Aetna';
  if (c.toUpperCase() === 'CAREPLUS' || c.toUpperCase() === 'CARE PLUS') return 'CarePlus';
  if (c.toUpperCase() === 'DEVOTED' || c.toUpperCase() === 'DEVOTED HEALTH') return 'Devoted Health';
  if (c.toUpperCase() === 'WELLCARE') return 'WellCare';
  if (c.toUpperCase() === 'OSCAR' || c.toUpperCase() === 'OSCAR HEALTH') return 'Oscar Health';
  if (c.toUpperCase() === 'CIGNA') return 'Cigna';
  if (c.toUpperCase() === 'MOLINA') return 'Molina';
  if (c.toUpperCase() === 'FLORIDA BLUE') return 'Florida Blue';
  if (c.toUpperCase() === 'SUNSHINE HEALTH') return 'Sunshine Health';
  if (c.includes('AARP') || c.includes('MED SUPP')) return c; // Keep as-is
  
  // Default: Title case
  return c.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

async function normalizeCarriers() {
  try {
    console.log('📊 Fetching all carriers from book_of_business...\n');
    
    const result = await pool.query('SELECT DISTINCT carrier FROM book_of_business ORDER BY carrier');
    const carriers = result.rows.map(r => r.carrier);
    
    console.log(`Found ${carriers.length} unique carrier names:\n`);
    
    let updated = 0;
    
    for (const carrier of carriers) {
      const normalized = formatCarrier(carrier);
      
      if (normalized !== carrier) {
        console.log(`  "${carrier}" → "${normalized}"`);
        
        await pool.query(
          'UPDATE book_of_business SET carrier = $1 WHERE carrier = $2',
          [normalized, carrier]
        );
        
        updated++;
      }
    }
    
    console.log(`\n✅ Updated ${updated} carrier name(s)`);
    
    if (updated === 0) {
      console.log('   All carriers already normalized!');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

normalizeCarriers();

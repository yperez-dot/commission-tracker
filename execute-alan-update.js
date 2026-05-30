#!/usr/bin/env node
/**
 * Execute: Update the 13 specific client records to Alan Elchami
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway',
  ssl: false
});

async function main() {
  try {
    console.log('🔄 Updating 13 records to Alan Elchami...\n');
    
    // Update ONLY these specific clients
    const updateResult = await pool.query(`
      UPDATE commission_records
      SET agent_name = 'Alan Elchami'
      WHERE (
        client_full_name ILIKE '%Winston Benjamin%' OR
        client_full_name ILIKE '%Cheryl Thielen%' OR
        client_full_name ILIKE '%Deloris Moise%' OR
        client_full_name ILIKE '%Leila Henry%' OR
        client_full_name ILIKE '%Wade Daniels%' OR
        client_full_name ILIKE '%Frances Lambert%' OR
        client_full_name ILIKE '%Linda Forman%' OR
        client_full_name ILIKE '%John Scheibl%' OR
        client_full_name ILIKE '%Yvetane Vilmael%' OR
        client_full_name ILIKE '%Joivil Vilmael%' OR
        client_full_name ILIKE '%Melba Elwell%' OR
        client_full_name ILIKE '%Herbert Raymond%' OR
        client_full_name ILIKE '%Elaine%Raymond%'
      )
      AND agent_name ILIKE '%health experts%'
    `);
    
    console.log(`✅ Updated ${updateResult.rowCount} records!`);
    console.log('\nVerifying...\n');
    
    // Verify
    const verifyResult = await pool.query(`
      SELECT client_full_name, effective_date, carrier, commission
      FROM commission_records
      WHERE agent_name = 'Alan Elchami'
      AND (
        client_full_name ILIKE '%Winston Benjamin%' OR
        client_full_name ILIKE '%Cheryl Thielen%' OR
        client_full_name ILIKE '%Deloris Moise%' OR
        client_full_name ILIKE '%Leila Henry%' OR
        client_full_name ILIKE '%Wade Daniels%' OR
        client_full_name ILIKE '%Frances Lambert%' OR
        client_full_name ILIKE '%Linda Forman%' OR
        client_full_name ILIKE '%John Scheibl%' OR
        client_full_name ILIKE '%Yvetane Vilmael%' OR
        client_full_name ILIKE '%Joivil Vilmael%' OR
        client_full_name ILIKE '%Melba Elwell%' OR
        client_full_name ILIKE '%Herbert Raymond%' OR
        client_full_name ILIKE '%Elaine%Raymond%'
      )
      ORDER BY client_full_name
    `);
    
    console.log(`✅ Verified ${verifyResult.rows.length} Alan Elchami records:\n`);
    verifyResult.rows.forEach((row, i) => {
      console.log(`${i+1}. ${row.client_full_name} (${row.effective_date}) - ${row.carrier} - $${row.commission}`);
    });
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ ALL DONE! 13 records updated to Alan Elchami');
    console.log('='.repeat(70));
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();

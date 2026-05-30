#!/usr/bin/env node
/**
 * Update ONLY the 22 specific clients to Alan Elchami
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway',
  ssl: false
});

// The ONLY 22 clients that should be Alan (from Katy's audit)
const clients = [
  "Winston Benjamin", "Barbara Ferring", "Willie Nelson", "Kenneth Nelson",
  "Cheryl Thielen", "Deloris Moise", "Leila Henry", "Wade Daniels",
  "Mary Carman", "Frances Lambert", "Linda Forman", "John Scheibl",
  "Yvetane Vilmael", "Joivil Vilmael", "Maria Guillaume", "Melba Elwell",
  "Herbert Raymond", "Elaine Bertram Raymond", "Beverly Brown",
  "Wendy Chapman", "Inese Jean", "Lynn Jones"
];

async function main() {
  try {
    console.log('🔍 Finding records for the 22 specific clients...\n');
    
    // First, SHOW what we'll update (DRY RUN)
    const searchResult = await pool.query(`
      SELECT id, agent_name, client_full_name, effective_date, carrier, commission
      FROM commission_records
      WHERE (
        client_full_name ILIKE '%Winston Benjamin%' OR
        client_full_name ILIKE '%Barbara Ferring%' OR
        client_full_name ILIKE '%Willie Nelson%' OR
        client_full_name ILIKE '%Kenneth Nelson%' OR
        client_full_name ILIKE '%Cheryl Thielen%' OR
        client_full_name ILIKE '%Deloris Moise%' OR
        client_full_name ILIKE '%Leila Henry%' OR
        client_full_name ILIKE '%Wade Daniels%' OR
        client_full_name ILIKE '%Mary Carman%' OR
        client_full_name ILIKE '%Frances Lambert%' OR
        client_full_name ILIKE '%Linda Forman%' OR
        client_full_name ILIKE '%John Scheibl%' OR
        client_full_name ILIKE '%Yvetane Vilmael%' OR
        client_full_name ILIKE '%Joivil Vilmael%' OR
        client_full_name ILIKE '%Maria Guillaume%' OR
        client_full_name ILIKE '%Melba Elwell%' OR
        client_full_name ILIKE '%Herbert Raymond%' OR
        client_full_name ILIKE '%Elaine%Raymond%' OR
        client_full_name ILIKE '%Beverly Brown%' OR
        client_full_name ILIKE '%Wendy Chapman%' OR
        client_full_name ILIKE '%Inese Jean%' OR
        client_full_name ILIKE '%Lynn Jones%'
      )
      AND agent_name ILIKE '%health experts%'
      ORDER BY client_full_name, effective_date
    `);
    
    console.log(`✅ Found ${searchResult.rows.length} records for these 22 clients\n`);
    
    if (searchResult.rows.length === 0) {
      console.log('⚠️  No records found - they may already be updated or not in the system');
      process.exit(0);
    }
    
    console.log('Records that will be updated:\n');
    searchResult.rows.forEach((row, i) => {
      console.log(`${i+1}. ${row.client_full_name} (${row.effective_date}) - ${row.carrier} - $${row.commission}`);
    });
    
    console.log('\n' + '='.repeat(70));
    console.log(`READY TO UPDATE ${searchResult.rows.length} records to "Alan Elchami"`);
    console.log('='.repeat(70));
    console.log('\n⚠️  WAITING FOR APPROVAL - NOT EXECUTING YET');
    console.log('Review the list above first!');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();

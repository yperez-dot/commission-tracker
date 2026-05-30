#!/usr/bin/env node
/**
 * Update "Health Experts" sales to "Alan Elchami" in commission_records
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway',
  ssl: false
});

const clients22 = [
  "Winston Benjamin", "Barbara Ferring", "Willie Nelson", "Kenneth Nelson",
  "Cheryl Thielen", "Deloris Moise", "Leila Henry", "Wade Daniels",
  "Mary Carman", "Frances Lambert", "Linda Forman", "John Scheibl",
  "Yvetane Vilmael", "Joivil Vilmael", "Maria Guillaume", "Melba Elwell",
  "Herbert Raymond", "Elaine Bertram Raymond", "Beverly Brown",
  "Wendy Chapman", "Inese Jean", "Lynn Jones"
];

async function main() {
  try {
    console.log('🔍 Searching for "Health Experts" commission records...\n');
    
    // Search for Health Experts records
    const searchResult = await pool.query(`
      SELECT id, agent_name, client_full_name, effective_date, carrier, commission, classification
      FROM commission_records
      WHERE agent_name ILIKE '%health experts%'
      ORDER BY client_full_name, effective_date
    `);
    
    console.log(`✅ Found ${searchResult.rows.length} records with agent = "Health Experts"\n`);
    
    if (searchResult.rows.length === 0) {
      console.log('⚠️  No "Health Experts" records found - they may already be updated!');
      process.exit(0);
    }
    
    // Show all records
    console.log('Records to update:\n');
    searchResult.rows.forEach((row, i) => {
      const isInList = clients22.some(c => row.client_full_name.includes(c));
      const marker = isInList ? '📍' : '  ';
      console.log(`${marker} ${i+1}. ${row.client_full_name} (${row.effective_date}) - ${row.carrier} - $${row.commission}`);
    });
    
    console.log('\n' + '='.repeat(70));
    console.log(`Ready to update ${searchResult.rows.length} records to "Alan Elchami"`);
    console.log('='.repeat(70) + '\n');
    
    // UPDATE query
    const updateResult = await pool.query(`
      UPDATE commission_records
      SET agent_name = 'Alan Elchami'
      WHERE agent_name ILIKE '%health experts%'
    `);
    
    console.log(`✅ Updated ${updateResult.rowCount} records!`);
    console.log('\nVerifying...\n');
    
    // Verify
    const verifyResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM commission_records
      WHERE agent_name = 'Alan Elchami'
    `);
    
    console.log(`✅ Total Alan Elchami records: ${verifyResult.rows[0].count}`);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();

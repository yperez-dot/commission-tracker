#!/usr/bin/env node
/**
 * UNDO: Change Alan Elchami back to Health Experts (except the 22 specific ones)
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway',
  ssl: false
});

// The ONLY 22 clients that should be Alan
const alan22 = [
  "Winston Benjamin", "Barbara Ferring", "Willie Nelson", "Kenneth Nelson",
  "Cheryl Thielen", "Deloris Moise", "Leila Henry", "Wade Daniels",
  "Mary Carman", "Frances Lambert", "Linda Forman", "John Scheibl",
  "Yvetane Vilmael", "Joivil Vilmael", "Maria Guillaume", "Melba Elwell",
  "Herbert Raymond", "Elaine Bertram Raymond", "Beverly Brown",
  "Wendy Chapman", "Inese Jean", "Lynn Jones"
];

async function main() {
  try {
    console.log('🔄 REVERSING the incorrect update...\n');
    
    // Change back to "Health Experts" EXCEPT for the 22 specific clients
    const updateResult = await pool.query(`
      UPDATE commission_records
      SET agent_name = 'Health Experts'
      WHERE agent_name = 'Alan Elchami'
      AND client_full_name NOT LIKE ANY($1)
    `, [alan22.map(name => `%${name}%`)]);
    
    console.log(`✅ Reverted ${updateResult.rowCount} records back to "Health Experts"`);
    
    // Verify the 22 are still Alan
    const verifyAlan = await pool.query(`
      SELECT client_full_name, effective_date, carrier
      FROM commission_records
      WHERE agent_name = 'Alan Elchami'
      AND client_full_name LIKE ANY($1)
      ORDER BY client_full_name
    `, [alan22.map(name => `%${name}%`)]);
    
    console.log(`\n✅ These ${verifyAlan.rows.length} records are correctly assigned to Alan:\n`);
    verifyAlan.rows.forEach((row, i) => {
      console.log(`${i+1}. ${row.client_full_name} (${row.effective_date}) - ${row.carrier}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();

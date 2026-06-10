require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    console.log('Fixing May 30th NHP upload periods...\n');
    
    // Check what we have before
    const before = await pool.query(`
      SELECT payment_period, COUNT(*) as count
      FROM commission_records
      WHERE source = 'NHP' AND payment_period = 'Unknown'
      GROUP BY payment_period
    `);
    console.log('Records with period = Unknown:', before.rows);
    
    // Run the fix
    const sql = fs.readFileSync('./fix-may30-periods.sql', 'utf8');
    await pool.query(sql);
    
    console.log('\n✅ Fix complete!\n');
    
    // Show results
    const after = await pool.query(`
      SELECT 
        payment_period,
        COUNT(*) as record_count,
        SUM(CASE WHEN lob = 'ACA' AND producer_payable > 0 THEN producer_payable ELSE 0 END) as aca_agent_payable
      FROM commission_records
      WHERE source = 'NHP'
      GROUP BY payment_period
      ORDER BY payment_period DESC
      LIMIT 10
    `);
    
    console.log('NHP Records by Period:');
    console.table(after.rows);
    
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await pool.end();
    process.exit(1);
  }
})();

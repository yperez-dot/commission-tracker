const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway'
});

async function deleteAprilRecords() {
  try {
    const result = await pool.query(`
      DELETE FROM commission_records 
      WHERE source = 'direct_carrier' 
      AND payment_period IN ('202601','202602','202603','202604','202605')
    `);
    console.log(`✅ Deleted ${result.rowCount} records from April statement periods`);
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

deleteAprilRecords();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway'
});

async function checkSchema() {
  try {
    const schema = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'agency_production'
      ORDER BY ordinal_position
    `);
    
    console.log('agency_production columns:');
    schema.rows.forEach(r => {
      console.log(`  - ${r.column_name}: ${r.data_type}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkSchema();

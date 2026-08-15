
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkNameFormats() {
  try {
    const prod = await pool.query('SELECT client_name, carrier FROM agency_production WHERE effective_date >= \'2026-01-01\' AND effective_date < \'2026-02-01\' LIMIT 10');
    const comm = await pool.query('SELECT client_full_name, carrier FROM commission_records WHERE payee IN (\'BSI\', \'NHP\') AND payment_period = \'202601\' LIMIT 10');
    
    console.log('PRODUCTION names (Jan 2026):');
    prod.rows.forEach(r => console.log(`  "${r.client_name}" | ${r.carrier}`));
    
    console.log('\nCOMMISSION names (Jan 2026):');
    comm.rows.forEach(r => console.log(`  "${r.client_full_name}" | ${r.carrier}`));
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkNameFormats();

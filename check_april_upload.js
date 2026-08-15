
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkAprilUpload() {
  try {
    // Get the most recent upload
    const upload = await pool.query(`
      SELECT id, original_name, uploaded_at
      FROM uploads
      ORDER BY uploaded_at DESC
      LIMIT 1
    `);
    
    console.log('Latest upload:', upload.rows[0]);
    
    // Get records from that upload
    const records = await pool.query(`
      SELECT agent_name, carrier, policy_number, client_full_name, 
             effective_date, commission, classification, payment_period
      FROM commission_records
      WHERE upload_id = $1
      ORDER BY id DESC
    `, [upload.rows[0].id]);
    
    console.log('\nRecords imported:');
    records.rows.forEach(r => {
      console.log(`- ${r.agent_name} | ${r.carrier} | Policy: ${r.policy_number} | Client: ${r.client_full_name} | $${r.commission}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkAprilUpload();

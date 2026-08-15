
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkLatestUpload() {
  try {
    // Get the most recent upload
    const upload = await pool.query(`
      SELECT id, original_name, uploaded_at
      FROM uploads
      ORDER BY uploaded_at DESC
      LIMIT 1
    `);
    
    console.log('Latest upload:', upload.rows[0]);
    
    // Get sample records
    const records = await pool.query(`
      SELECT agent_name, carrier, policy_number, client_full_name, 
             effective_date, commission, classification
      FROM commission_records
      WHERE upload_id = $1
      ORDER BY id
      LIMIT 10
    `, [upload.rows[0].id]);
    
    console.log('\nFirst 10 records:');
    records.rows.forEach(r => {
      console.log(`- Policy: ${r.policy_number} | Client: ${r.client_full_name} | $${r.commission}`);
    });
    
    // Check for Guido specifically
    const guido = await pool.query(`
      SELECT policy_number, client_full_name, agent_name, commission
      FROM commission_records
      WHERE upload_id = $1 AND policy_number LIKE '%929779560%'
    `, [upload.rows[0].id]);
    
    if (guido.rows.length > 0) {
      console.log('\n✅ Guido Rodriguez Jr record:');
      console.log('   Policy:', guido.rows[0].policy_number);
      console.log('   Client:', guido.rows[0].client_full_name);
      console.log('   Agent:', guido.rows[0].agent_name);
      console.log('   Amount:', guido.rows[0].commission);
    } else {
      console.log('\n❌ Guido Rodriguez Jr NOT FOUND');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkLatestUpload();

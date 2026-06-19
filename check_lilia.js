const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function check() {
  try {
    // Check BOB
    const bob = await pool.query(`
      SELECT client_full_name, carrier, agent_name 
      FROM book_of_business 
      WHERE LOWER(client_full_name) LIKE '%lilia%' 
        AND LOWER(client_full_name) LIKE '%torres%'
    `);
    
    console.log('=== BOB Records ===');
    bob.rows.forEach(r => {
      console.log('Client:', JSON.stringify(r.client_full_name));
      console.log('Carrier:', JSON.stringify(r.carrier));
      console.log('Agent:', JSON.stringify(r.agent_name));
      console.log('');
    });
    
    // Check commission_records
    const records = await pool.query(`
      SELECT client_full_name, carrier, agent_name, payment_period, commission
      FROM commission_records 
      WHERE LOWER(client_full_name) LIKE '%lilia%' 
        AND LOWER(client_full_name) LIKE '%torres%'
        AND payment_period = '202603'
    `);
    
    console.log('=== Commission Records (202603) ===');
    records.rows.forEach(r => {
      console.log('Client:', JSON.stringify(r.client_full_name));
      console.log('Carrier:', JSON.stringify(r.carrier));
      console.log('Agent:', JSON.stringify(r.agent_name));
      console.log('Period:', r.payment_period);
      console.log('Commission:', r.commission);
      console.log('');
    });
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

check();

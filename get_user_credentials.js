const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway'
});

async function getUsers() {
  try {
    const result = await pool.query(`
      SELECT id, email, role, name 
      FROM users 
      ORDER BY id 
      LIMIT 5
    `);
    console.log('Users in database:');
    result.rows.forEach(user => {
      console.log(`- ${user.email} (${user.role}) - ${user.name}`);
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

getUsers();

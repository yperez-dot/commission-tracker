
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
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

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway'
});

async function resetPassword() {
  try {
    const testPassword = 'TestPassword123!';
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    
    const result = await pool.query(`
      UPDATE users 
      SET password = $1 
      WHERE email = 'yperez@healthexps.com'
      RETURNING email
    `, [hashedPassword]);
    
    console.log(`✅ Password reset for: ${result.rows[0].email}`);
    console.log(`   Email: yperez@healthexps.com`);
    console.log(`   Password: ${testPassword}`);
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

resetPassword();

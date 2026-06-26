const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway'
});

async function verifyFix() {
  try {
    // Get latest upload
    const upload = await pool.query(`
      SELECT id, original_name
      FROM uploads
      ORDER BY uploaded_at DESC
      LIMIT 1
    `);
    
    console.log(`Checking upload: ${upload.rows[0].original_name}\n`);
    
    // Check for Guido
    const guido = await pool.query(`
      SELECT policy_number, client_full_name, agent_name
      FROM commission_records
      WHERE upload_id = $1 AND policy_number LIKE '%929779560%'
    `, [upload.rows[0].id]);
    
    if (guido.rows.length > 0) {
      const g = guido.rows[0];
      const isClean = g.policy_number === '929779560' && !g.policy_number.includes('RODRIGUEZ');
      console.log('✅ Guido Rodriguez Jr:');
      console.log(`   Policy: ${g.policy_number} ${isClean ? '✅ CLEAN' : '❌ STILL BROKEN'}`);
      console.log(`   Client: ${g.client_full_name}`);
      console.log(`   Agent: ${g.agent_name}\n`);
    }
    
    // Check for any remaining name-bleed issues (policy numbers with letters at the end)
    const nameBleed = await pool.query(`
      SELECT policy_number, client_full_name, agent_name, carrier
      FROM commission_records
      WHERE upload_id = $1 
      AND policy_number ~ '[0-9]{6,}[A-Z]{2,}'
      LIMIT 10
    `, [upload.rows[0].id]);
    
    if (nameBleed.rows.length > 0) {
      console.log('⚠️  Found potential name-bleed issues:');
      nameBleed.rows.forEach(r => {
        console.log(`   - Policy: ${r.policy_number} | Client: ${r.client_full_name}`);
      });
    } else {
      console.log('✅ NO name-bleed issues found! All policy numbers are clean.');
    }
    
    // Sample of clean records
    const sample = await pool.query(`
      SELECT policy_number, client_full_name, carrier, commission
      FROM commission_records
      WHERE upload_id = $1
      ORDER BY id
      LIMIT 10
    `, [upload.rows[0].id]);
    
    console.log('\nSample records:');
    sample.rows.forEach(r => {
      console.log(`   ${r.policy_number} | ${r.client_full_name} | ${r.carrier} | $${r.commission}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

verifyFix();


if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkClassifications() {
  try {
    // Check BSI consolidated records (source = direct_carrier, payee = BSI)
    const bsiClassifications = await pool.query(`
      SELECT classification, COUNT(*) as count
      FROM commission_records
      WHERE source = 'direct_carrier' AND payee = 'BSI'
      GROUP BY classification
      ORDER BY count DESC
    `);
    
    console.log('BSI Consolidated (source=direct_carrier, payee=BSI) classifications:');
    bsiClassifications.rows.forEach(r => {
      console.log(`  - "${r.classification}": ${r.count}`);
    });
    
    // Check source=BSI records
    const sourceBSI = await pool.query(`
      SELECT classification, payee, COUNT(*) as count
      FROM commission_records
      WHERE source = 'BSI'
      GROUP BY classification, payee
      ORDER BY count DESC
    `);
    
    console.log('\nSource=BSI records (by classification + payee):');
    sourceBSI.rows.forEach(r => {
      console.log(`  - "${r.classification}" (payee: ${r.payee}): ${r.count}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkClassifications();

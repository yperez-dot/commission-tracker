
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

async function fixAgentNames() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  
  try {
    console.log('🔧 Connecting to OliComm database...\n');
    
    // Check current duplicates
    console.log('📊 BEFORE FIX:\n');
    const before = await pool.query(`
      SELECT agent_name, COUNT(*) as records, SUM(commission) as total 
      FROM commission_records 
      WHERE agent_name LIKE '%Yahoska%' OR agent_name LIKE '%Katy%'
      GROUP BY agent_name 
      ORDER BY agent_name
    `);
    before.rows.forEach(r => {
      console.log(`   ${r.agent_name}: ${r.records} records, $${parseFloat(r.total || 0).toFixed(2)}`);
    });
    
    // Fix Yahoska
    console.log('\n🔄 Fixing Yahoska G Perez → Yahoska Perez...');
    const yahoska = await pool.query(`
      UPDATE commission_records 
      SET agent_name = 'Yahoska Perez' 
      WHERE agent_name = 'Yahoska G Perez'
    `);
    console.log(`   ✅ Updated ${yahoska.rowCount} records`);
    
    // Fix Katy
    console.log('\n🔄 Fixing Katy Jullie Robles → Katy Robles...');
    const katy = await pool.query(`
      UPDATE commission_records 
      SET agent_name = 'Katy Robles' 
      WHERE agent_name = 'Katy Jullie Robles'
    `);
    console.log(`   ✅ Updated ${katy.rowCount} records`);
    
    // Show results
    console.log('\n📊 AFTER FIX:\n');
    const after = await pool.query(`
      SELECT agent_name, COUNT(*) as records, SUM(commission) as total 
      FROM commission_records 
      WHERE agent_name LIKE '%Yahoska%' OR agent_name LIKE '%Katy%'
      GROUP BY agent_name 
      ORDER BY total DESC
    `);
    after.rows.forEach(r => {
      console.log(`   ${r.agent_name}: ${r.records} records, $${parseFloat(r.total || 0).toFixed(2)}`);
    });
    
    console.log('\n🎉 DONE! Agent names fixed!\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

fixAgentNames();

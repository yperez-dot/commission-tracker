const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway'
});

async function runMigration() {
  try {
    console.log('Running migration 006_bsi_audit_phase1_foundation.sql...');
    
    const sql = fs.readFileSync('./migrations/006_bsi_audit_phase1_foundation.sql', 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Migration completed successfully!');
    
    // Verify tables were created
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('policy_mbi_crosswalk', 'bsi_carrier_statement_uploads', 'bsi_carrier_statement_records')
      ORDER BY table_name
    `);
    
    console.log('\n📊 New tables created:');
    result.rows.forEach(row => console.log(`  - ${row.table_name}`));
    
    // Check new columns on agency_production
    const cols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'agency_production' 
        AND column_name IN ('mbi', 'carrier_member_id', 'policy_number_production')
      ORDER BY column_name
    `);
    
    console.log('\n📝 New columns on agency_production:');
    cols.rows.forEach(row => console.log(`  - ${row.column_name} (${row.data_type})`));
    
    // Check statement_coverage view
    const views = await pool.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public' 
        AND table_name = 'statement_coverage'
    `);
    
    if (views.rows.length > 0) {
      console.log('\n👁️  View created: statement_coverage');
    }
    
    await pool.end();
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();

const { Pool } = require('pg');

// Railway PostgreSQL connection
const pool = new Pool({
  host: 'metro.proxy.rlwy.net',
  port: 24676,
  database: 'railway',
  user: 'postgres',
  password: 'bQWjONLUdLHPCAKBZTZXPNNqjAUQEjbQ',
  ssl: { rejectUnauthorized: false }
});

async function checkImport() {
  try {
    const uploads = await pool.query(`
      SELECT id, original_name, uploaded_at, row_count
      FROM uploads 
      WHERE original_name LIKE '%EXPERST%' OR original_name LIKE '%NHP%'
      ORDER BY uploaded_at DESC 
      LIMIT 1
    `);
    
    if (uploads.rows.length === 0) {
      console.log('No NHP uploads found');
      return;
    }
    
    const uploadId = uploads.rows[0].id;
    console.log(`\n📊 Latest NHP Upload:`);
    console.log(`   File: ${uploads.rows[0].original_name}`);
    console.log(`   Rows: ${uploads.rows[0].row_count}`);
    console.log(`   Date: ${uploads.rows[0].uploaded_at}\n`);
    
    // Check ACA records
    console.log(`\n✅ ACA RECORDS (Eduardo Pernia Florida Blue):`);
    const acaRecords = await pool.query(`
      SELECT agent_name, carrier, client_full_name, classification, 
             gross_commission, thei_share, bsi_share, producer_payable, lob
      FROM commission_records
      WHERE upload_id = $1 
        AND agent_name ILIKE '%eduardo%'
        AND carrier ILIKE '%florida%'
      LIMIT 5
    `, [uploadId]);
    
    acaRecords.rows.forEach((r) => {
      console.log(`\n  Client: ${r.client_full_name}`);
      console.log(`  Classification: ${r.classification}`);
      console.log(`  LOB: ${r.lob || 'NULL'}`);
      console.log(`  Gross: $${r.gross_commission || 0}`);
      console.log(`  THEI Share: $${r.thei_share || 0}`);
      console.log(`  BSI Share: $${r.bsi_share || 0}`);
      console.log(`  Producer Payable: $${r.producer_payable || 0}`);
    });
    
    // Check Christian Munoz Doctors
    console.log(`\n\n✅ CHRISTIAN MUNOZ DOCTORS:`);
    const christian = await pool.query(`
      SELECT agent_name, client_full_name, classification, effective_date,
             gross_commission, thei_share, bsi_share, producer_payable, 
             sub_agent_override, lob
      FROM commission_records
      WHERE upload_id = $1 
        AND agent_name ILIKE '%christian%'
        AND carrier ILIKE '%doctor%'
      LIMIT 2
    `, [uploadId]);
    
    christian.rows.forEach((r) => {
      console.log(`\n  Client: ${r.client_full_name}`);
      console.log(`  Classification: ${r.classification}`);
      console.log(`  Effective: ${r.effective_date}`);
      console.log(`  Gross: $${r.gross_commission || 0}`);
      console.log(`  Sub-Agent Override: $${r.sub_agent_override || 0} ⭐`);
      console.log(`  THEI Share: $${r.thei_share || 0}`);
      console.log(`  BSI Share: $${r.bsi_share || 0}`);
    });
    
    // BSI split check
    console.log(`\n\n✅ BSI SPLIT (Medicare post-9/1/2025):`);
    const bsi = await pool.query(`
      SELECT agent_name, effective_date, gross_commission, thei_share, bsi_share, split_applies
      FROM commission_records
      WHERE upload_id = $1 
        AND effective_date >= '2025-09-01'
        AND lob = 'MA'
      LIMIT 3
    `, [uploadId]);
    
    bsi.rows.forEach((r) => {
      console.log(`\n  Agent: ${r.agent_name}`);
      console.log(`  Effective: ${r.effective_date}`);
      console.log(`  Gross: $${r.gross_commission || 0}`);
      console.log(`  THEI: $${r.thei_share || 0} | BSI: $${r.bsi_share || 0}`);
      console.log(`  Split Applied: ${r.split_applies}`);
    });
    
    await pool.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkImport();

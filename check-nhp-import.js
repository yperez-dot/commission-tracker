const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkImport() {
  try {
    // Get the most recent upload
    const uploads = await pool.query(`
      SELECT id, original_name, uploaded_at 
      FROM uploads 
      WHERE original_name LIKE '%NHP%' OR original_name LIKE '%HEALTH_EXPERST%'
      ORDER BY uploaded_at DESC 
      LIMIT 1
    `);
    
    if (uploads.rows.length === 0) {
      console.log('No NHP uploads found');
      return;
    }
    
    const uploadId = uploads.rows[0].id;
    console.log(`\n=== Latest NHP Upload ===`);
    console.log(`Upload ID: ${uploadId}`);
    console.log(`File: ${uploads.rows[0].original_name}`);
    console.log(`Date: ${uploads.rows[0].uploaded_at}`);
    
    // Check ACA records
    console.log(`\n=== ACA RECORDS (Eduardo Pernia) ===`);
    const acaRecords = await pool.query(`
      SELECT agent_name, carrier, client_full_name, classification, 
             gross_commission, thei_share, bsi_share, producer_payable, 
             sub_agent_override, lob
      FROM commission_records
      WHERE upload_id = $1 
        AND agent_name ILIKE '%eduardo%'
      LIMIT 5
    `, [uploadId]);
    
    acaRecords.rows.forEach((r, i) => {
      console.log(`\nRecord ${i+1}:`);
      console.log(`  Agent: ${r.agent_name}`);
      console.log(`  Carrier: ${r.carrier}`);
      console.log(`  Client: ${r.client_full_name}`);
      console.log(`  Classification: ${r.classification}`);
      console.log(`  LOB: ${r.lob}`);
      console.log(`  Gross: $${r.gross_commission}`);
      console.log(`  THEI Share: $${r.thei_share}`);
      console.log(`  BSI Share: $${r.bsi_share}`);
      console.log(`  Producer Payable: $${r.producer_payable}`);
      console.log(`  Sub-Agent Override: $${r.sub_agent_override}`);
    });
    
    // Check Christian Munoz Doctors record
    console.log(`\n=== CHRISTIAN MUNOZ DOCTORS ===`);
    const christianRecords = await pool.query(`
      SELECT agent_name, carrier, client_full_name, classification, effective_date,
             gross_commission, thei_share, bsi_share, producer_payable, 
             sub_agent_override, lob
      FROM commission_records
      WHERE upload_id = $1 
        AND agent_name ILIKE '%christian%'
        AND carrier ILIKE '%doctor%'
      LIMIT 3
    `, [uploadId]);
    
    christianRecords.rows.forEach((r, i) => {
      console.log(`\nRecord ${i+1}:`);
      console.log(`  Agent: ${r.agent_name}`);
      console.log(`  Carrier: ${r.carrier}`);
      console.log(`  Client: ${r.client_full_name}`);
      console.log(`  Classification: ${r.classification}`);
      console.log(`  Effective: ${r.effective_date}`);
      console.log(`  LOB: ${r.lob}`);
      console.log(`  Gross: $${r.gross_commission}`);
      console.log(`  THEI Share: $${r.thei_share}`);
      console.log(`  BSI Share: $${r.bsi_share}`);
      console.log(`  Producer Payable: $${r.producer_payable}`);
      console.log(`  Sub-Agent Override: $${r.sub_agent_override}`);
    });
    
    // Check BSI split (post 9/1/2025)
    console.log(`\n=== BSI SPLIT CHECK (post 9/1/2025) ===`);
    const bsiRecords = await pool.query(`
      SELECT agent_name, carrier, effective_date, classification,
             gross_commission, thei_share, bsi_share, split_applies, lob
      FROM commission_records
      WHERE upload_id = $1 
        AND effective_date >= '2025-09-01'
        AND lob = 'MA'
      LIMIT 3
    `, [uploadId]);
    
    bsiRecords.rows.forEach((r, i) => {
      console.log(`\nRecord ${i+1}:`);
      console.log(`  Agent: ${r.agent_name}`);
      console.log(`  Effective: ${r.effective_date}`);
      console.log(`  Classification: ${r.classification}`);
      console.log(`  LOB: ${r.lob}`);
      console.log(`  Gross: $${r.gross_commission}`);
      console.log(`  THEI Share: $${r.thei_share}`);
      console.log(`  BSI Share: $${r.bsi_share}`);
      console.log(`  Split Applies: ${r.split_applies}`);
    });
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkImport();

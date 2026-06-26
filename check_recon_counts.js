const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway'
});

async function checkReconCounts() {
  try {
    console.log('=== AGENCY OVERRIDE RECONCILIATION DATA ===\n');
    
    // 1. Total production records (agency_production table)
    const productionTotal = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT upload_batch) as batches,
             MIN(effective_date) as earliest_date,
             MAX(effective_date) as latest_date
      FROM agency_production
    `);
    
    console.log('📊 PRODUCTION RECORDS (agency_production):');
    console.log(`   Total records: ${productionTotal.rows[0].total}`);
    console.log(`   Batches: ${productionTotal.rows[0].batches}`);
    console.log(`   Date range: ${productionTotal.rows[0].earliest_date} to ${productionTotal.rows[0].latest_date}\n`);
    
    // 2. Production records by carrier
    const prodByCarrier = await pool.query(`
      SELECT carrier, COUNT(*) as count
      FROM agency_production
      GROUP BY carrier
      ORDER BY count DESC
    `);
    
    console.log('   By carrier:');
    prodByCarrier.rows.forEach(r => {
      console.log(`   - ${r.carrier}: ${r.count}`);
    });
    
    // 3. Total BSI/override commission records
    const overrideTotal = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT upload_id) as uploads,
             MIN(payment_period) as earliest_period,
             MAX(payment_period) as latest_period
      FROM commission_records
      WHERE source = 'override_agency'
         OR payee = 'BSI'
         OR classification ILIKE '%override%'
         OR classification ILIKE '%agency override%'
    `);
    
    console.log('\n📊 OVERRIDE COMMISSION RECORDS (commission_records):');
    console.log(`   Total records: ${overrideTotal.rows[0].total}`);
    console.log(`   Upload batches: ${overrideTotal.rows[0].uploads}`);
    console.log(`   Period range: ${overrideTotal.rows[0].earliest_period} to ${overrideTotal.rows[0].latest_period}\n`);
    
    // 4. Override records by carrier
    const commByCarrier = await pool.query(`
      SELECT carrier, COUNT(*) as count
      FROM commission_records
      WHERE source = 'override_agency'
         OR payee = 'BSI'
         OR classification ILIKE '%override%'
         OR classification ILIKE '%agency override%'
      GROUP BY carrier
      ORDER BY count DESC
    `);
    
    console.log('   By carrier:');
    commByCarrier.rows.forEach(r => {
      console.log(`   - ${r.carrier}: ${r.count}`);
    });
    
    // 5. Check what source/payee/classification values exist
    const sources = await pool.query(`
      SELECT DISTINCT source, COUNT(*) as count
      FROM commission_records
      GROUP BY source
      ORDER BY count DESC
    `);
    
    console.log('\n📊 COMMISSION RECORDS BY SOURCE:');
    sources.rows.forEach(r => {
      console.log(`   - ${r.source || '(null)'}: ${r.count}`);
    });
    
    const payees = await pool.query(`
      SELECT DISTINCT payee, COUNT(*) as count
      FROM commission_records
      GROUP BY payee
      ORDER BY count DESC
      LIMIT 10
    `);
    
    console.log('\n📊 COMMISSION RECORDS BY PAYEE (top 10):');
    payees.rows.forEach(r => {
      console.log(`   - ${r.payee || '(null)'}: ${r.count}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkReconCounts();

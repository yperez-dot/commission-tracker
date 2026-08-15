
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkDateMismatch() {
  try {
    console.log('=== CHECKING DATE/PERIOD ALIGNMENT ===\n');
    
    // Production date range
    const prodDates = await pool.query(`
      SELECT 
        MIN(effective_date) as earliest,
        MAX(effective_date) as latest,
        COUNT(DISTINCT TO_CHAR(effective_date, 'YYYYMM')) as unique_months
      FROM agency_production
    `);
    
    console.log('📅 PRODUCTION (agency_production):');
    console.log(`   Earliest: ${prodDates.rows[0].earliest}`);
    console.log(`   Latest: ${prodDates.rows[0].latest}`);
    console.log(`   Unique months: ${prodDates.rows[0].unique_months}\n`);
    
    // Override commission period range (BSI/NHP only)
    const commPeriods = await pool.query(`
      SELECT 
        MIN(payment_period) as earliest_period,
        MAX(payment_period) as latest_period,
        COUNT(DISTINCT payment_period) as unique_periods,
        MIN(effective_date) as earliest_date,
        MAX(effective_date) as latest_date
      FROM commission_records
      WHERE payee IN ('BSI', 'NHP')
    `);
    
    console.log('📅 OVERRIDE COMMISSIONS (BSI/NHP):');
    console.log(`   Earliest period: ${commPeriods.rows[0].earliest_period}`);
    console.log(`   Latest period: ${commPeriods.rows[0].latest_period}`);
    console.log(`   Unique periods: ${commPeriods.rows[0].unique_periods}`);
    console.log(`   Earliest effective date: ${commPeriods.rows[0].earliest_date}`);
    console.log(`   Latest effective date: ${commPeriods.rows[0].latest_date}\n`);
    
    // Sample mismatches
    console.log('📊 Sample production records WITHOUT override match:\n');
    
    const samples = await pool.query(`
      SELECT ap.client_name, ap.carrier, ap.effective_date
      FROM agency_production ap
      WHERE NOT EXISTS (
        SELECT 1 FROM commission_records cr
        WHERE cr.payee IN ('BSI', 'NHP')
        AND LOWER(TRIM(cr.client_full_name)) = LOWER(TRIM(ap.client_name))
        AND LOWER(TRIM(cr.carrier)) = LOWER(TRIM(ap.carrier))
      )
      LIMIT 10
    `);
    
    samples.rows.forEach((r, i) => {
      console.log(`${i+1}. ${r.client_name} | ${r.carrier} | ${r.effective_date}`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkDateMismatch();

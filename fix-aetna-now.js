// Direct database fix for Aetna classifications
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false
});

async function fixAetnaClassifications() {
  try {
    const result = await pool.query(`
      UPDATE commission_records
      SET classification = 'Renewal'
      WHERE carrier = 'Aetna'
        AND classification = 'New Business'
        AND period = '202601'
        AND (effective_date < '2026-01-01' OR effective_date >= '2026-02-01')
        AND commission > 0
      RETURNING id, client_full_name, effective_date, commission, classification
    `);

    console.log(`✅ Fixed ${result.rowCount} Aetna records:`);
    result.rows.forEach(r => {
      console.log(`  - ${r.client_full_name}: ${r.effective_date} → ${r.classification}`);
    });

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

fixAetnaClassifications();

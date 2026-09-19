if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigration() {
  try {
    console.log('Running migration 012_records_classification_trgm_index.sql...');

    const sql = fs.readFileSync('./migrations/012_records_classification_trgm_index.sql', 'utf8');

    await pool.query(sql);

    console.log('✅ Migration completed successfully!');

    const idx = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'commission_records'
        AND indexname = 'idx_commission_records_classification_trgm'
    `);

    if (idx.rows.length > 0) {
      console.log('\n📊 Index created: idx_commission_records_classification_trgm');
    } else {
      console.log('\n⚠️  Index not found after migration — check for errors above.');
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

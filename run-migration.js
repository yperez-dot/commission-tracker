require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const sql = fs.readFileSync('./add-statement-month-column.sql', 'utf8');
    console.log('Running migration...\n');
    await pool.query(sql);
    console.log('✅ Migration complete!');
    console.log('- Added statement_month column');
    console.log('- Created index');
    console.log('- Updated existing records from raw_data');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
})();

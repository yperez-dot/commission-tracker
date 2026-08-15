#!/usr/bin/env node

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function checkDuplicates() {
  try {
    console.log('📊 Checking for carrier duplicates in book_of_business...\n');
    
    const result = await pool.query(`
      SELECT carrier, COUNT(*) as count 
      FROM book_of_business 
      WHERE status = 'active'
      GROUP BY carrier 
      ORDER BY carrier
    `);
    
    console.log('Active carriers:');
    result.rows.forEach(r => {
      console.log(`  ${r.carrier}: ${r.count} clients`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkDuplicates();

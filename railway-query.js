#!/usr/bin/env node
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:LyahRMtjzhkPkaPpXtgysioPUBUVPAOi@metro.proxy.rlwy.net:24676/railway',
  ssl: { rejectUnauthorized: false }
});

async function runQuery(sql) {
  try {
    const result = await pool.query(sql);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.error('Query error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const query = process.argv[2];
if (!query) {
  console.error('Usage: node railway-query.js "SELECT ..."');
  process.exit(1);
}

runQuery(query);

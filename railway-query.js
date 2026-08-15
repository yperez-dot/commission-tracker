#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : undefined,
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
  console.error('Usage: DATABASE_URL=... node railway-query.js "SELECT ..."');
  process.exit(1);
}

runQuery(query);

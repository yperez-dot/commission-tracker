/**
 * backfill-humana-umid.js
 * 
 * One-time backfill: Humana agency_production records were stored with DOC_ID
 * as policy_number. The correct value is UMID (H-format, e.g. H05007113),
 * which is stored in raw_data JSON.
 * 
 * Run: node scripts/backfill-humana-umid.js
 */

require('dotenv').config();
const { getPool } = require('../db/database');

async function backfill() {
  const pool = getPool();
  console.log('🔍 Fetching Humana agency_production records with raw_data...');

  const result = await pool.query(`
    SELECT id, policy_number, raw_data
    FROM agency_production
    WHERE carrier = 'Humana'
      AND raw_data IS NOT NULL
  `);

  console.log(`Found ${result.rows.length} Humana records to check.`);

  let updated = 0;
  let skipped = 0;

  for (const row of result.rows) {
    let raw;
    try {
      raw = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
    } catch (e) {
      skipped++;
      continue;
    }

    const umid = raw.UMID ? String(raw.UMID).trim() : null;

    // Only update if UMID exists and is different from what's stored
    if (!umid || umid === row.policy_number) {
      skipped++;
      continue;
    }

    await pool.query(
      `UPDATE agency_production SET policy_number = $1 WHERE id = $2`,
      [umid, row.id]
    );
    console.log(`  ✅ ID ${row.id}: ${row.policy_number} → ${umid}`);
    updated++;
  }

  console.log(`\n✅ Done. Updated: ${updated} | Skipped (already correct or no UMID): ${skipped}`);
  await pool.end();
}

backfill().catch(err => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});

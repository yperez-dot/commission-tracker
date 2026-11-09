#!/usr/bin/env node
'use strict';

/**
 * Opt-in backfill of UHC UAD Activity onto EXISTING commission_records.
 *
 * Does NOT insert missing rows and does NOT rewrite commission, splits, or
 * delete uploads. It only fills `uad_activity` (and relabels Commission=$0
 * + nonzero UAD rows as "UHC advance recoup (UAD)") from stored raw_data.
 *
 * Rows that were never imported (parseUHCDirectRows skipped $0 commission,
 * or the generic mapper dropped them) cannot be recovered here — re-upload
 * the original UHC Excel after this release. Duplicate detection will skip
 * the already-imported commission lines and keep the UAD / unique personal
 * lines.
 *
 * DRY RUN by default:
 *   DATABASE_URL=… node scripts/backfill-uhc-uad.js
 *   DATABASE_URL=… node scripts/backfill-uhc-uad.js --apply
 *
 * Never prints the connection string.
 */

const { Pool } = require('pg');
const {
  parseUadActivity,
  parseUhcMoney,
  UAD_CLASSIFICATION,
} = require('../src/uhcUad');

const APPLY = process.argv.includes('--apply');

function parseRaw(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  await pool.query(
    `ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS uad_activity NUMERIC(12,2) DEFAULT 0`
  );
  const { rows } = await pool.query(`
    SELECT id, commission, classification, uad_activity, raw_data, policy_number, client_full_name
    FROM commission_records
    WHERE carrier ILIKE '%united%'
      AND raw_data IS NOT NULL
      AND raw_data <> ''
      AND raw_data ILIKE '%UAD%'
    ORDER BY id
  `);

  const updates = [];
  for (const row of rows) {
    const raw = parseRaw(row.raw_data);
    if (!raw) continue;
    const uad = parseUadActivity(raw);
    if (uad === 0) continue;
    const current = parseUhcMoney(row.uad_activity);
    const commission = parseUhcMoney(row.commission);
    const nextClass = (commission === 0 && uad !== 0) ? UAD_CLASSIFICATION : row.classification;
    if (current === uad && row.classification === nextClass) continue;
    updates.push({
      id: row.id,
      client: row.client_full_name,
      policy: row.policy_number,
      uad,
      classification: nextClass,
    });
  }

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${updates.length} existing UHC row(s) with UAD in raw_data to update.`);
  updates.slice(0, 20).forEach((u) => {
    console.log(`  #${u.id} ${u.client} ${u.policy} UAD=${u.uad.toFixed(2)} class=${u.classification}`);
  });
  if (updates.length > 20) console.log(`  … +${updates.length - 20} more`);

  if (APPLY && updates.length) {
    for (const u of updates) {
      await pool.query(
        `UPDATE commission_records
            SET uad_activity = $2,
                classification = $3
          WHERE id = $1`,
        [u.id, u.uad, u.classification]
      );
    }
    console.log(`Updated ${updates.length} row(s).`);
  } else if (!APPLY) {
    console.log('Re-run with --apply to write. This never inserts missing rows.');
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

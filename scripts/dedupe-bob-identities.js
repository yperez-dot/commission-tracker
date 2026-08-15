#!/usr/bin/env node
'use strict';

/**
 * Soft-dedupe Book of Business identity duplicates.
 *
 * Same person under different name formats (FIRST LAST vs LAST, FIRST) share
 * clientNameKey|carrier. Keeps the best row (last paid → amount → older eff
 * date → lower id) and sets the rest to status=inactive / resolution=
 * 'Duplicate identity'.
 *
 * Usage:
 *   node scripts/dedupe-bob-identities.js                 # dry run (THEI principals)
 *   node scripts/dedupe-bob-identities.js --apply         # apply THEI principals
 *   node scripts/dedupe-bob-identities.js --all --apply   # all active BOB
 */

const fs = require('fs');
const { Pool } = require('pg');
const {
  clientCarrierKey,
  preferBobClient,
  normPeriod,
  isTheiPrincipalAgent,
} = require('../src/missingRenewalsLogic');

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

function pickKeep(list) {
  return list.reduce((best, row) => preferBobClient(best, row));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  console.log(`BOB identity dedupe — ${APPLY ? 'APPLY' : 'DRY RUN'} — scope=${ALL ? 'all active' : 'Yahoska/Katy'}\n`);

  const { rows } = await pool.query(`
    SELECT id, client_full_name, carrier, agent_name, effective_date,
           last_commission_date, last_commission_amount, status, source, resolution
    FROM book_of_business
    WHERE status = 'active'
    ORDER BY id
  `);

  const groups = new Map();
  for (const r of rows) {
    if (!ALL && !isTheiPrincipalAgent(r.agent_name)) continue;
    const key = clientCarrierKey(r.client_full_name, r.carrier);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // If scope=thei, a group may also include a non-principal row with same identity
  // (e.g. agent="The Health Experts Insurance"). Reload full group by key from all active.
  if (!ALL) {
    const keys = [...groups.keys()];
    for (const key of keys) {
      const full = rows.filter((r) => clientCarrierKey(r.client_full_name, r.carrier) === key);
      groups.set(key, full);
    }
  }

  const dupGroups = [...groups.entries()].filter(([, list]) => list.length > 1);
  const actions = [];

  for (const [key, list] of dupGroups) {
    const keep = pickKeep(list);
    for (const row of list) {
      if (row.id === keep.id) continue;
      actions.push({
        key,
        keepId: keep.id,
        keepName: keep.client_full_name,
        keepLast: normPeriod(keep.last_commission_date) || '',
        keepAmt: keep.last_commission_amount || 0,
        keepSource: keep.source || '',
        dupId: row.id,
        dupName: row.client_full_name,
        dupLast: normPeriod(row.last_commission_date) || '',
        dupAmt: row.last_commission_amount || 0,
        dupSource: row.source || '',
        carrier: keep.carrier || row.carrier,
        agent: row.agent_name || '',
      });
    }
  }

  console.log(`Active rows scanned: ${rows.length}`);
  console.log(`Duplicate identity groups: ${dupGroups.length}`);
  console.log(`Rows to inactivate: ${actions.length}`);

  const preview = actions.slice(0, 15);
  console.log('\nSample (first 15):');
  for (const a of preview) {
    console.log(
      `  KEEP #${a.keepId} ${a.keepName} (${a.keepLast || '—'} $${a.keepAmt})  ←  DUP #${a.dupId} ${a.dupName} (${a.dupSource})`
    );
  }
  if (actions.length > preview.length) console.log(`  ... +${actions.length - preview.length} more`);

  const outPath = '/opt/cursor/artifacts/bob-dedupe-actions.csv';
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  const csv = [
    'identity_key,keep_id,keep_name,keep_last,keep_amt,keep_source,dup_id,dup_name,dup_last,dup_amt,dup_source,carrier,agent',
    ...actions.map((a) =>
      [
        a.key,
        a.keepId,
        JSON.stringify(a.keepName),
        a.keepLast,
        a.keepAmt,
        a.keepSource,
        a.dupId,
        JSON.stringify(a.dupName),
        a.dupLast,
        a.dupAmt,
        a.dupSource,
        JSON.stringify(a.carrier),
        JSON.stringify(a.agent),
      ].join(',')
    ),
  ].join('\n');
  fs.writeFileSync(outPath, csv);
  console.log(`\nWrote action log: ${outPath}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to inactivate duplicates.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const a of actions) {
      const res = await client.query(
        `UPDATE book_of_business
         SET status = 'inactive',
             resolution = 'Duplicate identity',
             notes = COALESCE(notes, '') || CASE
               WHEN notes IS NULL OR notes = '' THEN $1
               ELSE E'\\n' || $1
             END,
             updated_at = NOW()
         WHERE id = $2 AND status = 'active'
         RETURNING id`,
        [`Duplicate of BOB #${a.keepId} (${a.keepName})`, a.dupId]
      );
      updated += res.rowCount;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Verify Woodcock + remaining dups in scope
  const wood = await pool.query(
    `SELECT id, client_full_name, status, resolution, last_commission_amount
     FROM book_of_business
     WHERE client_full_name ILIKE '%woodcock%'
     ORDER BY id`
  );
  console.log(`\nUpdated rows: ${updated}`);
  console.log('Woodcock after:');
  for (const r of wood.rows) {
    console.log(`  #${r.id} ${r.client_full_name} | ${r.status} | ${r.resolution || '—'} | $${r.last_commission_amount || 0}`);
  }

  const still = await pool.query(`SELECT id, client_full_name, carrier, agent_name, status FROM book_of_business WHERE status = 'active'`);
  const stillGroups = new Map();
  for (const r of still.rows) {
    if (!ALL && !isTheiPrincipalAgent(r.agent_name)) continue;
    const key = clientCarrierKey(r.client_full_name, r.carrier);
    if (!key) continue;
    if (!stillGroups.has(key)) stillGroups.set(key, []);
    stillGroups.get(key).push(r);
  }
  // expand non-ALL groups
  if (!ALL) {
    for (const key of [...stillGroups.keys()]) {
      stillGroups.set(
        key,
        still.rows.filter((r) => clientCarrierKey(r.client_full_name, r.carrier) === key)
      );
    }
  }
  const remaining = [...stillGroups.values()].filter((l) => l.length > 1).length;
  console.log(`Remaining active identity-dup groups in scope: ${remaining}`);
  console.log('\n✅ Dedupe complete (soft inactive).');
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});

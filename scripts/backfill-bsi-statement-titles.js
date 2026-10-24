#!/usr/bin/env node
'use strict';

/**
 * Standardize titles of existing BSI statement uploads:
 *   "BSI · Carrier · MM.YYYY"  (or "… · MM.YYYY to MM.YYYY" for multi-month files)
 * Manual titles keep their text; only MM-YYYY month tokens become MM.YYYY.
 *
 * DRY RUN by default — prints old → new and writes nothing (session is READ ONLY).
 *
 *   DATABASE_URL=… node scripts/backfill-bsi-statement-titles.js            # dry run
 *   DATABASE_URL=… node scripts/backfill-bsi-statement-titles.js --json     # dry run, JSON
 *   DATABASE_URL=… node scripts/backfill-bsi-statement-titles.js --apply    # write
 *
 * Options:
 *   --apply           write uploads.display_title (auto rows → source 'auto'; manual rows stay 'manual')
 *   --include-manual  also overwrite titles an admin set by hand (default: keep)
 *   --json            machine-readable output
 *
 * Never prints the connection string.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Pool } = require('pg');
const { applyBsiTitlePlan, planBsiTitles } = require('../src/bsiStatementTitleDb');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const INCLUDE_MANUAL = args.has('--include-manual');
const AS_JSON = args.has('--json');

/** The label the UI shows today (ESM util loaded without a bundler). */
function loadLegacyDisplayName() {
  try {
    const file = path.join(__dirname, '..', 'src', 'utils', 'statementDisplayName.js');
    const src = fs.readFileSync(file, 'utf8').replace(/^export\s+/gm, '');
    const ctx = {};
    vm.runInNewContext(`${src}\nthis.statementDisplayName = statementDisplayName;`, ctx);
    return (u) => ctx.statementDisplayName(u.original_name, { category: 'bsi_statement' });
  } catch (e) {
    return (u) => u.original_name;
  }
}

function pad(s, n) {
  s = String(s == null ? '' : s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /railway|rlwy/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    max: 1,
    // Dry runs can't write, even by accident: every transaction is READ ONLY.
    ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }),
  });

  try {
    const plan = await planBsiTitles(pool, { includeManual: INCLUDE_MANUAL, oldTitleOf: loadLegacyDisplayName() });
    const flagged = plan.filter((p) => p.confidence !== 'high' || p.notes.some((n) => /same title|could not|not recognized|but rows say|span/.test(n)));

    if (AS_JSON) {
      console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', count: plan.length, plan }, null, 2));
    } else {
      console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${plan.length} BSI statement uploads\n`);
      console.log(`${pad('id', 6)}${pad('old title', 40)}${pad('new title', 40)}${pad('src/conf', 18)}notes`);
      for (const p of plan) {
        console.log(
          `${pad(p.id, 6)}${pad(p.old_title, 40)}${pad(p.new_title, 40)}${pad(`${p.source}/${p.confidence}`, 18)}` +
          `${p.notes.join('; ')}${p.manual ? ' [manual]' : ''}\n${pad('', 6)}file: ${p.original_name}`
        );
      }
      console.log(`\n${plan.filter((p) => p.changed).length} would change; ${flagged.length} flagged for review.`);
    }

    if (!APPLY) {
      if (!AS_JSON) console.log('\nDry run only. Re-run with --apply to write.');
      return;
    }

    const updated = await applyBsiTitlePlan(pool, plan);
    console.log(`Updated ${updated} upload title(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Backfill failed:', String(e.message || e).replace(/postgres(ql)?:\/\/\S+/gi, '[redacted]'));
  process.exit(1);
});

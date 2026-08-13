#!/usr/bin/env node
'use strict';

/**
 * CLI: export override statements for BSI / THEI / Marco / Integrity.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/export-override-statements.js --type=thei_override --period=202601
 *   DATABASE_URL=... node scripts/export-override-statements.js --type=marco --period=202601 --out=./out
 *   DATABASE_URL=... node scripts/export-override-statements.js --type=all --period=202601 --out=./out
 *
 * Types: thei_override | bsi_override | marco | integrity | all
 * Dry by default writes CSVs under --out (default: ./override-statements-out).
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  STATEMENT_TYPES,
  buildOverrideStatements,
  statementToCsv,
  summaryToCsv,
  filenameFor,
} = require('../src/overrideStatementBuilder');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k, def) => {
    const hit = args.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : def;
  };
  return {
    type: get('type', 'all'),
    period: get('period', 'all'),
    out: get('out', path.join(process.cwd(), 'override-statements-out')),
  };
}

async function fetchRows(pool, period) {
  const params = [];
  let where = `WHERE classification ILIKE '%override%'`;
  if (period && period !== 'all') {
    params.push(period);
    where += ` AND payment_period = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT id, agent_name, client_full_name, policy_number, carrier, effective_date,
            payment_period, classification, commission, thei_share, bsi_share,
            producer_payable, sub_agent_override, payee, source
     FROM commission_records ${where}
     ORDER BY payment_period, agent_name, id`,
    params
  );
  return result.rows;
}

function writeBundle(bundle, outDir) {
  const typeDir = path.join(outDir, bundle.type, bundle.period === 'all' ? 'ALL' : bundle.period);
  fs.mkdirSync(typeDir, { recursive: true });
  const summaryPath = path.join(typeDir, filenameFor(bundle, 'SUMMARY'));
  fs.writeFileSync(summaryPath, summaryToCsv(bundle), 'utf8');
  const written = [summaryPath];
  for (const stmt of bundle.statements) {
    const fp = path.join(typeDir, filenameFor(bundle, stmt.payee));
    fs.writeFileSync(fp, statementToCsv(bundle, stmt), 'utf8');
    written.push(fp);
  }
  return { typeDir, written, grandTotal: bundle.grandTotal, payees: bundle.statementCount };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }
  const { type, period, out } = parseArgs();
  const types =
    type === 'all'
      ? Object.values(STATEMENT_TYPES)
      : [type];

  for (const t of types) {
    if (!Object.values(STATEMENT_TYPES).includes(t)) {
      console.error(`Invalid type: ${t}`);
      process.exit(1);
    }
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  try {
    const rows = await fetchRows(pool, period);
    console.log(`Loaded ${rows.length} Agency Override rows (period=${period})`);
    fs.mkdirSync(out, { recursive: true });

    for (const t of types) {
      const bundle = buildOverrideStatements(rows, t, { period });
      const result = writeBundle(bundle, out);
      console.log(
        `  ${t}: ${result.payees} payee statement(s), total $${result.grandTotal.toFixed(2)} → ${result.typeDir}`
      );
    }
    console.log(`Done. Output: ${out}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

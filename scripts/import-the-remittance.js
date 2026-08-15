#!/usr/bin/env node
'use strict';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }


/**
 * Import a BSI→THE remittance CSV into Commission Statements.
 * Use until the THE remittance parser is deployed to production.
 *
 *   node scripts/import-the-remittance.js --file=/path/to.csv
 *   node scripts/import-the-remittance.js --file=/path/to.csv --apply
 *   node scripts/import-the-remittance.js --file=/path/to.csv --apply --name=T.H.E_STATEMENTS_JULY_2026.csv
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const {
  isTheRemittanceStatement,
  parseTheRemittanceStatement,
} = require('../src/theRemittanceStatement');

const APPLY = process.argv.includes('--apply');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const nameArg = process.argv.find((a) => a.startsWith('--name='));
const FILE = fileArg
  ? fileArg.split('=').slice(1).join('=')
  : '/home/ubuntu/.cursor/projects/workspace/uploads/T.H.E_STATEMENTS_78e6.csv';
const UPLOAD_NAME =
  (nameArg && nameArg.split('=').slice(1).join('=')) ||
  path.basename(FILE).replace(/_[a-f0-9]{4}(?=\.)/i, '');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function toIsoDate(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`File not found: ${FILE}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(FILE);
  if (!isTheRemittanceStatement(wb, UPLOAD_NAME)) {
    console.error('File was not detected as a BSI→THE remittance statement.');
    process.exit(1);
  }
  const records = parseTheRemittanceStatement(wb, UPLOAD_NAME);
  const commissionSum = records.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);
  const carriers = [...new Set(records.map((r) => r.carrier).filter(Boolean))];

  const existing = await pool.query(`SELECT id FROM uploads WHERE original_name = $1`, [UPLOAD_NAME]);

  console.log(
    JSON.stringify(
      {
        file: FILE,
        uploadName: UPLOAD_NAME,
        rows: records.length,
        commissionSum: Math.round(commissionSum * 100) / 100,
        carriers,
        alreadyUploaded: existing.rows[0]?.id || null,
        apply: APPLY,
      },
      null,
      2
    )
  );

  if (!APPLY) {
    console.log('DRY-RUN — pass --apply to import');
    await pool.end();
    return;
  }
  if (existing.rows.length) {
    console.error(`Already uploaded as id=${existing.rows[0].id}. Delete it first or pass --name=...`);
    process.exit(1);
  }

  const filename = `${Date.now()}_${UPLOAD_NAME.replace(/\s+/g, '_')}`;
  const up = await pool.query(
    `INSERT INTO uploads (filename, original_name, carrier, row_count, commission_sum, uploaded_by, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [filename, UPLOAD_NAME, carriers.join(', '), records.length, commissionSum, 1, 'commission_statement']
  );
  const uploadId = up.rows[0].id;

  for (const r of records) {
    await pool.query(
      `INSERT INTO commission_records (
         upload_id, agent_name, carrier, plan_type, client_full_name, effective_date,
         premium, commission, classification, payment_period, policy_number, payee, mga,
         raw_data, source, policy_written_date, gross_commission, thei_share, bsi_share,
         producer_payable, split_applies, lob, sub_agent_override, statement_month, members,
         anomaly, member_state
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10,$11,$12,$13,
         $14,$15,$16,$17,$18,$19,
         $20,$21,$22,$23,$24,$25,
         $26,$27
       )`,
      [
        uploadId,
        r.agent,
        r.carrier,
        r.planType || '',
        r.client,
        r.effectiveDate,
        r.premium || 0,
        r.commission || 0,
        r.classification,
        r.period,
        r.policyNumber,
        r.payee || 'BSI',
        r.mga || '',
        JSON.stringify(r.raw || {}),
        r.source || 'BSI',
        toIsoDate(r.policyWrittenDate || r.effectiveDate),
        r.grossCommission,
        r.theiShare,
        r.bsiShare,
        r.producerPayable,
        r.splitApplies,
        r.lob || null,
        r.subAgentOverride || 0,
        null,
        0,
        false,
        null,
      ]
    );
  }

  console.log(JSON.stringify({ success: true, uploadId, rows: records.length, commissionSum }, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

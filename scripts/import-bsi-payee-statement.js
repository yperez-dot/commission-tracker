#!/usr/bin/env node
'use strict';

/**
 * Import a BSI→payee Detailed Compensation Statement PDF (Alba agent commissions).
 *
 *   node scripts/import-bsi-payee-statement.js --file=/path/to.pdf
 *   node scripts/import-bsi-payee-statement.js --file=/path/to.pdf --apply
 *   node scripts/import-bsi-payee-statement.js --file=/path/to.pdf --apply --agent='Alba Hernandez'
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { Pool } = require('pg');
const {
  isBsiPayeeCompensationStatement,
  parseBsiPayeeCompensationStatement,
} = require('../src/bsiPayeeCompensationStatement');

const APPLY = process.argv.includes('--apply');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const nameArg = process.argv.find((a) => a.startsWith('--name='));
const agentArg = process.argv.find((a) => a.startsWith('--agent='));
const FILE = fileArg ? fileArg.split('=').slice(1).join('=') : null;
const UPLOAD_NAME =
  (nameArg && nameArg.split('=').slice(1).join('=')) ||
  (FILE ? path.basename(FILE).replace(/_[a-f0-9]{4}(?=\.)/i, '') : null);
const AGENT = (agentArg && agentArg.split('=').slice(1).join('=')) || 'Alba Hernandez';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function toIsoDate(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

async function main() {
  if (!FILE || !fs.existsSync(FILE)) {
    console.error('Usage: --file=/path/to.pdf [--apply] [--agent=Alba Hernandez]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const data = await pdfParse(fs.readFileSync(FILE));
  if (!isBsiPayeeCompensationStatement(data.text, UPLOAD_NAME)) {
    console.error('Not detected as BSI→payee compensation statement');
    process.exit(1);
  }

  const parsed = parseBsiPayeeCompensationStatement(data.text, {
    filename: UPLOAD_NAME,
    agentName: AGENT,
  });

  const existing = await pool.query(`SELECT id FROM uploads WHERE original_name = $1`, [UPLOAD_NAME]);

  // Dedup only against prior BSI_PAYEE imports (carrier-feed rows may share
  // amounts but Alba statements prefer BSI_PAYEE as settlement source of truth).
  const toInsert = [];
  const skipped = [];
  for (const r of parsed.records) {
    const { rows } = await pool.query(
      `SELECT id, source, producer_payable
       FROM commission_records
       WHERE agent_name ILIKE $1
         AND payment_period = $2
         AND policy_number = $3
         AND source = 'BSI_PAYEE'
         AND ABS(COALESCE(producer_payable, 0) - $4) < 0.02
       LIMIT 3`,
      [`%${AGENT.split(' ')[0]}%${AGENT.split(' ').slice(-1)[0]}%`, r.period, r.policyNumber, r.producerPayable]
    );
    if (rows.length) {
      skipped.push({ policy: r.policyNumber, amount: r.producerPayable, existingId: rows[0].id });
    } else {
      toInsert.push(r);
    }
  }

  console.log(
    JSON.stringify(
      {
        file: FILE,
        uploadName: UPLOAD_NAME,
        agent: AGENT,
        period: parsed.period,
        statementDate: parsed.statementDate,
        statedBalance: parsed.statedBalance,
        parsedRows: parsed.records.length,
        parsedSum: parsed.commissionSum,
        balanceDelta: parsed.statedBalance != null ? round2(parsed.statedBalance - parsed.commissionSum) : null,
        toInsert: toInsert.length,
        skipped: skipped.length,
        skippedSample: skipped.slice(0, 5),
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

  const carriers = [...new Set(toInsert.map((r) => r.carrier).filter(Boolean))];
  const commissionSum = round2(toInsert.reduce((s, r) => s + (Number(r.commission) || 0), 0));
  const filename = `${Date.now()}_${UPLOAD_NAME.replace(/\s+/g, '_')}`;
  const up = await pool.query(
    `INSERT INTO uploads (filename, original_name, carrier, row_count, commission_sum, uploaded_by, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [filename, UPLOAD_NAME, carriers.join(', '), toInsert.length, commissionSum, 1, 'commission_statement']
  );
  const uploadId = up.rows[0].id;

  for (const r of toInsert) {
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
        r.payee || AGENT,
        r.mga || '',
        JSON.stringify(r.raw || {}),
        r.source || 'BSI_PAYEE',
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

  console.log(
    JSON.stringify(
      { success: true, uploadId, inserted: toInsert.length, skipped: skipped.length, commissionSum },
      null,
      2
    )
  );
  await pool.end();
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

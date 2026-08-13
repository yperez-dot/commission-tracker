#!/usr/bin/env node
'use strict';

/**
 * Align Alba/Lina agent-production producer_payable to BSI→Lina pay statements.
 *
 * The June/July PDFs are the settlement source of truth for what BSI paid her
 * (detail lines — not the held Balance gap). Carrier-feed amounts often differ.
 *
 *   node scripts/align-lina-production-to-bsi-payee.js
 *   node scripts/align-lina-production-to-bsi-payee.js --apply
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { Pool } = require('pg');
const {
  parseBsiPayeeCompensationStatement,
} = require('../src/bsiPayeeCompensationStatement');

const APPLY = process.argv.includes('--apply');

const STATEMENTS = [
  {
    period: '202607',
    label: 'July 2026',
    file: '/home/ubuntu/.cursor/projects/workspace/uploads/Commission_Statement_-8_6_26__1__619f.pdf',
    uploadName: 'ALIGN_Lina_BSI_Payee_202607.pdf',
  },
  {
    period: '202606',
    label: 'June 2026',
    file: '/home/ubuntu/.cursor/projects/workspace/uploads/CarrierStatement-June__Lina___1__c942.pdf',
    uploadName: 'ALIGN_Lina_BSI_Payee_202606.pdf',
  },
];

const AGENT = 'Alba Hernandez';
const BACKUP = 'commission_records_backup_lina_align_bsi_payee_20260813';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normPol(p) {
  return String(p || '')
    .replace(/[\s\-]/g, '')
    .toUpperCase();
}

function normClient(c) {
  return String(c || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function classify(amount) {
  if (amount < 0) return 'Chargeback';
  if (Math.abs(amount) >= 300) return 'New Business';
  return 'Renewal';
}

function toIsoDate(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

async function loadAlbaAgentRows(period) {
  const { rows } = await pool.query(
    `SELECT id, agent_name, policy_number, client_full_name, carrier, classification,
            producer_payable, commission, payment_period, upload_id, source, edit_notes
     FROM commission_records
     WHERE (agent_name ILIKE '%alba%hernandez%'
         OR agent_name ILIKE '%lina%hernandez%'
         OR agent_name ILIKE '%alba%ritela%')
       AND payment_period = $1
       AND LOWER(COALESCE(classification,'')) NOT LIKE '%override%'
       AND (
         LOWER(COALESCE(classification,'')) LIKE '%new business%'
         OR LOWER(COALESCE(classification,'')) LIKE '%renewal%'
         OR LOWER(COALESCE(classification,'')) LIKE '%chargeback%'
         OR LOWER(COALESCE(classification,'')) LIKE '%agent commission%'
         OR LOWER(TRIM(COALESCE(classification,''))) = 'commission'
         OR COALESCE(producer_payable,0) <> 0
       )
     ORDER BY id`,
    [period]
  );
  return rows;
}

function scoreMatch(pdfLine, dbRow) {
  const polOk = normPol(pdfLine.policyNumber) === normPol(dbRow.policy_number);
  const amtOk = round2(pdfLine.producerPayable) === round2(dbRow.producer_payable);
  const clientPdf = normClient(pdfLine.client);
  const clientDb = normClient(dbRow.client_full_name);
  const clientOk =
    clientPdf &&
    clientDb &&
    (clientPdf.includes(clientDb.slice(0, 6)) ||
      clientDb.includes(clientPdf.slice(0, 6)) ||
      clientPdf === clientDb);

  if (polOk && clientOk) return 100;
  if (polOk) return 80;
  if (pdfLine.policyNumber === 'HRA' && amtOk && clientOk) return 70;
  if (pdfLine.policyNumber === 'HRA' && amtOk) return 50;
  if (amtOk && clientOk) return 40;
  return 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const plan = [];

  for (const stmt of STATEMENTS) {
    if (!fs.existsSync(stmt.file)) {
      console.error('Missing file', stmt.file);
      process.exit(1);
    }
    const text = (await pdfParse(fs.readFileSync(stmt.file))).text;
    const parsed = parseBsiPayeeCompensationStatement(text, {
      filename: path.basename(stmt.file),
      agentName: AGENT,
    });
    const dbRows = await loadAlbaAgentRows(stmt.period);
    const usedDb = new Set();
    const updates = [];
    const inserts = [];
    const zeros = [];

    for (const line of parsed.records) {
      let best = null;
      let bestScore = 0;
      for (const row of dbRows) {
        if (usedDb.has(row.id)) continue;
        const s = scoreMatch(line, row);
        if (s > bestScore) {
          bestScore = s;
          best = row;
        }
      }
      if (best && bestScore >= 80) {
        usedDb.add(best.id);
        const amt = round2(line.producerPayable);
        updates.push({
          id: best.id,
          fromPp: best.producer_payable != null ? round2(best.producer_payable) : null,
          toPp: amt,
          fromClass: best.classification,
          toClass: classify(amt),
          policy: line.policyNumber,
          client: line.client,
          carrier: line.carrier,
          effectiveDate: line.effectiveDate,
        });
      } else {
        inserts.push({
          ...line,
          classification: classify(round2(line.producerPayable)),
          matchScore: bestScore,
          nearId: best?.id || null,
        });
      }
    }

    for (const row of dbRows) {
      if (usedDb.has(row.id)) continue;
      const pp = round2(row.producer_payable || 0);
      if (pp !== 0) {
        zeros.push({
          id: row.id,
          policy: row.policy_number,
          client: row.client_full_name,
          fromPp: pp,
          classification: row.classification,
        });
      }
    }

    plan.push({
      ...stmt,
      statedBalance: parsed.statedBalance,
      pdfSum: parsed.commissionSum,
      pdfLines: parsed.records.length,
      dbBefore: round2(dbRows.reduce((s, r) => s + Number(r.producer_payable || 0), 0)),
      dbBeforeCount: dbRows.length,
      updates,
      inserts,
      zeros,
      alignedSum: round2(
        updates.reduce((s, u) => s + u.toPp, 0) +
          inserts.reduce((s, i) => s + round2(i.producerPayable), 0)
      ),
    });
  }

  console.log(
    JSON.stringify(
      {
        apply: APPLY,
        note: 'Aligns Alba/Lina agent producer_payable to BSI payee PDF detail lines (not held Balance).',
        periods: plan.map((p) => ({
          period: p.period,
          label: p.label,
          pdfBalance: p.statedBalance,
          pdfDetailSum: p.pdfSum,
          dbAgentPpBefore: p.dbBefore,
          alignedDetailSum: p.alignedSum,
          updates: p.updates.length,
          inserts: p.inserts.length,
          zeroOut: p.zeros.length,
          updateSample: p.updates.slice(0, 3),
          insertSample: p.inserts.slice(0, 3).map((i) => ({
            policy: i.policyNumber,
            amount: i.producerPayable,
            client: i.client,
            carrier: i.carrier,
          })),
          zeroSample: p.zeros.slice(0, 5),
        })),
      },
      null,
      2
    )
  );

  if (!APPLY) {
    console.log('DRY-RUN — pass --apply to write');
    await pool.end();
    return;
  }

  // Backup
  await pool.query(`DROP TABLE IF EXISTS ${BACKUP}`);
  await pool.query(`
    CREATE TABLE ${BACKUP} AS
    SELECT * FROM commission_records
    WHERE (agent_name ILIKE '%alba%hernandez%'
        OR agent_name ILIKE '%lina%hernandez%'
        OR agent_name ILIKE '%alba%ritela%')
      AND payment_period = ANY($1::text[])
  `, [STATEMENTS.map((s) => s.period)]);
  const bak = await pool.query(`SELECT COUNT(*)::int AS n FROM ${BACKUP}`);
  console.log('backup', BACKUP, bak.rows[0].n, 'rows');

  for (const p of plan) {
    // Zero unmatched DB agent pp
    for (const z of p.zeros) {
      await pool.query(
        `UPDATE commission_records SET
           producer_payable = 0,
           is_manually_edited = TRUE,
           edited_at = NOW(),
           edited_by = 'lina_align_bsi_payee',
           edit_notes = COALESCE(edit_notes,'') || ' | Aligned to BSI Lina payee statement: zeroed pp (not on settlement)'
         WHERE id = $1`,
        [z.id]
      );
    }

    // Update matched
    for (const u of p.updates) {
      await pool.query(
        `UPDATE commission_records SET
           agent_name = $2,
           producer_payable = $3::numeric,
           commission = CASE WHEN COALESCE(commission,0) = 0 THEN $3::numeric ELSE commission END,
           classification = $4,
           client_full_name = COALESCE(NULLIF($5,''), client_full_name),
           carrier = COALESCE(NULLIF($6,''), carrier),
           effective_date = COALESCE($7, effective_date),
           is_manually_edited = TRUE,
           edited_at = NOW(),
           edited_by = 'lina_align_bsi_payee',
           edit_notes = COALESCE(edit_notes,'') || $8
         WHERE id = $1`,
        [
          u.id,
          AGENT,
          u.toPp,
          u.toClass,
          u.client,
          u.carrier,
          u.effectiveDate,
          ` | Aligned to BSI Lina payee: pp ${u.fromPp} → ${u.toPp}`,
        ]
      );
    }

    // Insert missing via upload
    if (p.inserts.length) {
      const existing = await pool.query(`SELECT id FROM uploads WHERE original_name = $1`, [
        p.uploadName,
      ]);
      let uploadId;
      if (existing.rows[0]) {
        uploadId = existing.rows[0].id;
        await pool.query(`DELETE FROM commission_records WHERE upload_id = $1`, [uploadId]);
        await pool.query(
          `UPDATE uploads SET row_count=$2, commission_sum=$3, carrier=$4 WHERE id=$1`,
          [
            uploadId,
            p.inserts.length,
            p.inserts.reduce((s, i) => s + round2(i.producerPayable), 0),
            [...new Set(p.inserts.map((i) => i.carrier))].join(', '),
          ]
        );
      } else {
        const sum = round2(p.inserts.reduce((s, i) => s + round2(i.producerPayable), 0));
        const carriers = [...new Set(p.inserts.map((i) => i.carrier))].join(', ');
        const up = await pool.query(
          `INSERT INTO uploads (filename, original_name, carrier, row_count, commission_sum, uploaded_by, category)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            `${Date.now()}_${p.uploadName}`,
            p.uploadName,
            carriers,
            p.inserts.length,
            sum,
            1,
            'commission_statement',
          ]
        );
        uploadId = up.rows[0].id;
      }

      for (const i of p.inserts) {
        const amt = round2(i.producerPayable);
        await pool.query(
          `INSERT INTO commission_records (
             upload_id, agent_name, carrier, plan_type, client_full_name, effective_date,
             premium, commission, classification, payment_period, policy_number, payee, mga,
             raw_data, source, policy_written_date, gross_commission, thei_share, bsi_share,
             producer_payable, split_applies, lob, sub_agent_override, statement_month, members,
             anomaly, member_state, is_manually_edited, edited_by, edited_at, edit_notes
           ) VALUES (
             $1,$2,$3,$4,$5,$6,
             $7,$8,$9,$10,$11,$12,$13,
             $14,$15,$16,$17,$18,$19,
             $20,$21,$22,$23,$24,$25,
             $26,$27,$28,$29,NOW(),$30
           )`,
          [
            uploadId,
            AGENT,
            i.carrier,
            '',
            i.client,
            i.effectiveDate,
            0,
            amt,
            i.classification,
            p.period,
            i.policyNumber,
            'Lina Hernandez',
            '',
            JSON.stringify({
              align: 'bsi_lina_payee',
              period: p.period,
              statedBalance: p.statedBalance,
            }),
            'BSI_PAYEE_ALIGN',
            toIsoDate(i.effectiveDate),
            amt,
            0,
            0,
            amt,
            false,
            /humana|aetna|united|devoted/i.test(i.carrier) ? 'MA' : null,
            0,
            null,
            0,
            false,
            null,
            true,
            'lina_align_bsi_payee',
            'Inserted from BSI→Lina payee statement alignment',
          ]
        );
      }
    }

    const after = await loadAlbaAgentRows(p.period);
    const afterSum = round2(
      after.reduce((s, r) => s + Number(r.producer_payable || 0), 0)
    );
    console.log(
      JSON.stringify(
        {
          period: p.period,
          pdfDetailSum: p.pdfSum,
          afterAgentPpSum: afterSum,
          deltaToPdf: round2(afterSum - p.pdfSum),
          updates: p.updates.length,
          inserts: p.inserts.length,
          zeros: p.zeros.length,
        },
        null,
        2
      )
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

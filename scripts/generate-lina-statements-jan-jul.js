#!/usr/bin/env node
'use strict';

/**
 * Generate Lina Hernandez (Alba) Detailed Compensation Statement Excel files
 * for a range of periods — for sharing with BSI / reconciling to her payee PDFs.
 *
 *   node scripts/generate-lina-statements-jan-jul.js
 *   node scripts/generate-lina-statements-jan-jul.js --out /path/to/dir
 *
 * Amounts = producer_payable agent production only (no Agency Override).
 * June/July 2026 were aligned to BSI→Lina PDF detail; earlier months use
 * current DB producer_payable as-is.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const {
  buildLinaCompensationStatement,
  buildLinaCompensationWorkbook,
  filenameForLinaStatement,
} = require('../src/linaCompensationStatement');

const PERIODS = ['202601', '202602', '202603', '202604', '202605', '202606', '202607'];

const BSI_PDF_DETAIL = {
  202606: 1095.59,
  202607: 2290.1,
};

const DEFAULT_OUT = '/opt/cursor/artifacts/lina-statements-jan-jul-2026';

function outDirFromArgs() {
  const i = process.argv.indexOf('--out');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return DEFAULT_OUT;
}

async function fetchLinaRows(pool, period) {
  const { rows } = await pool.query(
    `SELECT id, agent_name, client_full_name, policy_number, carrier, effective_date,
            payment_period, classification, producer_payable, commission, source
     FROM commission_records
     WHERE (
         agent_name ILIKE '%alba%hernandez%'
         OR agent_name ILIKE '%lina%hernandez%'
         OR agent_name ILIKE '%alba%ritela%'
       )
       AND payment_period = $1
       AND COALESCE(producer_payable,0) <> 0
       AND LOWER(COALESCE(classification,'')) NOT LIKE '%override%'
       AND (
         LOWER(COALESCE(classification,'')) LIKE '%new business%'
         OR LOWER(COALESCE(classification,'')) LIKE '%renewal%'
         OR LOWER(COALESCE(classification,'')) LIKE '%chargeback%'
         OR LOWER(COALESCE(classification,'')) LIKE '%agent commission%'
         OR LOWER(TRIM(COALESCE(classification,''))) = 'commission'
       )
     ORDER BY carrier, policy_number, id`,
    [period]
  );
  return rows;
}

async function writeSummaryWorkbook(summaries, outPath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BSI Compare Summary');
  ws.columns = [
    { header: 'Period', key: 'period', width: 12 },
    { header: 'Month', key: 'month', width: 16 },
    { header: 'Lines', key: 'lines', width: 10 },
    { header: 'Gross', key: 'gross', width: 12 },
    { header: 'Chargebacks', key: 'chargebacks', width: 12 },
    { header: 'Balance (THEI template)', key: 'balance', width: 18 },
    { header: 'BSI PDF detail (if known)', key: 'bsiPdf', width: 20 },
    { header: 'Delta vs BSI PDF', key: 'delta', width: 14 },
    { header: 'Excel file', key: 'file', width: 48 },
    { header: 'Notes', key: 'notes', width: 56 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const s of summaries) {
    ws.addRow({
      period: s.period,
      month: s.periodLabel,
      lines: s.lineCount,
      gross: s.gross,
      chargebacks: s.chargebacks,
      balance: s.balance,
      bsiPdf: s.bsiPdf != null ? s.bsiPdf : '',
      delta: s.delta != null ? s.delta : '',
      file: s.filename,
      notes: s.notes,
    });
  }

  ['D', 'E', 'F', 'G', 'H'].forEach((col) => {
    ws.getColumn(col).numFmt = '$#,##0.00;($#,##0.00)';
  });

  const note = wb.addWorksheet('How to read');
  note.getCell('A1').value = 'Lina Hernandez (Alba) — THEI compensation statement templates';
  note.getCell('A1').font = { bold: true, size: 13 };
  note.getCell('A3').value =
    'These Excel files mirror the BSI→Lina Detailed Compensation Statement layout.';
  note.getCell('A4').value =
    'Amounts = agent production only (New Business / Renewal / Chargeback). No Agency Override.';
  note.getCell('A5').value =
    'June & July 2026 Balances were aligned to BSI PDF detail lines (not held Balance gaps).';
  note.getCell('A6').value =
    'Jan–May use current OliComm producer_payable — share with BSI to validate / true-up.';
  note.getCell('A7').value =
    'Going forward: BSI Statements upload + carrier×state rate peel drives these statements.';
  note.getColumn(1).width = 100;

  await wb.xlsx.writeFile(outPath);
}

async function main() {
  const outDir = outDirFromArgs();
  fs.mkdirSync(outDir, { recursive: true });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const summaries = [];
  const reportDate = new Date().toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  try {
    for (const period of PERIODS) {
      const rows = await fetchLinaRows(pool, period);
      const statement = buildLinaCompensationStatement(rows, {
        period,
        reportDate,
      });
      const wb = await buildLinaCompensationWorkbook(statement);
      const filename = filenameForLinaStatement(statement);
      const filePath = path.join(outDir, filename);
      await wb.xlsx.writeFile(filePath);

      const bsiPdf = BSI_PDF_DETAIL[period];
      const delta =
        bsiPdf != null ? Math.round((statement.balance - bsiPdf) * 100) / 100 : null;
      let notes = 'DB producer_payable template — pending BSI PDF compare';
      if (period === '202606' || period === '202607') {
        notes =
          delta === 0
            ? 'Aligned to BSI PDF detail — should match her statement'
            : `Aligned period but delta ${delta} vs known PDF detail`;
      }

      summaries.push({
        period,
        periodLabel: statement.periodLabel,
        lineCount: statement.lineCount,
        gross: statement.gross,
        chargebacks: statement.chargebacks,
        balance: statement.balance,
        bsiPdf: bsiPdf != null ? bsiPdf : null,
        delta,
        filename,
        notes,
      });

      console.log(
        `${period}  lines=${statement.lineCount}  balance=$${statement.balance.toFixed(2)}  → ${filename}`
      );
    }

    const summaryPath = path.join(outDir, 'Lina_Statements_Jan-Jul_2026_SUMMARY.xlsx');
    await writeSummaryWorkbook(summaries, summaryPath);
    console.log(`\nSummary → ${summaryPath}`);
    console.log(`Folder  → ${outDir}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

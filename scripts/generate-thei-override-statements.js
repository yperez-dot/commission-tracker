#!/usr/bin/env node
'use strict';

/**
 * Generate THEI (and optionally BSI) Override Statement Excel files for a period range.
 *
 *   node scripts/generate-thei-override-statements.js
 *   node scripts/generate-thei-override-statements.js --also-bsi
 *   node scripts/generate-thei-override-statements.js --out /path/to/dir
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const { STATEMENT_TYPES } = require('../src/payeeSchedules');
const { buildOverrideStatements } = require('../src/overrideStatementBuilder');
const {
  buildOverrideExcelWorkbook,
  filenameForOverrideExcel,
} = require('../src/overrideExcelStatement');

const PERIODS = ['202601', '202602', '202603', '202604', '202605', '202606', '202607'];
const DEFAULT_OUT = '/opt/cursor/artifacts/thei-override-statements-jan-jul-2026';

function outDirFromArgs() {
  const i = process.argv.indexOf('--out');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return DEFAULT_OUT;
}

const ALSO_BSI = process.argv.includes('--also-bsi');

const SELECT_COLS = `
  id, agent_name, client_full_name, policy_number, carrier, effective_date,
  payment_period, classification, commission, gross_commission, thei_share, bsi_share,
  producer_payable, sub_agent_override, payee, source
`;

async function fetchRows(pool, period) {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS}
     FROM commission_records
     WHERE payment_period = $1
       AND (
         classification ILIKE '%override%'
         OR (
           (agent_name ILIKE '%alba%hernandez%'
            OR agent_name ILIKE '%lina%hernandez%'
            OR agent_name ILIKE '%alba%ritela%')
           AND classification NOT ILIKE '%override%'
           AND classification NOT ILIKE '%held%'
           AND (COALESCE(thei_share,0) <> 0 OR COALESCE(bsi_share,0) <> 0)
         )
       )
     ORDER BY payment_period, agent_name, id`,
    [period]
  );
  return rows;
}

async function writeSummary(summaries, outPath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('THEI Override Summary');
  ws.columns = [
    { header: 'Period', key: 'period', width: 10 },
    { header: 'Month', key: 'month', width: 14 },
    { header: 'Lines', key: 'lines', width: 8 },
    { header: 'THEI Balance', key: 'thei', width: 14 },
    { header: 'BSI Balance (if generated)', key: 'bsi', width: 18 },
    { header: 'THEI file', key: 'theiFile', width: 40 },
    { header: 'Notes', key: 'notes', width: 56 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const s of summaries) {
    ws.addRow(s);
  }
  ws.getColumn('D').numFmt = '$#,##0.00;($#,##0.00)';
  ws.getColumn('E').numFmt = '$#,##0.00;($#,##0.00)';

  const note = wb.addWorksheet('How to read');
  note.getColumn(1).width = 100;
  note.getCell('A1').value = 'THEI Override Statements — Jan–Jul 2026';
  note.getCell('A1').font = { bold: true, size: 13 };
  note.getCell('A3').value =
    'Payable = thei_share on Agency Override rows + Alba/Lina rate-peeled production shares.';
  note.getCell('A4').value =
    'THEI and BSI are 50/50 of the override pot. Lina agent commissions are a separate statement.';
  note.getCell('A5').value =
    'Historical months may include messy / unpeeled data — use for reconcile, not blind payment.';
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
  try {
    for (const period of PERIODS) {
      const rows = await fetchRows(pool, period);
      const theiBundle = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_OVERRIDE, {
        period,
      });
      const theiStmt = theiBundle.statements[0];
      if (!theiStmt) {
        console.log(`${period}  no THEI lines`);
        summaries.push({
          period,
          month: theiBundle.periodLabel,
          lines: 0,
          thei: 0,
          bsi: '',
          theiFile: '',
          notes: 'No THEI override lines',
        });
        continue;
      }

      const theiWb = await buildOverrideExcelWorkbook(theiBundle, theiStmt);
      const theiName = filenameForOverrideExcel(theiBundle, theiStmt.payee);
      await theiWb.xlsx.writeFile(path.join(outDir, theiName));

      let bsiTotal = '';
      if (ALSO_BSI) {
        const bsiBundle = buildOverrideStatements(rows, STATEMENT_TYPES.BSI_OVERRIDE, {
          period,
        });
        const bsiStmt = bsiBundle.statements[0];
        if (bsiStmt) {
          const bsiWb = await buildOverrideExcelWorkbook(bsiBundle, bsiStmt);
          const bsiName = filenameForOverrideExcel(bsiBundle, bsiStmt.payee);
          await bsiWb.xlsx.writeFile(path.join(outDir, bsiName));
          bsiTotal = bsiStmt.total;
        }
      }

      summaries.push({
        period,
        month: theiBundle.periodLabel,
        lines: theiStmt.lineCount,
        thei: theiStmt.total,
        bsi: bsiTotal,
        theiFile: theiName,
        notes: 'Agency Override + Alba peeled shares',
      });

      console.log(
        `${period}  THEI lines=${theiStmt.lineCount}  balance=$${theiStmt.total.toFixed(2)}  → ${theiName}`
      );
    }

    const summaryPath = path.join(outDir, 'THEI_Override_Statements_Jan-Jul_2026_SUMMARY.xlsx');
    await writeSummary(summaries, summaryPath);
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

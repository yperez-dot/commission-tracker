#!/usr/bin/env node
'use strict';

/**
 * EXAMPLE / FIXTURE ONLY — parse a BSI→Alba Detailed Compensation Statement PDF.
 *
 * Do NOT use this to import Alba's monthly pay into production. Those PDFs are
 * the output format we will replicate; Alba pay lines come from our own
 * commission_records via Override Statements → Alba.
 *
 *   node scripts/import-bsi-payee-statement.js --file=/path/to.pdf
 *   (dry-run parse only; --apply is disabled)
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const {
  isBsiPayeeCompensationStatement,
  parseBsiPayeeCompensationStatement,
} = require('../src/bsiPayeeCompensationStatement');

const fileArg = process.argv.find((a) => a.startsWith('--file='));
const FILE = fileArg ? fileArg.split('=').slice(1).join('=') : null;
const UPLOAD_NAME = FILE ? path.basename(FILE).replace(/_[a-f0-9]{4}(?=\.)/i, '') : null;

async function main() {
  if (!FILE || !fs.existsSync(FILE)) {
    console.error('Usage: --file=/path/to.pdf  (parse-only fixture; no DB import)');
    process.exit(1);
  }
  if (process.argv.includes('--apply')) {
    console.error(
      '--apply is disabled. Alba PDFs are format examples only — do not import them as commission feeds.'
    );
    process.exit(1);
  }

  const data = await pdfParse(fs.readFileSync(FILE));
  if (!isBsiPayeeCompensationStatement(data.text, UPLOAD_NAME)) {
    console.error('Not detected as BSI→Alba compensation statement layout');
    process.exit(1);
  }

  const parsed = parseBsiPayeeCompensationStatement(data.text, {
    filename: UPLOAD_NAME,
    agentName: 'Alba Hernandez',
  });

  console.log(
    JSON.stringify(
      {
        note: 'Fixture parse only — not imported. Target OUTPUT format for Alba take-over.',
        file: FILE,
        period: parsed.period,
        statementDate: parsed.statementDate,
        statedBalance: parsed.statedBalance,
        parsedRows: parsed.records.length,
        parsedSum: parsed.commissionSum,
        sample: parsed.records.slice(0, 3),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

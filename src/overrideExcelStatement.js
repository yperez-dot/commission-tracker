'use strict';

/**
 * THEI / BSI Override Statement — Excel export.
 *
 * Payee statements from thei_share / bsi_share:
 *   - Agency Override rows (house 50/50)
 *   - Alba/Lina rate-peeled production shares (Alba-only mess)
 *
 * Lina's agent producer_payable is NOT on these statements.
 */

const ExcelJS = require('exceljs');
const { STATEMENT_TYPES } = require('./payeeSchedules');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatReportDate(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function titleFor(type) {
  if (type === STATEMENT_TYPES.BSI_OVERRIDE) {
    return 'BSI Override Statement';
  }
  return 'THEI Override Statement';
}

function noteFor(type) {
  if (type === STATEMENT_TYPES.BSI_OVERRIDE) {
    return 'BSI 50% of Agency Override pot + Alba rate-peeled production shares. Not agent commissions.';
  }
  return 'THEI 50% of Agency Override pot + Alba rate-peeled production shares. Not agent commissions.';
}

/**
 * Build Excel workbook for one override payee statement (from buildOverrideStatements).
 */
async function buildOverrideExcelWorkbook(bundle, payeeStatement, opts = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OliComm';
  wb.created = new Date();

  const ws = wb.addWorksheet('Override Statement', {
    views: [{ showGridLines: false }],
  });

  ws.columns = [
    { key: 'policy', width: 18 },
    { key: 'client', width: 28 },
    { key: 'carrier', width: 18 },
    { key: 'agent', width: 28 },
    { key: 'effective', width: 12 },
    { key: 'type', width: 16 },
    { key: 'pot', width: 12 },
    { key: 'share', width: 10 },
    { key: 'amount', width: 14 },
    { key: 'schedule', width: 22 },
  ];

  const titleStyle = { font: { bold: true, size: 14, color: { argb: 'FF1A1A1A' } } };
  const mutedStyle = { font: { size: 11, color: { argb: 'FF64748B' } } };
  const headerStyle = {
    font: { bold: true, size: 11, color: { argb: 'FF334155' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } },
    border: { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } },
  };
  const moneyFmt = '$#,##0.00;($#,##0.00)';
  const reportDate = opts.reportDate || formatReportDate(opts.now || new Date());

  ws.mergeCells('A1:J1');
  ws.getCell('A1').value = titleFor(bundle.type);
  ws.getCell('A1').style = titleStyle;

  ws.mergeCells('A2:J2');
  ws.getCell('A2').value = `${bundle.periodLabel} Statement`;
  ws.getCell('A2').style = { font: { bold: true, size: 12 } };

  ws.getCell('A4').value = 'Report Date';
  ws.getCell('A4').style = mutedStyle;
  ws.getCell('B4').value = reportDate;

  ws.getCell('A5').value = 'Payee';
  ws.getCell('A5').style = mutedStyle;
  ws.getCell('B5').value = payeeStatement.payee;

  ws.getCell('A6').value = 'Issued By';
  ws.getCell('A6').style = mutedStyle;
  ws.getCell('B6').value = 'The Health Experts Insurance · OliComm';

  ws.getCell('A7').value = 'Period';
  ws.getCell('A7').style = mutedStyle;
  ws.getCell('B7').value = bundle.periodLabel;

  ws.mergeCells('A9:J9');
  ws.getCell('A9').value = noteFor(bundle.type);
  ws.getCell('A9').style = mutedStyle;

  const amountHeader =
    bundle.type === STATEMENT_TYPES.BSI_OVERRIDE ? 'Payable (BSI share)' : 'Payable (THEI share)';

  const headerRow = ws.getRow(11);
  [
    'Policy #',
    'Client',
    'Carrier',
    'Writing Agent',
    'Effective',
    'Type',
    'Override Pot',
    'Share %',
    amountHeader,
    'Schedule',
  ].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.style = headerStyle;
  });

  const sorted = [...(payeeStatement.lines || [])].sort((a, b) => {
    const ca = String(a.carrier || '').localeCompare(String(b.carrier || ''));
    if (ca) return ca;
    return String(a.policy_number || '').localeCompare(String(b.policy_number || ''));
  });

  let rowIdx = 12;
  for (const l of sorted) {
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = l.policy_number || '';
    row.getCell(2).value = l.client_full_name || '';
    row.getCell(3).value = l.carrier || '';
    row.getCell(4).value = l.writing_agent || l.agent_name || '';
    row.getCell(5).value = l.effective_date || '';
    row.getCell(6).value = l.classification || '';
    row.getCell(7).value = round2(l.override_pot);
    row.getCell(7).numFmt = moneyFmt;
    row.getCell(8).value = l.share_label || '';
    row.getCell(9).value = round2(l.amount);
    row.getCell(9).numFmt = moneyFmt;
    if (l.amount < 0) {
      row.getCell(9).font = { color: { argb: 'FFB91C1C' } };
    }
    row.getCell(10).value = l.schedule || '';
    rowIdx += 1;
  }

  rowIdx += 1;
  const gross = round2(sorted.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0));
  const chargebacks = round2(sorted.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0));
  const balance = round2(payeeStatement.total);

  ws.getCell(`A${rowIdx}`).value = 'Gross';
  ws.getCell(`A${rowIdx}`).font = { bold: true };
  ws.getCell(`I${rowIdx}`).value = gross;
  ws.getCell(`I${rowIdx}`).numFmt = moneyFmt;
  rowIdx += 1;

  ws.getCell(`A${rowIdx}`).value = 'Chargebacks / negatives';
  ws.getCell(`A${rowIdx}`).font = { bold: true };
  ws.getCell(`I${rowIdx}`).value = chargebacks;
  ws.getCell(`I${rowIdx}`).numFmt = moneyFmt;
  rowIdx += 1;

  ws.getCell(`A${rowIdx}`).value = 'Balance due payee';
  ws.getCell(`A${rowIdx}`).font = { bold: true, size: 12 };
  ws.getCell(`I${rowIdx}`).value = balance;
  ws.getCell(`I${rowIdx}`).numFmt = moneyFmt;
  ws.getCell(`I${rowIdx}`).font = { bold: true, size: 12 };

  rowIdx += 2;
  ws.mergeCells(`A${rowIdx}:J${rowIdx}`);
  ws.getCell(`A${rowIdx}`).value =
    'Generated by OliComm · THEI/BSI are 50/50 of override · Lina agent pay is a separate statement';
  ws.getCell(`A${rowIdx}`).style = mutedStyle;

  const sum = wb.addWorksheet('Summary');
  sum.columns = [
    { key: 'k', width: 28 },
    { key: 'v', width: 40 },
  ];
  [
    ['Statement', titleFor(bundle.type)],
    ['Payee', payeeStatement.payee],
    ['Report Date', reportDate],
    ['Period', bundle.periodLabel],
    ['Line Count', sorted.length],
    ['Gross', gross],
    ['Chargebacks / negatives', chargebacks],
    ['Balance due payee', balance],
  ].forEach((pair, i) => {
    sum.getCell(`A${i + 1}`).value = pair[0];
    sum.getCell(`A${i + 1}`).font = { bold: true };
    sum.getCell(`B${i + 1}`).value = pair[1];
    if (i >= 5) sum.getCell(`B${i + 1}`).numFmt = moneyFmt;
  });

  return wb;
}

function filenameForOverrideExcel(bundle, payee) {
  const periodPart =
    bundle.period && bundle.period !== 'all' ? bundle.period : 'ALL';
  const who =
    bundle.type === STATEMENT_TYPES.BSI_OVERRIDE
      ? 'BSI'
      : bundle.type === STATEMENT_TYPES.THEI_OVERRIDE
        ? 'THEI'
        : String(payee || 'Override').replace(/\s+/g, '_');
  return `${who}_Override_Statement_${periodPart}.xlsx`;
}

module.exports = {
  buildOverrideExcelWorkbook,
  filenameForOverrideExcel,
  formatReportDate,
  titleFor,
  noteFor,
};

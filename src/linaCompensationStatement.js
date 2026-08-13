'use strict';

/**
 * Lina Hernandez (Alba) Detailed Compensation Statement — Excel export.
 *
 * Mirrors the BSI payee statement layout THEI is taking over:
 *   Report date, period title, detail lines
 *   (Agency, Company, Policy #, Client Name, Effective Date, Commission),
 *   Balance = sum of detail lines.
 *
 * Amounts = producer_payable agent production only (NB / Renewal / Chargeback).
 * No Agency Override.
 */

const ExcelJS = require('exceljs');
const {
  ALBA_DISPLAY_NAME,
  isAlbaHernandez,
  isAlbaAgentCommission,
} = require('./payeeSchedules');

const ISSUING_AGENCY = 'The Health Experts Insurance';
const WRITING_AGENCY = 'THE HEALTH EXPERTS INSURANCE';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function formatPeriodLabel(p) {
  if (!p) return '';
  const s = String(p).trim();
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  if (/^\d{6}$/.test(s)) {
    const m = parseInt(s.slice(4, 6), 10);
    if (m >= 1 && m <= 12) return `${months[m - 1]} ${s.slice(0, 4)}`;
  }
  return s;
}

function formatReportDate(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function normalizeCarrier(carrier) {
  const c = String(carrier || '').trim();
  if (!c) return '';
  const u = c.toUpperCase();
  if (u.includes('UNITED') || u === 'UHC') return 'UNITED HEALTH CARE';
  if (u.includes('HUMANA')) return 'HUMANA';
  if (u.includes('AETNA')) return 'AETNA';
  if (u.includes('DEVOTED')) return 'DEVOTED';
  return c.toUpperCase();
}

/**
 * Filter commission_records rows to Lina agent-production lines for a period.
 */
function selectLinaAgentRows(rows, period) {
  return (rows || []).filter((r) => {
    if (!isAlbaHernandez(r.agent_name)) return false;
    if (!isAlbaAgentCommission(r.classification)) return false;
    const amt = num(r.producer_payable);
    if (amt === 0) return false;
    if (period && period !== 'all' && String(r.payment_period) !== String(period)) return false;
    return true;
  });
}

/**
 * Build statement model from commission rows.
 */
function buildLinaCompensationStatement(rows, opts = {}) {
  const period = opts.period || 'all';
  const reportDate = opts.reportDate || formatReportDate(opts.now || new Date());
  const periodLabel = period === 'all' ? 'All Periods' : formatPeriodLabel(period);
  const selected = selectLinaAgentRows(rows, period);

  // Stable order: carrier, then policy, then id
  selected.sort((a, b) => {
    const ca = normalizeCarrier(a.carrier).localeCompare(normalizeCarrier(b.carrier));
    if (ca) return ca;
    const pa = String(a.policy_number || '').localeCompare(String(b.policy_number || ''));
    if (pa) return pa;
    return (a.id || 0) - (b.id || 0);
  });

  const lines = selected.map((r) => {
    const amount = round2(num(r.producer_payable));
    return {
      id: r.id,
      agency: WRITING_AGENCY,
      company: normalizeCarrier(r.carrier),
      policyNumber: r.policy_number || '',
      clientName: r.client_full_name || '',
      effectiveDate: r.effective_date || '',
      commission: amount,
      classification: r.classification || '',
      paymentPeriod: r.payment_period || '',
    };
  });

  const balance = round2(lines.reduce((s, l) => s + l.commission, 0));
  const gross = round2(lines.filter((l) => l.commission > 0).reduce((s, l) => s + l.commission, 0));
  const chargebacks = round2(lines.filter((l) => l.commission < 0).reduce((s, l) => s + l.commission, 0));

  return {
    payee: ALBA_DISPLAY_NAME,
    issuedBy: ISSUING_AGENCY,
    title: 'Detailed Compensation Statement',
    periodTitle: period === 'all' ? 'All Periods Statement' : `${periodLabel} Statement`,
    period,
    periodLabel,
    reportDate,
    lineCount: lines.length,
    gross,
    chargebacks,
    balance,
    lines,
    note:
      'Agent production only (New Business / Renewal / Chargeback). Agency Override is not paid to Lina.',
  };
}

/**
 * Build an ExcelJS workbook for the statement.
 */
async function buildLinaCompensationWorkbook(statement) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OliComm';
  wb.created = new Date();

  const ws = wb.addWorksheet('Compensation Statement', {
    views: [{ showGridLines: false }],
  });

  ws.columns = [
    { key: 'agency', width: 32 },
    { key: 'company', width: 22 },
    { key: 'policy', width: 22 },
    { key: 'client', width: 32 },
    { key: 'effective', width: 14 },
    { key: 'commission', width: 14 },
    { key: 'type', width: 16 },
  ];

  const titleStyle = { font: { bold: true, size: 14, color: { argb: 'FF1A1A1A' } } };
  const mutedStyle = { font: { size: 11, color: { argb: 'FF64748B' } } };
  const headerStyle = {
    font: { bold: true, size: 11, color: { argb: 'FF334155' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } },
    border: {
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    },
  };
  const moneyFmt = '$#,##0.00;($#,##0.00)';

  ws.mergeCells('A1:G1');
  ws.getCell('A1').value = statement.title;
  ws.getCell('A1').style = titleStyle;

  ws.mergeCells('A2:G2');
  ws.getCell('A2').value = statement.periodTitle;
  ws.getCell('A2').style = { font: { bold: true, size: 12 } };

  ws.getCell('A4').value = 'Report Date';
  ws.getCell('A4').style = mutedStyle;
  ws.getCell('B4').value = statement.reportDate;

  ws.getCell('A5').value = 'Payee';
  ws.getCell('A5').style = mutedStyle;
  ws.getCell('B5').value = statement.payee;

  ws.getCell('A6').value = 'Issued By';
  ws.getCell('A6').style = mutedStyle;
  ws.getCell('B6').value = statement.issuedBy;

  ws.getCell('A7').value = 'Period';
  ws.getCell('A7').style = mutedStyle;
  ws.getCell('B7').value = statement.periodLabel;

  ws.mergeCells('A9:G9');
  ws.getCell('A9').value = statement.note;
  ws.getCell('A9').style = mutedStyle;

  const headerRow = ws.getRow(11);
  [
    'Agency',
    'Company',
    'Policy #',
    'Client Name',
    'Effective Date',
    'Commission',
    'Type',
  ].forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.style = headerStyle;
  });

  let rowIdx = 12;
  for (const line of statement.lines) {
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = line.agency;
    row.getCell(2).value = line.company;
    row.getCell(3).value = line.policyNumber;
    row.getCell(4).value = line.clientName;
    row.getCell(5).value = line.effectiveDate;
    row.getCell(6).value = line.commission;
    row.getCell(6).numFmt = moneyFmt;
    if (line.commission < 0) {
      row.getCell(6).font = { color: { argb: 'FFB91C1C' } };
    }
    row.getCell(7).value = line.classification;
    rowIdx += 1;
  }

  rowIdx += 1;
  ws.getCell(`A${rowIdx}`).value = 'Gross Commission';
  ws.getCell(`A${rowIdx}`).font = { bold: true };
  ws.getCell(`F${rowIdx}`).value = statement.gross;
  ws.getCell(`F${rowIdx}`).numFmt = moneyFmt;
  rowIdx += 1;

  ws.getCell(`A${rowIdx}`).value = 'Chargebacks';
  ws.getCell(`A${rowIdx}`).font = { bold: true };
  ws.getCell(`F${rowIdx}`).value = statement.chargebacks;
  ws.getCell(`F${rowIdx}`).numFmt = moneyFmt;
  if (statement.chargebacks < 0) {
    ws.getCell(`F${rowIdx}`).font = { bold: true, color: { argb: 'FFB91C1C' } };
  }
  rowIdx += 1;

  ws.getCell(`A${rowIdx}`).value = 'Balance';
  ws.getCell(`A${rowIdx}`).font = { bold: true, size: 12 };
  ws.getCell(`F${rowIdx}`).value = statement.balance;
  ws.getCell(`F${rowIdx}`).numFmt = moneyFmt;
  ws.getCell(`F${rowIdx}`).font = { bold: true, size: 12 };

  rowIdx += 2;
  ws.mergeCells(`A${rowIdx}:G${rowIdx}`);
  ws.getCell(`A${rowIdx}`).value =
    'Generated by OliComm · Same agent pay schedule as BSI · Holds (if any) tracked separately pending BSI confirmation';
  ws.getCell(`A${rowIdx}`).style = mutedStyle;

  // Summary sheet
  const sum = wb.addWorksheet('Summary');
  sum.columns = [
    { key: 'k', width: 28 },
    { key: 'v', width: 36 },
  ];
  const summaryRows = [
    ['Payee', statement.payee],
    ['Issued By', statement.issuedBy],
    ['Report Date', statement.reportDate],
    ['Period', statement.periodLabel],
    ['Line Count', statement.lineCount],
    ['Gross Commission', statement.gross],
    ['Chargebacks', statement.chargebacks],
    ['Balance', statement.balance],
  ];
  summaryRows.forEach((pair, i) => {
    sum.getCell(`A${i + 1}`).value = pair[0];
    sum.getCell(`A${i + 1}`).font = { bold: true };
    sum.getCell(`B${i + 1}`).value = pair[1];
    if (i >= 5) sum.getCell(`B${i + 1}`).numFmt = moneyFmt;
  });

  return wb;
}

function filenameForLinaStatement(statement) {
  const periodPart =
    statement.period && statement.period !== 'all'
      ? statement.period
      : 'ALL';
  const safePayee = String(statement.payee || 'Lina_Hernandez').replace(/\s+/g, '_');
  return `${safePayee}_Compensation_Statement_${periodPart}.xlsx`;
}

module.exports = {
  ISSUING_AGENCY,
  WRITING_AGENCY,
  selectLinaAgentRows,
  buildLinaCompensationStatement,
  buildLinaCompensationWorkbook,
  filenameForLinaStatement,
  formatPeriodLabel,
  formatReportDate,
};

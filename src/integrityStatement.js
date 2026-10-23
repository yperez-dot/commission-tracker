'use strict';

/**
 * Integrity agent statements (Christian Munoz, Horacio Mendieta) in BSI's layout:
 *   - "CARRIER SUMMARY DETAILS" box (one line per carrier + TOTAL)
 *   - one "Detailed Compensation Statement" section per carrier
 *     (Agent / Company / Policy # / Client Name / Effective Date / Commission, Balance)
 * Amount per line = producer_payable (the agent's 50% of the override pot).
 * Munoz's statement also carries CAM Insurance Solutions Corp lines.
 * Monthly: one statement per payment period.
 */

const ExcelJS = require('exceljs');
const { isAgencyOverride } = require('./payeeSchedules');
const { writeAdjustmentsSection } = require('./payrollStatementExtras');

// Chargebacks on Integrity books are stored as 'Chargeback' (not 'Agency Override');
// new sales on BSI UHC / Aetna feeds are 'New Business'. Renewals are never paid.
function isIntegrityLineClass(classification) {
  const c = String(classification || '').toLowerCase();
  return isAgencyOverride(classification) || c.includes('chargeback') || c.includes('new business');
}

const ISSUING_AGENCY = 'The Health Experts Insurance';

const INTEGRITY_PAYEES = Object.freeze({
  'christian-munoz': {
    key: 'christian-munoz',
    displayName: 'Christian Munoz',
    match: ['christian munoz', 'cam insurance solutions corp'],
  },
  'horacio-mendieta': {
    key: 'horacio-mendieta',
    displayName: 'Horacio Mendieta',
    match: ['horacio mendieta'],
  },
});

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function payeeKeyForAgent(agentName) {
  const n = String(agentName || '').toLowerCase().trim();
  for (const p of Object.values(INTEGRITY_PAYEES)) {
    if (p.match.some((m) => n.includes(m))) return p.key;
  }
  return null;
}

function normalizeCarrier(carrier) {
  const c = String(carrier || '').trim();
  if (!c) return 'OTHER';
  const u = c.toUpperCase();
  if (u.includes('UNITED') || u === 'UHC') return 'UNITED HEALTH CARE';
  if (u.includes('HUMANA') || u.includes('DEVOTED')) return 'HUMANA/DEVOTED HEALTH';
  if (u.includes('AETNA')) return 'AETNA';
  return u;
}

const CARRIER_ORDER = ['UNITED HEALTH CARE', 'HUMANA/DEVOTED HEALTH', 'AETNA'];

function formatPeriodLabel(p) {
  const s = String(p || '').trim();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  if (/^\d{6}$/.test(s)) {
    const m = parseInt(s.slice(4, 6), 10);
    if (m >= 1 && m <= 12) return `${months[m - 1]} ${s.slice(0, 4)}`;
  }
  return s || 'All Periods';
}

function formatReportDate(d = new Date()) {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Rows that belong on an Integrity payee's statement for a period. */
function selectIntegrityRows(rows, payeeKey, period) {
  const seen = new Set();
  return (rows || []).filter((r) => {
    if (payeeKeyForAgent(r.agent_name) !== payeeKey) return false;
    if (!isIntegrityLineClass(r.classification)) return false;
    if (num(r.producer_payable) === 0) return false;
    if (period && period !== 'all' && String(r.payment_period) !== String(period)) return false;
    // Collapse exact re-imports of the same line.
    const k = r.id != null ? `id:${r.id}` : [r.agent_name, r.policy_number, r.carrier, r.payment_period, r.producer_payable].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildIntegrityStatement(rows, payeeKey, opts = {}) {
  const payee = INTEGRITY_PAYEES[payeeKey];
  if (!payee) throw new Error(`Unknown Integrity payee: ${payeeKey}`);
  const period = opts.period || 'all';
  const selected = selectIntegrityRows(rows, payeeKey, period);

  const byCarrier = new Map();
  for (const r of selected) {
    const carrier = normalizeCarrier(r.carrier);
    if (!byCarrier.has(carrier)) byCarrier.set(carrier, []);
    byCarrier.get(carrier).push({
      id: r.id,
      agent: r.agent_name || payee.displayName,
      company: carrier,
      policyNumber: r.policy_number || '',
      clientName: r.client_full_name || '',
      effectiveDate: r.effective_date || '',
      commission: round2(num(r.producer_payable)),
      paymentPeriod: r.payment_period || '',
    });
  }

  const carriers = [...byCarrier.keys()].sort((a, b) => {
    const ia = CARRIER_ORDER.indexOf(a); const ib = CARRIER_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });

  const sections = carriers.map((carrier) => {
    const lines = byCarrier.get(carrier).sort((a, b) =>
      a.agent.localeCompare(b.agent) ||
      a.policyNumber.localeCompare(b.policyNumber) ||
      (a.id || 0) - (b.id || 0));
    return { carrier, lines, balance: round2(lines.reduce((s, l) => s + l.commission, 0)) };
  });

  const carrierSummary = sections.map((s) => ({ carrier: s.carrier, total: s.balance }));
  const balance = round2(sections.reduce((s, x) => s + x.balance, 0));
  const lines = sections.flatMap((s) => s.lines);

  return {
    payeeKey,
    payee: payee.displayName,
    issuedBy: ISSUING_AGENCY,
    title: 'Detailed Compensation Statement',
    period,
    periodLabel: period === 'all' ? 'All Periods' : formatPeriodLabel(period),
    periodTitle: period === 'all' ? 'All Periods Statement' : `${formatPeriodLabel(period)} Statement`,
    reportDate: opts.reportDate || formatReportDate(opts.now || new Date()),
    carrierSummary,
    sections,
    lineCount: lines.length,
    gross: round2(lines.filter((l) => l.commission > 0).reduce((s, l) => s + l.commission, 0)),
    chargebacks: round2(lines.filter((l) => l.commission < 0).reduce((s, l) => s + l.commission, 0)),
    balance,
    lines,
  };
}

async function buildIntegrityWorkbook(statement) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OliComm';
  wb.created = new Date();
  const ws = wb.addWorksheet('Compensation Statement', { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 30 }, { width: 26 }, { width: 22 }, { width: 32 }, { width: 14 }, { width: 14 },
  ];
  const money = '$#,##0.00;($#,##0.00)';
  const muted = { font: { size: 11, color: { argb: 'FF64748B' } } };
  const head = {
    font: { bold: true, size: 11, color: { argb: 'FF334155' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } },
    border: { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } },
  };
  const red = { color: { argb: 'FFB91C1C' } };

  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = `${statement.title} — ${statement.payee}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A2:F2');
  ws.getCell('A2').value = statement.periodTitle;
  ws.getCell('A2').font = { bold: true, size: 12 };
  ws.getCell('A3').value = 'Report Date'; ws.getCell('A3').style = muted; ws.getCell('B3').value = statement.reportDate;
  ws.getCell('A4').value = 'Issued By'; ws.getCell('A4').style = muted; ws.getCell('B4').value = statement.issuedBy;

  let r = 6;
  ws.getCell(`A${r}`).value = 'CARRIER SUMMARY DETAILS';
  ws.getCell(`A${r}`).font = { bold: true };
  r += 1;
  for (const c of statement.carrierSummary) {
    ws.getCell(`A${r}`).value = c.carrier;
    ws.getCell(`B${r}`).value = c.total;
    ws.getCell(`B${r}`).numFmt = money;
    if (c.total < 0) ws.getCell(`B${r}`).font = red;
    r += 1;
  }
  ws.getCell(`A${r}`).value = 'TOTAL';
  ws.getCell(`A${r}`).font = { bold: true };
  ws.getCell(`B${r}`).value = statement.balance;
  ws.getCell(`B${r}`).numFmt = money;
  ws.getCell(`B${r}`).font = { bold: true };
  r += 2;

  for (const section of statement.sections) {
    ws.getCell(`A${r}`).value = `${section.carrier} — Detailed Compensation Statement`;
    ws.getCell(`A${r}`).font = { bold: true, size: 12 };
    r += 1;
    ['Agent', 'Company', 'Policy #', 'Client Name', 'Effective Date', 'Commission'].forEach((h, i) => {
      const cell = ws.getRow(r).getCell(i + 1);
      cell.value = h; cell.style = head;
    });
    r += 1;
    for (const l of section.lines) {
      const row = ws.getRow(r);
      row.getCell(1).value = l.agent;
      row.getCell(2).value = l.company;
      row.getCell(3).value = l.policyNumber;
      row.getCell(4).value = l.clientName;
      row.getCell(5).value = l.effectiveDate;
      row.getCell(6).value = l.commission;
      row.getCell(6).numFmt = money;
      if (l.commission < 0) row.getCell(6).font = red;
      r += 1;
    }
    ws.getCell(`A${r}`).value = 'Balance';
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`F${r}`).value = section.balance;
    ws.getCell(`F${r}`).numFmt = money;
    ws.getCell(`F${r}`).font = { bold: true, color: section.balance < 0 ? red.color : undefined };
    r += 2;
  }

  if (statement.adjustments && statement.adjustments.length) {
    r = writeAdjustmentsSection(ws, r, statement, 'F') + 1;
  }

  if (statement.carry && (statement.carry.carryIn !== 0 || statement.carry.net < 0)) {
    ws.getCell(`A${r}`).value = 'Negative balance carried in from prior months';
    ws.getCell(`F${r}`).value = statement.carry.carryIn;
    ws.getCell(`F${r}`).numFmt = money;
    ws.getCell(`F${r}`).font = red;
    r += 1;
    ws.getCell(`A${r}`).value = 'Amount payable this period';
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`F${r}`).value = statement.carry.payable;
    ws.getCell(`F${r}`).numFmt = money;
    ws.getCell(`F${r}`).font = { bold: true };
    r += 1;
    if (statement.carry.carryOut < 0) {
      ws.getCell(`A${r}`).value = 'Negative balance carried to next period';
      ws.getCell(`F${r}`).value = statement.carry.carryOut;
      ws.getCell(`F${r}`).numFmt = money;
      ws.getCell(`F${r}`).font = red;
      r += 1;
    }
    r += 1;
  }

  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = 'Generated by OliComm · Integrity schedule: 50% producer / 25% THEI / 25% BSI';
  ws.getCell(`A${r}`).style = muted;
  return wb;
}

function filenameForIntegrityStatement(statement) {
  const slug = statement.payeeKey;
  const p = statement.period === 'all' ? 'all-periods' : statement.period;
  return `${slug}-statement-${p}.xlsx`;
}

module.exports = {
  INTEGRITY_PAYEES,
  payeeKeyForAgent,
  selectIntegrityRows,
  buildIntegrityStatement,
  buildIntegrityWorkbook,
  filenameForIntegrityStatement,
};

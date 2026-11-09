'use strict';

/**
 * AmeriLife (AML) agency commission CSV — Contracts/CommissionDetails layout
 * paid to The Health Experts Insurance (Humana and similar carriers).
 *
 * Distinct from:
 * - Humana broker-portal CommissionData XML (.xls with GrpName/WaName/FrstYrRnwl)
 * - BSI AML portal imports (Agency Override pot split with BSI)
 *
 * Agent = Writing Agent (normalized). Period = Statement Date month.
 * First Year → New Business, Renewal Year → Renewal; negatives → Chargeback.
 * Commission Type Override with no First Year/Renewal → Agency Override.
 */

const { normalizeAgentName } = require('../routes/normalize');
const { periodFromStatementDate } = require('./periodFormat');

const HOUSE_AGENT = 'The Health Experts Insurance';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseCurrency(val) {
  const s = String(val == null ? '' : val).trim();
  if (!s) return 0;
  const negative = (s.startsWith('(') && s.endsWith(')')) || s.startsWith('-');
  const num = parseFloat(s.replace(/[$,()/]/g, '').replace(/^-/, '')) || 0;
  return negative ? -Math.abs(num) : num;
}

function formatDate(value) {
  if (!value && value !== 0) return '';
  if (value instanceof Date && !isNaN(value)) {
    const mo = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${mo}/${d}/${value.getUTCFullYear()}`;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
      const [y, mo, d] = t.split('-');
      return `${mo}/${d.slice(0, 2)}/${y}`;
    }
    return t;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  return String(value);
}

function isValidClientName(clientName) {
  if (!clientName) return false;
  const name = String(clientName).trim();
  if (!name) return false;
  const lower = name.toLowerCase();
  return !['summary', 'deduction', 'total', 'balance', 'subtotal', 'grand total'].some((a) =>
    lower.includes(a)
  );
}

function isTheiPayee(name) {
  const n = String(name || '').toLowerCase().trim();
  return n.includes('the health experts') || n.includes('health experts insurance');
}

function normalizeCarrier(carrierRaw) {
  const carrierLower = String(carrierRaw || '').toLowerCase();
  if (carrierLower.includes('humana')) return 'Humana';
  if (carrierLower.includes('devoted')) return 'Devoted Health';
  if (carrierLower.includes('wellcare') || carrierLower.includes('well care')) return 'WellCare';
  if (carrierLower.includes('freedom')) return 'Freedom';
  return String(carrierRaw || '').trim() || 'Humana';
}

function derivePlanType(carrier, productRaw, policyNumber) {
  const pt = String(productRaw || '').toLowerCase();
  const pn = String(policyNumber || '').toLowerCase();
  if (carrier === 'Humana') {
    if (pn.includes('_pdp') || pt.includes('pdp')) return 'Humana PDP';
    return 'Humana Med Adv';
  }
  if (carrier === 'Devoted Health' || /devoted/i.test(carrier)) return 'Devoted Med Adv';
  return productRaw || '';
}

function classifyAmeriLifeRow({ commission, firstYearRenewal, commissionType }) {
  const amount = round2(commission);
  if (amount < 0) return 'Chargeback';
  const fyr = String(firstYearRenewal || '').toLowerCase();
  if (fyr.includes('renew')) return 'Renewal';
  if (fyr.includes('first')) return 'New Business';
  const ct = String(commissionType || '').toLowerCase();
  if (ct.includes('override')) return 'Agency Override';
  return 'Agent Commission';
}

function headerSet(headers) {
  return new Set((headers || []).map((h) => String(h || '').trim()));
}

/**
 * AmeriLife Contracts/CommissionDetails CSV layout (not Humana broker-portal XML).
 */
function isAmeriLifeAgencyCsv(headers, opts = {}) {
  const set = headerSet(headers);
  const layout =
    set.has('Writing Agent') &&
    set.has('Policy #') &&
    set.has('Commission Type') &&
    set.has('First Year/Renewal') &&
    set.has('Statement Date') &&
    set.has('Commission ($)') &&
    set.has('Insured Name');
  if (!layout) return false;

  const filename = String(opts.filename || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (filename.includes('amerilife') || /(^|_)aml(_|$)/.test(filename) || filename.includes('contracts_commissiondetails')) {
    return true;
  }

  // Sample rows: THEI is the statement payee (Agent Name).
  const rows = opts.rows || [];
  if (rows.length && rows.some((r) => isTheiPayee(r['Agent Name']))) return true;

  // Humana in filename + this layout (e.g. THEI_AML_HUMANA_….csv) — still AmeriLife CSV,
  // not broker-portal XML (that layout has WaName/GrpName, not Writing Agent).
  if (filename.includes('humana')) return true;

  return layout;
}

function workbookHeadersAndRows(wb) {
  const ws = wb && wb.Sheets && wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [] };
  const rows = XLSXSheetToJson(ws);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

// Lazy XLSX require so unit tests can pass plain row objects without a workbook.
function XLSXSheetToJson(ws) {
  const XLSX = require('xlsx');
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
}

function isAmeriLifeAgencyWorkbook(wb, filename) {
  const { headers, rows } = workbookHeadersAndRows(wb);
  return isAmeriLifeAgencyCsv(headers, { filename, rows });
}

/**
 * Parse already-object rows (sheet_to_json output).
 */
function parseAmeriLifeAgencyRows(rawRows, opts = {}) {
  const filename = opts.filename || '';
  const records = [];

  for (const row of rawRows || []) {
    const insuredName = String(row['Insured Name'] || '').trim();
    const policyNumber = String(row['Policy #'] || '').trim();
    const statementPayee = String(row['Agent Name'] || '').trim();
    const writingAgentRaw = String(row['Writing Agent'] || '').trim();
    const commissionType = String(row['Commission Type'] || '').trim();
    const firstYearRenewal = String(row['First Year/Renewal'] || '').trim();
    const statusRaw = String(row['Status'] || '').trim();
    const commission = round2(parseCurrency(row['Commission ($)']));
    const statementDate = row['Statement Date'] ?? '';
    const originalEffDate = row['Original EffectiveDate'] || row['Effective Date'] || '';
    const carrierRaw = String(row['Carrier'] || '').trim();
    const productRaw = String(row['Product'] || '').trim();
    const stateRaw = String(row['State'] || '').trim();

    if (!isValidClientName(insuredName)) continue;
    if (!policyNumber) continue;
    if (!commission) continue;

    const carrier = normalizeCarrier(carrierRaw);
    const period = periodFromStatementDate(statementDate) || 'Unknown';
    const agent = writingAgentRaw
      ? (normalizeAgentName(writingAgentRaw) || writingAgentRaw)
      : HOUSE_AGENT;

    const classification = classifyAmeriLifeRow({
      commission,
      firstYearRenewal,
      commissionType,
    });

    let mga = '';
    if (statusRaw === 'Open') mga = 'Held — Open status';
    else if (/hold/i.test(statusRaw)) mga = 'Held — Hold Commission status';

    records.push({
      agent,
      carrier,
      planType: derivePlanType(carrier, productRaw, policyNumber),
      client: insuredName,
      effectiveDate: formatDate(originalEffDate),
      premium: 0,
      commission,
      classification,
      period,
      policyNumber,
      payee: carrier === 'Humana' ? 'Humana' : carrier || 'Humana',
      statementPayee,
      memberState: stateRaw,
      mga,
      source: 'AmeriLife',
      statementDate: formatDate(statementDate),
      raw: row,
    });
  }

  return records;
}

function parseAmeriLifeAgencyWorkbook(wb, filename) {
  const { rows } = workbookHeadersAndRows(wb);
  return parseAmeriLifeAgencyRows(rows, { filename });
}

module.exports = {
  HOUSE_AGENT,
  isAmeriLifeAgencyCsv,
  isAmeriLifeAgencyWorkbook,
  parseAmeriLifeAgencyRows,
  parseAmeriLifeAgencyWorkbook,
  classifyAmeriLifeRow,
  parseCurrency,
};

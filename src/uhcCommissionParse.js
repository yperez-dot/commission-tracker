'use strict';

/**
 * UnitedHealthcare Excel parsers (direct 706381 + THEI / 2737247).
 * UAD Activity is stored on `uadActivity` and is never added to `commission`.
 */

const XLSX = require('xlsx');
const { normalizeAgentName } = require('../routes/normalize');
const { resolveBsiRowPeriod } = require('./periodFormat');
const {
  parseUhcMoney,
  applyUhcUad,
  isUHCFilename,
  isUHCDirectFilename,
  parseUhcAppointmentFee,
  isExcludedFeeClassification,
} = require('./uhcUad');

function isValidClientName(clientName) {
  if (!clientName) return false;
  const name = String(clientName).trim();
  if (name === '') return false;
  const lower = name.toLowerCase();
  const artifacts = ['summary', 'deduction', 'total', 'balance', 'subtotal', 'grand total'];
  for (const artifact of artifacts) {
    if (lower.includes(artifact)) return false;
  }
  return true;
}

function isAgencyName(name) {
  const n = String(name || '').toLowerCase().trim();
  return n.includes('the health experts') || n.includes('health experts insurance');
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const y = value.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  if (typeof value === 'string') {
    if (value.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) return value;
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
      const [y, m, d] = value.split('-');
      return `${m}/${d}/${y}`;
    }
    if (value.match(/^\d{8}$/) && parseInt(value.slice(0, 4), 10) > 1900) {
      const y = value.slice(0, 4);
      const m = value.slice(4, 6);
      const d = value.slice(6, 8);
      return `${m}/${d}/${y}`;
    }
    return value;
  }
  if (typeof value === 'number') {
    const s = String(value);
    if (s.match(/^\d{8}$/) && parseInt(s.slice(0, 4), 10) > 1900) {
      const y = s.slice(0, 4);
      const m = s.slice(4, 6);
      const d = s.slice(6, 8);
      return `${m}/${d}/${y}`;
    }
    if (s.match(/^\d{6}$/) && parseInt(s.slice(0, 4), 10) > 1900) return s;
    const date = new Date((value - 25569) * 86400 * 1000);
    if (isNaN(date.getTime()) || date.getUTCFullYear() > 2100) return String(value);
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  return String(value);
}

function uhcPlanType(rawPlanType) {
  const pt = String(rawPlanType || '').toLowerCase().trim();
  if (pt.includes('partd') || pt.includes('part d') || pt.includes('pdp')) return 'UnitedHealthcare PDP';
  if (pt.includes('medsup') || pt.includes('modmedsup') || pt.includes('supplement')) {
    return 'UnitedHealthcare Med Supp';
  }
  if (['mapd', 'dsnp', 'csnp'].includes(pt) || pt.includes('med adv') || pt.includes('advantage')) {
    return 'UnitedHealthcare Med Adv';
  }
  return 'UnitedHealthcare Med Adv';
}

function periodFromFilename(filename) {
  if (!filename) return null;
  const monthMap = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };
  const fnLower = filename.toLowerCase();
  for (const [month, num] of Object.entries(monthMap)) {
    if (fnLower.includes(month)) {
      const yearMatch = filename.match(/(20\d{2})/);
      if (yearMatch) return yearMatch[1] + num;
    }
  }
  const dotted = filename.match(/(?:^|[_\s.-])(\d{1,2})[.](20\d{2})(?:[_\s.-]|$)/);
  if (dotted) {
    const mo = String(dotted[1]).padStart(2, '0');
    if (mo >= '01' && mo <= '12') return dotted[2] + mo;
  }
  return null;
}

function transactionSheetRows(wb, raw) {
  if (!wb || !wb.SheetNames) return [];
  const sheetName = wb.SheetNames.find((s) => String(s).toLowerCase().includes('commission trans'))
    || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: raw !== false });
}

function isUHCWorkbook(wb) {
  if (!wb || !Array.isArray(wb.SheetNames)) return false;
  const sheetName = wb.SheetNames.find((s) => String(s).toLowerCase().includes('commission trans'));
  if (!sheetName) return false;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: true });
  if (!rows.length) return false;
  const keys = Object.keys(rows[0]).map((k) => String(k).toLowerCase());
  const hasUad = keys.includes('uad activity');
  const hasUhcCols = keys.includes('writing agent name')
    && keys.includes('member name')
    && keys.includes('policy number')
    && keys.includes('commission');
  return hasUad || hasUhcCols;
}

function classifyUhcAction(commAction, commission) {
  if (commission < 0) return 'Chargeback';
  const actionLower = String(commAction || '').toLowerCase();
  if (actionLower === 'new' || actionLower.includes('initial')) return 'New Business';
  if (actionLower === 'renewal' || actionLower.includes('renewal')) return 'Renewal';
  if (actionLower.includes('chargeback')) return 'Chargeback';
  return 'Agent Commission';
}

/**
 * THEI / agency UHC statement (Commission Transactions). Keeps every member row,
 * including Commission $0 rows that carry UAD recoup.
 */
function writingAgentOf(row) {
  const writingAgentRaw = String(row['Writing Agent Name'] || row['Agent Name'] || '').trim();
  if (isAgencyName(writingAgentRaw)) return 'The Health Experts Insurance';
  return normalizeAgentName(writingAgentRaw) || writingAgentRaw;
}

function parseUHCRows(wb, filename) {
  const records = [];
  const statementPeriod = periodFromFilename(filename);
  const rows = transactionSheetRows(wb, true);

  for (const row of rows) {
    const statementDate = formatDate(row['Statement Date']);
    const period = String(resolveBsiRowPeriod(row, statementPeriod) || '');
    const fee = parseUhcAppointmentFee(row);
    if (fee) {
      records.push({
        agent: writingAgentOf(row),
        carrier: 'UnitedHealthcare',
        planType: '',
        client: fee.client,
        effectiveDate: statementDate,
        premium: 0,
        commission: fee.commission,
        classification: fee.classification,
        period,
        policyNumber: fee.policyNumber,
        statementDate,
        mga: fee.mga,
        splitApplies: false,
        producerPayable: 0,
        theiShare: 0,
        bsiShare: 0,
        grossCommission: 0,
        raw: row,
      });
      continue;
    }

    const client = String(row['Member Name'] || '').trim();
    const commission = parseUhcMoney(row['Commission']);
    const policyNumber = String(row['Policy Number'] || '').trim();
    const effectiveDate = formatDate(row['Original Effective Date']);
    const rawPlanType = String(row['Plan Type'] || '').trim();
    const commAction = String(row['Commission Action'] || '').trim();

    if (!isValidClientName(client)) continue;

    const clientLower = client.toLowerCase();
    if (clientLower.includes('commission earned') ||
        clientLower.includes('chargebacks') ||
        clientLower.includes('applied to balance') ||
        clientLower.includes('total commission') ||
        clientLower.includes('payment received')) {
      continue;
    }

    const planType = uhcPlanType(rawPlanType);
    const classification = classifyUhcAction(commAction, commission);

    const record = {
      agent: writingAgentOf(row),
      carrier: 'UnitedHealthcare',
      planType,
      client,
      effectiveDate,
      premium: parseUhcMoney(row['Prem Amount']),
      commission,
      classification,
      period,
      policyNumber,
      statementDate,
      raw: row,
    };
    applyUhcUad(record, row);
    records.push(record);
  }

  return records;
}

/**
 * UHC Direct (706381) — MedSup + Part D only. MA/DSNP/CSNP come through BSI.
 * Commission $0 rows are kept when they have nonzero UAD Activity.
 */
function parseUHCDirectRows(wb, filename) {
  const records = [];
  try {
    const sheetName = wb.SheetNames.find((s) => String(s).toLowerCase().includes('commission trans'));
    if (!sheetName) return records;

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

    for (const row of rows) {
      const writingAgentRaw = String(row['Writing Agent Name'] || row['Agent Name'] || '').trim();
      const client = String(row['Member Name'] || row['Client Name'] || '').trim();
      const policyNumber = String(row['Policy Number'] || row['Member ID'] || '').trim();
      const effectiveDate = formatDate(row['Original Effective Date'] || row['Effective Date']);
      const statementDate = formatDate(row['Statement Date']);
      const period = String(row['Payment Period'] || row['Period'] || '').trim();
      const rawPlanType = String(row['Plan Type'] || row['Product'] || '').trim();
      const commAction = String(row['Commission Action'] || row['Transaction Type'] || '').trim();
      const commission = parseUhcMoney(row['Commission'] || row['Commission Amount']);
      const uadProbe = applyUhcUad({ commission, raw: row }, row);

      if (!isValidClientName(client)) continue;
      if (commission === 0 && !(uadProbe && uadProbe.uadActivity)) continue;

      const planTypeLower = rawPlanType.toLowerCase();
      if (planTypeLower.includes('mapd') || planTypeLower.includes('dsnp') || planTypeLower.includes('csnp') || planTypeLower.includes('ma ')) {
        continue;
      }
      if (!planTypeLower.includes('aarpmodmedsup') && !planTypeLower.includes('partd') && !planTypeLower.includes('part d') && !planTypeLower.includes('pdp')) {
        continue;
      }

      let planType = 'UHC MedSup';
      if (planTypeLower.includes('partd') || planTypeLower.includes('part d') || planTypeLower.includes('pdp')) {
        planType = 'UHC Part D';
      } else if (planTypeLower.includes('aarpmodmedsup') || planTypeLower.includes('medsup')) {
        planType = 'UHC MedSup';
      }

      const record = {
        agent: normalizeAgentName(writingAgentRaw) || 'Katy Robles',
        carrier: 'UnitedHealthcare',
        planType,
        client,
        effectiveDate,
        premium: 0,
        commission,
        classification: classifyUhcAction(commAction, commission),
        period,
        policyNumber,
        statementDate,
        payee: 'UnitedHealthcare',
        lob: planTypeLower.includes('partd') || planTypeLower.includes('part d') ? 'PDP' : 'MedSup',
        raw: row,
      };
      applyUhcUad(record, row);
      records.push(record);
    }
  } catch (err) {
    console.error('[UHC-DIRECT] Parser error:', err.message);
  }
  return records;
}

function uadTotals(records) {
  let commission = 0;
  let commissionExclFees = 0;
  let fees = 0;
  let feeRows = 0;
  let uadActivity = 0;
  let uadRows = 0;
  for (const r of records || []) {
    const amt = parseUhcMoney(r.commission);
    commission += amt;
    if (isExcludedFeeClassification(r.classification)) {
      fees += amt;
      feeRows += 1;
    } else {
      commissionExclFees += amt;
    }
    const uad = parseUhcMoney(r.uadActivity);
    uadActivity += uad;
    if (uad !== 0) uadRows += 1;
  }
  return {
    rowCount: (records || []).length,
    commission: Math.round(commission * 100) / 100,
    commissionExclFees: Math.round(commissionExclFees * 100) / 100,
    fees: Math.round(fees * 100) / 100,
    feeRows,
    uadActivity: Math.round(uadActivity * 100) / 100,
    uadRows,
  };
}

module.exports = {
  parseUHCRows,
  parseUHCDirectRows,
  isUHCFile: isUHCFilename,
  isUHCDirectFile: isUHCDirectFilename,
  isUHCWorkbook,
  uhcPlanType,
  formatDate,
  uadTotals,
};

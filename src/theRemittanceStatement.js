'use strict';

/**
 * BSI → THE remittance statements (e.g. "JULY - THE" / T.H.E_STATEMENTS.csv).
 *
 * Columns: AGENT, COMPANY, POLICY #, CLIENT NAME, EFFECTIVE DATE, COMMISION
 * Amount = THEI remittance (already THEI's 50% half, or THEI's 25% on Integrity).
 */

const XLSX = require('xlsx');
const { splitTheRemittanceHalf, round2 } = require('./overrideSplitMath');
const { isIntegrityAgent } = require('./payeeSchedules');

const MONTHS = {
  january: '01', jan: '01', enero: '01',
  february: '02', feb: '02', febrero: '02',
  march: '03', mar: '03', marzo: '03',
  april: '04', apr: '04', abril: '04',
  may: '05', mayo: '05',
  june: '06', jun: '06', junio: '06',
  july: '07', jul: '07', julio: '07',
  august: '08', aug: '08', agosto: '08',
  september: '09', sep: '09', sept: '09', septiembre: '09',
  october: '10', oct: '10', octubre: '10',
  november: '11', nov: '11', noviembre: '11',
  december: '12', dec: '12', diciembre: '12',
};

function periodFromTheRemittanceTitle(title, filename, now = new Date()) {
  const t = String(title || '').toLowerCase();
  const f = String(filename || '').toLowerCase();
  let month = null;
  for (const [name, num] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${name}\\b`).test(t) || new RegExp(`\\b${name}\\b`).test(f)) {
      month = num;
      break;
    }
  }
  const yearMatch = t.match(/\b(20\d{2})\b/) || f.match(/\b(20\d{2})\b/);
  let year = yearMatch ? yearMatch[1] : null;
  if (!month) return 'Unknown';
  if (!year) {
    const yNow = now.getUTCFullYear();
    const mNow = now.getUTCMonth() + 1;
    const mNum = parseInt(month, 10);
    year = String(mNum <= mNow ? yNow : yNow - 1);
  }
  return `${year}${month}`;
}

function isTheRemittanceSheetRows(rows) {
  if (!rows || !rows.length) return false;
  const title = String((rows[0] && rows[0][0]) || '').toUpperCase();
  if (
    /\bTHE\b/.test(title) &&
    /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)/.test(title)
  ) {
    return true;
  }
  const header = (rows.find((r) => String(r[0] || '').toUpperCase() === 'AGENT') || []).map((c) =>
    String(c || '').toUpperCase()
  );
  const joined = header.join('|');
  return (
    joined.includes('AGENT') &&
    joined.includes('COMPANY') &&
    joined.includes('CLIENT') &&
    (joined.includes('COMMISION') || joined.includes('COMMISSION'))
  );
}

function isTheRemittanceStatement(wb, filename) {
  const f = String(filename || '').toLowerCase().replace(/\s+/g, '_');
  if (
    /t\.?h\.?e[_\s.-]*statement/.test(f) ||
    /the_statements?/.test(f) ||
    /thei_statement_bsi/.test(f)
  ) {
    return true;
  }
  try {
    if (!wb || !wb.SheetNames) return false;
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, range: 0 });
      if (isTheRemittanceSheetRows(rows)) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function formatDate(value) {
  if (!value && value !== 0) return '';
  if (typeof value === 'string') {
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) return value;
    return value;
  }
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    if (isNaN(date.getTime()) || date.getUTCFullYear() > 2100) return String(value);
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${m}/${d}/${y}`;
  }
  return String(value);
}

function normalizeAgentName(raw) {
  let s = String(raw || '').trim().replace(/^Mr\.\s+/i, '');
  if (!s) return '';
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim());
    s = `${parts[1] || ''} ${parts[0] || ''}`.trim();
  }
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCarrier(company) {
  const c = String(company || '').trim().toUpperCase();
  if (!c) return 'Unknown';
  if (c === 'UNITED' || c.includes('UNITED HEALTH') || c === 'UHC') return 'UnitedHealthcare';
  if (c.includes('HUMANA')) return 'Humana';
  if (c.includes('AETNA')) return 'Aetna';
  if (c.includes('DEVOTED')) return 'Devoted';
  return company;
}

function isValidClientName(clientName) {
  const s = String(clientName || '').trim();
  if (!s) return false;
  if (/^total$/i.test(s)) return false;
  if (s.length < 2) return false;
  return true;
}

function derivePlanType(carrier, policyNumber) {
  const p = String(policyNumber || '');
  if (/_HMO/i.test(p)) return `${carrier} HMO`;
  if (/_PPO/i.test(p)) return `${carrier} PPO`;
  if (/_MA\b|_MA$/i.test(p) || /_MA$/i.test(p)) return `${carrier} MAPD`;
  if (/_PDP/i.test(p)) return `${carrier} PDP`;
  if (/MSup|MSUP/i.test(p)) return `${carrier} MedSupp`;
  return `${carrier} MAPD`;
}

/**
 * Parse one sheet of a remittance workbook.
 * Period prefers title ("MAY - THE"), then sheet name, then filename.
 */
function parseTheRemittanceSheet(ws, filename, sheetName) {
  const records = [];
  if (!ws || !ws['!ref']) return records;

  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (!isTheRemittanceSheetRows(rawRows.map((r) => (r || []).map((c) => (c == null ? '' : c))))) {
    // Still try if sheet name looks like a month (MAY / JUNE / JULY)
    if (!periodFromTheRemittanceTitle(sheetName || '', filename) || periodFromTheRemittanceTitle(sheetName || '', filename) === 'Unknown') {
      const hasAgent = rawRows.some((r) => String(r[0] || '').toUpperCase().trim() === 'AGENT');
      if (!hasAgent) return records;
    }
  }

  const title = String((rawRows[0] && rawRows[0][0]) || '');
  let period = periodFromTheRemittanceTitle(title, filename);
  if (!period || period === 'Unknown') {
    period = periodFromTheRemittanceTitle(sheetName || '', filename);
  }
  if (!period || period === 'Unknown') {
    period = periodFromTheRemittanceTitle('', filename);
  }

  let headerIdx = rawRows.findIndex((r) => String(r[0] || '').toUpperCase().trim() === 'AGENT');
  if (headerIdx < 0) headerIdx = 1;

  const header = (rawRows[headerIdx] || []).map((h) => String(h || '').toLowerCase().replace(/[^a-z#]/g, ''));
  const col = (names) => {
    for (const n of names) {
      const i = header.findIndex((h) => h === n || h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iAgent = col(['agent']);
  const iCompany = col(['company', 'carrier']);
  const iPolicy = col(['policy#', 'policy', 'policynumber']);
  const iClient = col(['clientname', 'client', 'member']);
  const iEff = col(['effectivedate', 'effective']);
  const iAmt = col(['commision', 'commission', 'amount']);

  for (let r = headerIdx + 1; r < rawRows.length; r++) {
    const row = rawRows[r] || [];
    const agentRaw = String(iAgent >= 0 ? row[iAgent] : '').trim();
    const company = String(iCompany >= 0 ? row[iCompany] : '').trim();
    const policyNumber = String(iPolicy >= 0 ? row[iPolicy] : '').trim();
    const clientRaw = String(iClient >= 0 ? row[iClient] : '').trim();
    const amountRaw = iAmt >= 0 ? row[iAmt] : '';

    if (!agentRaw && !clientRaw) continue;
    if (/^total$/i.test(agentRaw) || /^total$/i.test(String(row[4] || ''))) continue;

    let amount = 0;
    if (typeof amountRaw === 'number') amount = amountRaw;
    else {
      amount =
        parseFloat(
          String(amountRaw || '')
            .replace(/[$,()\s]/g, '')
            .replace(/^\((.*)\)$/, '-$1')
        ) || 0;
    }

    if (!clientRaw && amount && String(row[4] || '').toUpperCase() === 'TOTAL') continue;
    if (!isValidClientName(clientRaw)) continue;
    if (!amount) continue;

    const carrier = normalizeCarrier(company);
    const agent = normalizeAgentName(agentRaw) || agentRaw;
    const effectiveDate = formatDate(iEff >= 0 ? row[iEff] : '');
    const classification = amount < 0 ? 'Chargeback' : 'Agency Override';

    let theiShare;
    let bsiShare;
    let producerPayable = 0;
    let grossCommission;
    let splitApplies = true;
    const subAgentOverride = 0;

    if (isIntegrityAgent(agent)) {
      theiShare = round2(amount);
      bsiShare = round2(amount);
      producerPayable = round2(amount * 2);
      grossCommission = round2(amount * 4);
      splitApplies = false;
    } else {
      const split = splitTheRemittanceHalf(amount);
      theiShare = split.theiShare;
      bsiShare = split.bsiShare;
      grossCommission = split.grossCommission;
      producerPayable = 0;
      splitApplies = true;
    }

    records.push({
      agent,
      carrier,
      planType: derivePlanType(carrier, policyNumber),
      client: clientRaw.includes(',') ? normalizeAgentName(clientRaw) || clientRaw : clientRaw,
      effectiveDate,
      premium: 0,
      commission: theiShare,
      classification,
      period,
      policyNumber,
      payee: 'BSI',
      source: 'BSI',
      policyWrittenDate: effectiveDate,
      grossCommission,
      theiShare,
      bsiShare,
      producerPayable,
      splitApplies,
      subAgentOverride,
      lob: /humana|aetna|united|devoted/i.test(carrier) ? 'MA' : null,
      sheetName: sheetName || null,
      raw: { agentRaw, company, policyNumber, clientRaw, amount, title, sheetName },
    });
  }

  return records;
}

/**
 * Parse all sheets in a remittance workbook (May / June / July tabs, etc.).
 */
function parseTheRemittanceStatement(wb, filename) {
  const records = [];
  if (!wb || !wb.SheetNames) return records;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const sheetRecords = parseTheRemittanceSheet(ws, filename, sheetName);
    records.push(...sheetRecords);
  }
  return records;
}

module.exports = {
  isTheRemittanceStatement,
  periodFromTheRemittanceTitle,
  parseTheRemittanceStatement,
  parseTheRemittanceSheet,
};

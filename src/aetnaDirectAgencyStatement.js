'use strict';

/**
 * Aetna DIRECT agency statements paid to THE HEALTH EXPERTS INSURANCE (not via BSI).
 * Portal downloads are Excel 97 BIFF .xls (SheetJS reads them). Also accepts a
 * reformatted .xlsx with Policy Number / Member Name / Plan Type columns.
 */

const path = require('path');
const XLSX = require('xlsx');
const { periodFromStatementDate, parsePeriodInput } = require('./periodFormat');
const { normalizeAgentName } = require('../routes/normalize');
const { normalizeStatementDate } = require('./uhcUad');

const HOUSE_AGENT = 'The Health Experts Insurance';

function parseMoney(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') {
    if (!isFinite(raw)) return 0;
    return Math.round(raw * 100) / 100;
  }
  let s = String(raw).trim();
  if (!s) return 0;
  let neg = false;
  if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.charAt(0) === '-') {
    neg = true;
    s = s.slice(1);
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return Math.round((neg ? -n : n) * 100) / 100;
}

function compactHeader(s) {
  return String(s || '').toLowerCase().replace(/[\s_./]+/g, '');
}

function cellStr(v) {
  return String(v == null ? '' : v).replace(/\u00a0/g, ' ').trim();
}

function isAetnaDirectAgencyFilename(filename) {
  const base = path.basename(String(filename || '')).toLowerCase();
  const f = base.replace(/\s+/g, '_');
  if (f.includes('aetna_bsi') || f.includes('bsi_aetna') || f.includes('producerstatement')) return false;
  if (f.includes('thei_aetna') || f.includes('thei-aetna')) return true;
  if (/^aet\d/i.test(base)) return true;
  if (f.includes('aetna') && (f.includes('direct') || /\.xls$/.test(f))) return true;
  return false;
}

function findHeaderMeta(aoa) {
  for (let i = 0; i < aoa.length; i++) {
    const cells = (aoa[i] || []).map((c) => compactHeader(c));
    const joined = cells.join('|');
    const hasCustomer = cells.indexOf('customernumber') !== -1 && cells.indexOf('customername') !== -1;
    const hasPortalCols = hasCustomer && (cells.indexOf('commissionplan') !== -1 || cells.indexOf('netcompensation') !== -1);
    const hasReform = cells.indexOf('policynumber') !== -1 && cells.indexOf('membername') !== -1
      && (joined.indexOf('commissionaction') !== -1 || joined.indexOf('netcommission') !== -1 || joined.indexOf('plantype') !== -1);
    if (hasPortalCols || hasReform) {
      const index = {};
      for (let c = 0; c < cells.length; c++) {
        if (cells[c]) index[cells[c]] = c;
      }
      return { row: i, index, kind: hasPortalCols ? 'portal' : 'reformatted' };
    }
  }
  return null;
}

function isAetnaDirectAgencyWorkbook(wb) {
  if (!wb || !wb.SheetNames || !wb.SheetNames.length) return false;
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return false;
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  if (!aoa.length) return false;
  const header = findHeaderMeta(aoa);
  if (header) return true;
  const blob = aoa.slice(0, 12).map((r) => (r || []).map(cellStr).join(' ')).join('\n');
  return /Statement Date:/i.test(blob) && /Customer Number/i.test(blob) && /Commission Plan/i.test(blob);
}

function col(row, index, names) {
  for (let i = 0; i < names.length; i++) {
    const key = compactHeader(names[i]);
    if (index[key] != null) return row[index[key]];
  }
  return '';
}

function formatMemberName(raw) {
  const s = cellStr(raw);
  if (!s) return '';
  if (s.indexOf(',') !== -1) {
    const parts = s.split(',');
    const last = parts[0].trim();
    const first = parts.slice(1).join(',').trim();
    const full = `${first} ${last}`.trim();
    return full.replace(/[A-Za-z]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  return s.replace(/[A-Za-z]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function parseCommissionPlan(text) {
  const s = cellStr(text);
  const u = s.toUpperCase();
  let planType = 'Aetna Med Adv';
  let lob = 'MA';
  if (u.indexOf('PDP') !== -1) {
    planType = 'Aetna PDP';
    lob = 'PDP';
  } else if (u.indexOf('MAPD') !== -1) {
    planType = 'Aetna MAPD';
    lob = 'MA';
  } else if (u.indexOf('DSNP') !== -1) {
    planType = 'Aetna DSNP';
    lob = 'MA';
  }
  let classification = 'Agent Commission';
  if (/chargeback/i.test(s)) classification = 'Chargeback';
  else if (/\bnew\s+business\b/i.test(s) || /\bnew\b/i.test(s)) classification = 'New Business';
  else if (/renewal/i.test(s)) classification = 'Renewal';
  return { planType, lob, classification };
}

function extractHeaderBlock(aoa, headerRow) {
  let agency = '';
  let statementRaw = '';
  for (let i = 0; i < headerRow; i++) {
    const row = aoa[i] || [];
    const a = cellStr(row[0]);
    const b = cellStr(row[1]);
    if (!agency && /health\s+experts/i.test(a)) agency = a;
    const joined = `${a} ${b}`;
    const m = joined.match(/Statement\s+Date:\s*(.+)$/i);
    if (m) statementRaw = cellStr(m[1]);
    else if (/^statement\s*date$/i.test(a) && b) statementRaw = b;
  }
  return { agency, statementRaw };
}

function statementToDisplay(raw) {
  const s = cellStr(raw);
  if (!s) return '';
  const long = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (long) {
    const months = {
      january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
      april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
      august: '08', aug: '08', september: '09', sep: '09', sept: '09',
      october: '10', oct: '10', november: '11', nov: '11', december: '12', dec: '12',
    };
    const mo = months[long[1].toLowerCase()];
    if (mo) return `${mo}/${String(long[2]).padStart(2, '0')}/${long[3]}`;
  }
  return normalizeStatementDate(s) || s;
}

function parseAetnaDirectAgencyStatement(wb, filename) {
  const records = [];
  if (!wb || !wb.SheetNames || !wb.SheetNames.length) return records;
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return records;
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const header = findHeaderMeta(aoa);
  if (!header) return records;
  const block = extractHeaderBlock(aoa, header.row);
  let statementDate = statementToDisplay(block.statementRaw);
  let period = periodFromStatementDate(statementDate) || periodFromStatementDate(block.statementRaw) || '';
  let netCheck = null;
  let pastSubtotal = false;
  const idx = header.index;

  for (let r = header.row + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const labels = row.map((c) => cellStr(c).toLowerCase());
    const joined = labels.join(' ');
    if (labels.some((c) => c === 'subtotal')) {
      const subtotal = parseMoney(col(row, idx, ['Net Compensation', 'Net Commission', 'Commission']) || row[row.length - 1]);
      records.subtotal = subtotal;
      pastSubtotal = true;
      continue;
    }
    if (/netcheck|net check|eft/i.test(joined)) {
      netCheck = parseMoney(col(row, idx, ['Net Compensation', 'Net Commission']) || row[row.length - 1]);
      break;
    }
    if (pastSubtotal) continue;
    if (/^adjustments?$/.test(joined.trim()) || labels.every((c) => !c)) continue;

    const policyNumber = cellStr(col(row, idx, ['Customer Number', 'Policy Number', 'Member ID']));
    const memberRaw = col(row, idx, ['Customer Name', 'Member Name']);
    const client = formatMemberName(memberRaw);
    if (!policyNumber && !client) continue;
    if (/^total|grand total|subtotal/.test(cellStr(memberRaw).toLowerCase())) continue;

    const planRaw = col(row, idx, ['Commission Plan', 'Plan Type']);
    const actionRaw = col(row, idx, ['Commission Action']);
    const parsedPlan = parseCommissionPlan(`${planRaw} ${actionRaw}`);
    if (actionRaw && !/chargeback|renewal|new/i.test(cellStr(planRaw))) {
      const fromAction = parseCommissionPlan(actionRaw);
      parsedPlan.classification = fromAction.classification;
      if (cellStr(planRaw)) {
        const fromType = parseCommissionPlan(planRaw);
        parsedPlan.planType = fromType.planType;
        parsedPlan.lob = fromType.lob;
      }
    }

    const stmtCell = cellStr(col(row, idx, ['Statement Date']));
    if (stmtCell) statementDate = statementToDisplay(stmtCell);
    const periodCell = cellStr(col(row, idx, ['Payment Period']));
    if (periodCell) period = parsePeriodInput(periodCell) || periodFromStatementDate(periodCell) || period;
    if (!period && statementDate) period = periodFromStatementDate(statementDate) || period;

    const commission = parseMoney(col(row, idx, [
      'Net Compensation', 'Net Commission', 'Commission', 'Total Compensation',
    ]));
    const premium = parseMoney(col(row, idx, ['Premium']));
    const tax = parseMoney(col(row, idx, ['Tax Withholding']));
    const writing = cellStr(col(row, idx, ['Writing Agent Name', 'Writing Agent', 'Agent']));
    const agent = normalizeAgentName(writing) || HOUSE_AGENT;
    const dateCell = cellStr(col(row, idx, ['Date', 'Effective Date']));

    records.push({
      agent,
      carrier: 'Aetna',
      planType: parsedPlan.planType,
      client,
      effectiveDate: dateCell ? (normalizeStatementDate(dateCell) || dateCell) : '',
      premium,
      commission,
      classification: parsedPlan.classification,
      period,
      policyNumber,
      payee: 'Aetna',
      lob: parsedPlan.lob,
      statementDate,
      source: 'aetna_direct_agency',
      raw: {
        'Customer Number': policyNumber,
        'Customer Name': client,
        'Member Name': client,
        'Commission Plan': cellStr(planRaw),
        'Commission Action': cellStr(actionRaw),
        'Plan Type': parsedPlan.planType,
        Premium: premium,
        Commission: commission,
        'Tax Withholding': tax,
        'Net Compensation': commission,
        'Statement Date': statementDate,
        'Payment Period': period,
        Agency: block.agency || HOUSE_AGENT,
      },
    });
  }

  if (!period) {
    const fromFn = parsePeriodInput(filename) || periodFromStatementDate(filename);
    if (fromFn) {
      for (let i = 0; i < records.length; i++) {
        if (!records[i].period) records[i].period = fromFn;
      }
    }
  }

  const parsedTotal = Math.round(records.reduce((s, r) => s + (r.commission || 0), 0) * 100) / 100;
  const expected = netCheck != null ? netCheck : (records.subtotal != null ? records.subtotal : null);
  records.reconciliation = {
    checked: expected != null,
    ok: expected == null || Math.abs(parsedTotal - expected) < 0.015,
    parsedTotal,
    expectedTotal: expected,
    source: netCheck != null ? 'NetCheck/EFT' : (records.subtotal != null ? 'Subtotal' : null),
  };
  return records;
}

function parseAetnaDirectAgencyFile(filePath, filename) {
  const wb = XLSX.readFile(filePath);
  return parseAetnaDirectAgencyStatement(wb, filename || path.basename(filePath));
}

function applyAgentLookup(records, lookup) {
  const map = lookup || {};
  for (let i = 0; i < (records || []).length; i++) {
    const rec = records[i];
    const key = String(rec.policyNumber || '').toLowerCase();
    const found = map[key] || map[rec.policyNumber];
    if (found) rec.agent = found;
    else if (!rec.agent) rec.agent = HOUSE_AGENT;
  }
  return records;
}

async function applyAetnaAgencyAgents(pool, records) {
  if (!pool || !records || !records.length) return records;
  const policies = [];
  for (let i = 0; i < records.length; i++) {
    if (records[i].policyNumber) policies.push(String(records[i].policyNumber));
  }
  if (!policies.length) return records;
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (LOWER(policy_number)) policy_number, agent_name
       FROM commission_records
       WHERE LOWER(policy_number) = ANY($1::text[])
         AND COALESCE(TRIM(agent_name), '') <> ''
         AND agent_name NOT ILIKE '%health experts%'
       ORDER BY LOWER(policy_number),
         CASE WHEN carrier ILIKE '%aetna%' THEN 0 ELSE 1 END,
         id DESC`,
      [policies.map((p) => p.toLowerCase())]
    );
    const map = {};
    for (let i = 0; i < result.rows.length; i++) {
      map[String(result.rows[i].policy_number).toLowerCase()] = result.rows[i].agent_name;
    }
    applyAgentLookup(records, map);
  } catch (err) {
    console.warn('[AETNA-AGENCY] agent lookup skipped:', err.message);
  }
  return records;
}

module.exports = {
  parseMoney,
  isAetnaDirectAgencyFilename,
  isAetnaDirectAgencyWorkbook,
  parseAetnaDirectAgencyStatement,
  parseAetnaDirectAgencyFile,
  applyAgentLookup,
  applyAetnaAgencyAgents,
  HOUSE_AGENT,
};

'use strict';

/**
 * BSI AML-portal / Contracts CommissionDetails CSV
 * (Devoted, Humana, Wellcare, Freedom — same column layout).
 *
 * Agent Name = payee. Writing Agent = the individual. Only allowlisted
 * payees are imported. Status (Paid / Open / Hold Commission) is recorded
 * as a note the same way Open is today; the row still counts.
 */

const { normalizeAgentName } = require('../routes/normalize');
const { periodFromFilename } = require('./aetnaBsiPayeeCsv');
const {
  isCountedBsiPayee,
  isHraBonusRow,
  isAlbaWritingAgent,
  statusNote,
} = require('./bsiCountedPayees');
const { ALBA_DB_AGENT } = require('./bsiBookAttribution');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseCurrency(val) {
  const s = String(val == null ? '' : val).trim();
  const negative = (s.startsWith('(') && s.endsWith(')')) || s.startsWith('-');
  const num = parseFloat(s.replace(/[$,()/]/g, '').replace(/^-/, '')) || 0;
  return negative ? -num : num;
}

function parsePeriod(val) {
  if (typeof val === 'number' && val > 40000) {
    const d = new Date(Date.UTC(1899, 11, 30));
    d.setUTCDate(d.getUTCDate() + Math.floor(val));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const m = String(val || '').match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (m) return m[3] + m[1].padStart(2, '0');
  return '';
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
      return `${mo}/${d}/${y}`;
    }
    return t;
  }
  if (typeof value === 'number' && value > 40000) {
    const d = new Date(Date.UTC(1899, 11, 30));
    d.setUTCDate(d.getUTCDate() + Math.floor(value));
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

function isAgencyName(name) {
  const n = String(name || '').toLowerCase().trim();
  return n.includes('the health experts') || n.includes('health experts insurance');
}

function normalizeCarrier(carrierRaw) {
  const carrierLower = String(carrierRaw || '').toLowerCase();
  if (carrierLower.includes('humana')) return 'Humana';
  if (carrierLower.includes('devoted')) return 'Devoted Health';
  if (carrierLower.includes('wellcare') || carrierLower.includes('well care')) return 'WellCare';
  if (carrierLower.includes('freedom')) return 'Freedom';
  return String(carrierRaw || '').trim();
}

function derivePlanType(carrier, productRaw, policyNumber) {
  const pt = String(productRaw || '').toLowerCase();
  const pn = String(policyNumber || '').toLowerCase();
  if (carrier === 'Humana') {
    if (pn.includes('_pdp') || pt.includes('pdp')) return 'Humana PDP';
    return 'Humana Med Adv';
  }
  if (carrier === 'Devoted Health' || /devoted/i.test(carrier)) return 'Devoted Med Adv';
  if (carrier === 'WellCare') return 'WellCare Med Adv';
  if (carrier === 'Freedom') return 'Freedom Med Adv';
  return productRaw || '';
}

/**
 * Parse already-object rows (sheet_to_json output).
 * Returns { records, skippedPayee, hraConflicts, importedTotal }.
 */
function parseAmlPortalRows(rawRows, opts = {}) {
  const filename = opts.filename || '';
  const filePeriod = periodFromFilename(filename);
  const records = [];
  const skippedPayee = [];
  const hraConflicts = [];

  for (const row of rawRows || []) {
    const insuredName = String(row['Insured Name'] || '').trim();
    const policyNumber = String(row['Policy #'] || '').trim();
    const statementPayee = String(row['Agent Name'] || '').trim();
    const writingAgentRaw = String(row['Writing Agent'] || '').trim();
    const commissionType = String(row['Commission Type'] || '').trim();
    const statusRaw = String(row['Status'] || '').trim();
    const commission = round2(parseCurrency(row['Commission ($)']));
    const statementDate = row['Statement Date'] ?? '';
    const originalEffDate = row['Original EffectiveDate'] || row['Effective Date'] || '';
    const carrierRaw = String(row['Carrier'] || '').trim();
    const productRaw = String(row['Product'] || '').trim();
    const stateRaw = String(row['State'] || '').trim();

    if (!isValidClientName(insuredName)) continue;
    if (!policyNumber) continue;

    if (isHraBonusRow(row) && !isCountedBsiPayee(statementPayee)) {
      hraConflicts.push({
        payee: statementPayee,
        amount: commission,
        commissionType,
        reason: 'HRA/bonus paid to a writing agent — not assigned to Lina (payee is not on the counted list)',
      });
      skippedPayee.push({ payee: statementPayee, amount: commission, reason: 'hra_other_payee' });
      continue;
    }

    if (!isCountedBsiPayee(statementPayee)) {
      skippedPayee.push({ payee: statementPayee, amount: commission, reason: 'uncounted_payee' });
      continue;
    }

    let classification;
    if (commission < 0) classification = 'Chargeback';
    else classification = 'Agency Override';

    const agent = isAgencyName(writingAgentRaw)
      ? 'The Health Experts Insurance'
      : (normalizeAgentName(writingAgentRaw) || writingAgentRaw || 'BSI Agent');

    const carrier = normalizeCarrier(carrierRaw);
    const period = parsePeriod(statementDate) || filePeriod || 'Unknown';
    const mga = statusNote(statusRaw);

    const record = {
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
      payee: 'BSI',
      statementPayee,
      memberState: stateRaw,
      statementMonth: carrierRaw,
      mga,
      raw: row,
    };

    if (isAlbaWritingAgent(record) && commission < 0 && commissionType.toLowerCase() === 'override') {
      record.agent = ALBA_DB_AGENT;
      record.classification = 'Chargeback';
      record.producerPayable = commission;
      record.theiShare = 0;
      record.bsiShare = 0;
      record.grossCommission = commission;
      record.splitApplies = false;
      record.albaPolicyChargeback = true;
      record.mga = [mga, `Alba's policy — chargeback passed to Lina (${insuredName})`]
        .filter(Boolean)
        .join(' | ');
    }

    records.push(record);
  }

  const importedTotal = round2(records.reduce((s, r) => s + (r.commission || 0), 0));
  return { records, skippedPayee, hraConflicts, importedTotal };
}

function isAmlPortalExport(filename, headers) {
  const f = String(filename || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (f.includes('contracts_commissiondetails')) return true;
  const set = new Set((headers || []).map((h) => String(h || '').trim()));
  return set.has('Writing Agent') && set.has('Policy #') && set.has('Commission Type');
}

module.exports = {
  parseAmlPortalRows,
  isAmlPortalExport,
  parseCurrency,
  parsePeriod,
  formatDate,
};

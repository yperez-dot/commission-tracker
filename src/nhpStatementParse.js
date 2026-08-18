'use strict';

/**
 * NHP commission-report parsing (THEI principal / house statements).
 *
 * May 30 2026-style files put most of the clawback on a footer rollup:
 *   C/B | Charge Backs | Override −$14,554.63
 * with an empty subscriber name. That row is an agency recoup (NHP check),
 * not a BOB member. Skip the TOTAL footer so it is not double-counted.
 */

const XLSX = require('xlsx');
const { normalizeAgentName } = require('../routes/normalize');
const { resolveNhpPaymentPeriod } = require('./nhpPeriod');
const { splitNhpMedicareOverride } = require('./nhpOverrideSplit');
const { round2 } = require('./overrideSplitMath');
const {
  isTailoredAcaPassThrough,
  resolveTailoredAcaPay,
  extractTailoredStatementMeta,
} = require('./tailoredAcaPay');

const NHP_CHARGE_BACKS_CLIENT = 'NHP Charge Backs';
const NHP_HOUSE_ONLY_CLIENT_NAMES = ['nhp charge backs', 'charge backs', 'chargebacks'];

function parseNhpMoney(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = String(v).trim();
  if (!s) return 0;
  const parenNeg = /^\(.*\)$/.test(s);
  s = s.replace(/[$,\s]/g, '');
  s = s.replace(/^\((.*)\)$/, '$1');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return parenNeg ? -Math.abs(n) : n;
}

function looksLikeNhpLob(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^(MA|MAPD|MED|ACA|PDP|MEDSUPP|MEDIGAP|C\/B|TOTAL)$/.test(s);
}

function blobName(...parts) {
  return parts.map((p) => String(p || '').trim().toLowerCase()).join(' ');
}

function isNhpTotalRow({ lob, client } = {}) {
  const blob = blobName(lob, client);
  if (!blob.trim()) return false;
  return /\bgrand total\b/.test(blob) || /\bsubtotal\b/.test(blob) || /\btotal\b/.test(blob);
}

function isNhpChargeBacksRollup({
  lob,
  client,
  agency,
  commClass,
  commType,
  policyNumber,
} = {}) {
  if (String(policyNumber || '').trim()) return false;
  const blob = blobName(lob, client, agency, commClass, commType);
  return /\bc\/b\b/.test(blob) || /charge\s*backs?/.test(blob);
}

function isNhpHouseOnlyClientName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  return NHP_HOUSE_ONLY_CLIENT_NAMES.includes(n);
}

function nhpHouseOnlyClientSql(column = 'client_full_name') {
  return `LOWER(TRIM(${column})) NOT IN ('nhp charge backs', 'charge backs', 'chargebacks')`;
}

function buildNhpChargeBacksHouseRecord({ amount, period, raw } = {}) {
  const pot = round2(parseNhpMoney(amount));
  return {
    agent: 'The Health Experts Insurance',
    carrier: 'NHP',
    planType: '',
    client: NHP_CHARGE_BACKS_CLIENT,
    effectiveDate: '',
    premium: 0,
    commission: pot,
    classification: 'NHP Charge Backs',
    period: period || 'Unknown',
    policyNumber: '',
    payee: 'NHP',
    source: 'NHP',
    policyWrittenDate: '',
    members: 0,
    grossCommission: pot,
    theiShare: pot,
    bsiShare: 0,
    producerPayable: 0,
    splitApplies: false,
    lob: 'C/B',
    subAgentOverride: 0,
    statementMonth: 'Charge Backs',
    mga: '',
    excludeFromBob: true,
    raw: raw || [],
  };
}

function defaultFormatDate(value) {
  if (!value && value !== 0) return '';
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

function defaultNormalizeNHPCarrier(carrierMonth) {
  const c = String(carrierMonth || '').toLowerCase();
  if (c.includes('aetna')) return 'Aetna';
  if (c.includes('cigna')) return 'Cigna';
  if (c.includes('devoted')) return 'Devoted';
  if (c.includes('florida blue') || c.includes('floridablue')) return 'Florida Blue';
  if (c.includes('gold kidney')) return 'Gold Kidney';
  if (c.includes('humana')) return 'Humana';
  if (c.includes('oscar')) return 'Oscar Health';
  if (c.includes('simply')) return 'Simply';
  if ((c.includes('united') && !c.includes('omaha')) || c.includes('uhc')) return 'UnitedHealthcare';
  if (c.includes('molina')) return 'Molina';
  if (c.includes('wellcare')) return 'WellCare';
  if (c.includes('solis')) return 'Solis';
  if (c.includes('doctors')) return 'Doctors';
  if (c.includes('healthsun')) return 'HealthSun';
  return String(carrierMonth || '').split(' - ')[0].trim();
}

function defaultIsValidClientName(clientName) {
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

function nhpStatementCheckAmount(records) {
  return round2(
    (records || []).reduce((sum, r) => (
      sum
      + (Number(r.producerPayable) || 0)
      + (Number(r.theiShare) || 0)
      + (Number(r.bsiShare) || 0)
      + (Number(r.subAgentOverride) || 0)
    ), 0)
  );
}

/**
 * @param {object} wb XLSX workbook
 * @param {string} uploadPeriod YYYYMM fallback
 * @param {string} filename
 * @param {{
 *   formatDate?: Function,
 *   derivePlanType?: Function,
 *   normalizeAgentName?: Function,
 *   normalizeNHPCarrier?: Function,
 *   isValidClientName?: Function,
 * }} helpers
 */
function parseNhpWorkbook(wb, uploadPeriod, filename = '', helpers = {}) {
  const formatDate = helpers.formatDate || defaultFormatDate;
  const derivePlanType = helpers.derivePlanType || ((carrier) => carrier);
  const normalizeAgent = helpers.normalizeAgentName || normalizeAgentName;
  const normalizeCarrier = helpers.normalizeNHPCarrier || defaultNormalizeNHPCarrier;
  const isValidClientName = helpers.isValidClientName || defaultIsValidClientName;

  const records = [];
  const marcoDeductedPolicies = new Set();
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws['!ref']) return records;
  const range = XLSX.utils.decode_range(ws['!ref']);

  const preambleRows = XLSX.utils.sheet_to_json(ws, {
    raw: false,
    defval: '',
    header: 1,
    range: 0,
  }).slice(0, 30);
  const tailoredMeta = extractTailoredStatementMeta(preambleRows);

  const cyclePeriod = resolveNhpPaymentPeriod({
    filename,
    uploadPeriod,
    statementDate: tailoredMeta.paymentStatementDate,
    cycleDate: tailoredMeta.paymentStatementDate,
  });

  let headerRow = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 40, range.e.r); r++) {
    let hasOverride = false;
    let hasLob = false;
    let hasAgentName = false;
    let hasCommClass = false;
    let hasCarrierStatement = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const h = String(cell?.v || '').toLowerCase().trim();
      if (!h) continue;
      if (h === 'override') hasOverride = true;
      if (h === 'lob') hasLob = true;
      if (h.includes('agent name')) hasAgentName = true;
      if (h.includes('comm class')) hasCommClass = true;
      if (h.includes('carrier') && h.includes('statement')) hasCarrierStatement = true;
    }
    if (
      hasOverride ||
      (hasLob && (hasAgentName || hasCommClass || hasCarrierStatement))
    ) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return records;

  const rawRows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null, range: headerRow, header: 1 });
  const headerRowData = rawRows[0] || [];

  const lobIdx = headerRowData.findIndex((h) => String(h).toLowerCase().includes('lob'));
  const carrierStatementIdx = headerRowData.findIndex((h) =>
    /carrier.*statement|statement.*month/i.test(String(h || ''))
  );
  const carrierIdx = carrierStatementIdx >= 0
    ? carrierStatementIdx
    : headerRowData.findIndex((h) => String(h).toLowerCase().includes('carrier'));
  const agencyIdx = headerRowData.findIndex((h) => String(h).toLowerCase().includes('agency'));
  const agentNameIdx = headerRowData.findIndex((h) => String(h).toLowerCase().includes('agent name'));
  const policyNumIdx = headerRowData.findIndex((h) => String(h).toLowerCase().includes('policy number'));
  const clientIdx = headerRowData.findIndex((h) =>
    String(h).toLowerCase().includes('subscriber') || String(h).toLowerCase().includes('member name')
  );
  const membersIdx = headerRowData.findIndex((h) => String(h || '').trim().toLowerCase() === 'members') !== -1
    ? headerRowData.findIndex((h) => String(h || '').trim().toLowerCase() === 'members')
    : 8;
  const effectiveDateIdx = headerRowData.findIndex((h) => String(h).toLowerCase().includes('policy effective'));
  const commTypeIdx = headerRowData.findIndex((h) => String(h).toLowerCase() === 'commission type');
  const commClassIdx = headerRowData.findIndex((h) => String(h).toLowerCase().includes('comm class'));
  const commissionIdx = headerRowData.findIndex((h) => String(h || '').trim().toLowerCase() === 'commission') !== -1
    ? headerRowData.findIndex((h) => String(h || '').trim().toLowerCase() === 'commission')
    : 13;
  const overrideIdx = headerRowData.findIndex((h) => String(h || '').trim().toLowerCase() === 'override') !== -1
    ? headerRowData.findIndex((h) => String(h || '').trim().toLowerCase() === 'override')
    : 14;
  const feeIdx = headerRowData.findIndex((h) => String(h).toLowerCase() === 'fee');

  const rows = rawRows.slice(1);

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    const lobValue = lobIdx >= 0 ? row[lobIdx] : null;
    const hasLOB = looksLikeNhpLob(lobValue);
    const shift = hasLOB ? 0 : -1;

    const lobRaw = hasLOB ? String(lobValue).trim() : '';
    const carrierRaw = String(row[carrierIdx + shift] || '').trim();
    const agencyRaw = agencyIdx >= 0 ? String(row[agencyIdx + shift] || '').trim() : '';
    const agentRaw = String(row[agentNameIdx + shift] || '').trim();
    const agent = normalizeAgent(agentRaw);
    let client = String(row[clientIdx + shift] || '').trim();
    const policyNumber = String(row[policyNumIdx + shift] || '').trim();
    const members = membersIdx >= 0 ? (parseInt(row[membersIdx + shift], 10) || 0) : 0;
    const effectiveDateRaw = row[effectiveDateIdx + shift];
    const effectiveDate = formatDate(effectiveDateRaw);
    const period = cyclePeriod;
    const commType = String(row[commTypeIdx + shift] || '').trim();
    const commClass = String(row[commClassIdx + shift] || '').trim();

    const commissionAmount = commissionIdx >= 0 ? parseNhpMoney(row[commissionIdx + shift]) : 0;
    const overrideAmount = overrideIdx >= 0 ? parseNhpMoney(row[overrideIdx + shift]) : 0;
    const feeAmount = feeIdx >= 0 ? parseNhpMoney(row[feeIdx + shift]) : 0;

    if (isNhpTotalRow({ lob: lobRaw, client })) continue;

    if (isNhpChargeBacksRollup({
      lob: lobRaw,
      client,
      agency: agencyRaw,
      commClass,
      commType,
      policyNumber,
    })) {
      const amount = overrideAmount || commissionAmount || feeAmount;
      if (amount === 0) continue;
      records.push(buildNhpChargeBacksHouseRecord({ amount, period, raw: row }));
      continue;
    }

    if (!isValidClientName(client)) {
      if (policyNumber && (commissionAmount !== 0 || overrideAmount !== 0 || feeAmount !== 0)) {
        client = `Unknown (${policyNumber})`;
      } else {
        continue;
      }
    }

    let lob;
    const lobLower = lobRaw.toLowerCase();
    if (lobLower === 'ma' || lobLower === 'mapd' || lobLower === 'med') lob = 'MA';
    else if (lobLower === 'aca') lob = 'ACA';
    else if (lobLower === 'pdp') lob = 'PDP';
    else if (lobLower === 'medsupp' || lobLower === 'medigap') lob = 'MedSupp';
    else lob = lobRaw || 'MA';

    const commClassLower = commClass.toLowerCase();
    const commTypeLower = commType.toLowerCase();
    const isCommissionRow = commClassLower.includes('commission') || commTypeLower.includes('commission');
    const isOverrideRow = commClassLower.includes('override') || commTypeLower.includes('override');

    // NHP often puts dollars in Commission even when Comm Class is Override.
    const linePot = round2(commissionAmount + overrideAmount);
    if (linePot === 0 && feeAmount === 0) continue;

    const grossCommission = isCommissionRow && !isOverrideRow
      ? (commissionAmount !== 0 ? commissionAmount : linePot)
      : isOverrideRow
        ? (overrideAmount !== 0 ? overrideAmount : linePot)
        : linePot;

    const carrier = normalizeCarrier(carrierRaw);
    const planType = derivePlanType(carrier, '', policyNumber, lobRaw);

    const BSI_SPLIT_START_DATE = '2025-09-01';
    const isoEff = (() => {
      const m = String(effectiveDate || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      return '';
    })();
    const isBsiEligible = lob === 'MA' && isoEff && isoEff >= BSI_SPLIT_START_DATE;

    let splitApplies;
    let theiShare;
    let bsiShare;
    let producerPayable;
    let recordType;
    let subAgentOverride = 0;
    let mga = '';

    if (lob === 'ACA') {
      splitApplies = false;
      bsiShare = 0;
      const tailoredPass = isTailoredAcaPassThrough({
        agentName: agent,
        agency: agencyRaw,
        statementTitle: tailoredMeta.statementTitle,
      });
      if (tailoredPass || tailoredMeta.isTailoredStatement) {
        const tailored = resolveTailoredAcaPay({ commissionAmount, overrideAmount });
        theiShare = tailored.theiShare;
        producerPayable = tailored.producerPayable;
        recordType = tailored.recordType;
        splitApplies = tailored.splitApplies;
        mga = tailored.mga;
      } else if (commissionAmount !== 0) {
        theiShare = 0;
        producerPayable = commissionAmount;
        recordType = commissionAmount < 0 ? 'ACA Agent Chargeback' : 'ACA Agent Commission';
      } else if (overrideAmount !== 0) {
        theiShare = overrideAmount;
        producerPayable = 0;
        recordType = overrideAmount < 0 ? 'ACA Override Chargeback' : 'ACA Agency Override';
      } else {
        theiShare = 0;
        producerPayable = 0;
        recordType = 'ACA Zero Amount';
      }
    } else if (isCommissionRow) {
      splitApplies = false;
      theiShare = 0;
      bsiShare = 0;
      producerPayable = grossCommission;
      recordType = 'Agent Commission';
    } else {
      recordType = 'Agency Override';
      const policyKey = String(policyNumber || '').trim().toLowerCase();
      const alreadyDeducted = policyKey ? marcoDeductedPolicies.has(policyKey) : false;
      const split = splitNhpMedicareOverride({
        pot: grossCommission,
        agentName: agent,
        carrier,
        classification: commClass || commType,
        paymentPeriod: period,
        isBsiEligible,
        alreadyDeducted,
      });
      if (split.subAgentOverride && policyKey) marcoDeductedPolicies.add(policyKey);
      splitApplies = split.splitApplies;
      theiShare = split.theiShare;
      bsiShare = split.bsiShare;
      producerPayable = split.producerPayable;
      subAgentOverride = split.subAgentOverride;
    }

    if (feeAmount !== 0) {
      theiShare = round2((Number(theiShare) || 0) + feeAmount);
    }

    records.push({
      agent: agent || 'Unknown',
      carrier,
      planType,
      client,
      effectiveDate,
      premium: 0,
      commission: theiShare,
      classification: (() => {
        if (String(recordType || '').toLowerCase().includes('aca')) return recordType;
        return grossCommission < 0 ? 'Chargeback' : recordType;
      })(),
      period: period || 'Unknown',
      policyNumber,
      payee: 'NHP',
      source: 'NHP',
      policyWrittenDate: effectiveDate,
      members,
      grossCommission,
      theiShare,
      bsiShare,
      producerPayable,
      splitApplies,
      lob,
      subAgentOverride,
      statementMonth: carrierRaw,
      mga: mga || '',
      raw: row,
    });
  }
  return records;
}

module.exports = {
  NHP_CHARGE_BACKS_CLIENT,
  NHP_HOUSE_ONLY_CLIENT_NAMES,
  parseNhpMoney,
  isNhpTotalRow,
  isNhpChargeBacksRollup,
  isNhpHouseOnlyClientName,
  nhpHouseOnlyClientSql,
  buildNhpChargeBacksHouseRecord,
  nhpStatementCheckAmount,
  parseNhpWorkbook,
  looksLikeNhpLob,
};

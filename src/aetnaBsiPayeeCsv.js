'use strict';

/**
 * Aetna → BSI payee CSV (e.g. "BSI-Aetna-09.2026.csv").
 *
 * Columns: Payment Date, Medicare Number, Member ID, Legacy Member ID, Member Name,
 * Member State, Sales Event, Product, Market, Plan ID, Additional Payment Detail,
 * Coverage Period, Effective Date, Term Date, Writing Agent NPN, Writing Agent Level,
 * Writing Agent Name ("Last, First"), Payee ID, Payee Level, Payee Name, Payee Amount,
 * CMS New, Member Sig Dt, 1099 Year. Footer: "Total Payee Amount: $X".
 *
 * Amount = Payee Amount. Carrier is always Aetna. Classification from Sales Event:
 *   New Business / PRONEW              → New Business
 *   Renewal (and residual)             → Renewal
 *   CMS Trueup (positive)              → CMS Trueup (positive adjustment)
 *   CMS Trueup reversal / Involuntarily Rapid Disenroll / any negative → Chargeback
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseMoney(v) {
  if (typeof v === 'number') return v;
  let s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[$\s]/g, ''));
  s = s.replace(/[$,\s()]/g, '').replace(/^-/, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/** M/D/YY or M/D/YYYY → MM/DD/YYYY (null when blank). */
function normalizeDate(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${y}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  return s;
}

function periodFromDate(mdY) {
  const m = String(mdY || '').match(/^(\d{2})\/\d{2}\/(\d{4})$/);
  return m ? `${m[2]}${m[1]}` : '';
}

/** Statement month from the filename: 09.2026 / 09-2026 / 2026-09 / 202609. */
function periodFromFilename(filename) {
  const f = String(filename || '');
  let m = f.match(/(?:^|[^\d])(0[1-9]|1[0-2])[._\- ](20\d{2})(?!\d)/);
  if (m) return `${m[2]}${m[1]}`;
  m = f.match(/(20\d{2})[-_.](0[1-9]|1[0-2])(?!\d)/);
  if (m) return `${m[1]}${m[2]}`;
  m = f.match(/(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
  if (m) return `${m[1]}${m[2]}`;
  return '';
}

function classifyAetnaSalesEvent(salesEvent, amount) {
  const s = String(salesEvent || '').trim().toLowerCase();
  if (s.includes('reversal') || s.includes('disenroll') || s.includes('chargeback')) return 'Chargeback';
  if (amount < 0) return 'Chargeback';
  if (s === 'new business' || s === 'pronew') return 'New Business';
  if (s === 'renewal' || s.includes('residual')) return 'Renewal';
  if (s.includes('trueup') || s.includes('true up') || s.includes('true-up')) return 'CMS Trueup';
  return 'Agent Commission';
}

function capEventType(classification) {
  if (classification === 'Renewal') return 'renewal';
  if (classification === 'New Business') return 'initial';
  return null;
}

/** "Total Payee Amount: $293.45" footer value, or null. */
function footerTotal(rows) {
  for (const row of rows || []) {
    for (const v of Object.values(row || {})) {
      const m = String(v || '').match(/total\s+payee\s+amount\s*:?\s*(-?\$?\(?-?[\d,]+(?:\.\d+)?\)?)/i);
      if (m) return round2(parseMoney(m[1]));
    }
  }
  return null;
}

function cleanRow(row) {
  const clean = {};
  for (const [k, v] of Object.entries(row || {})) clean[String(k).replace(/^\uFEFF/, '').trim()] = v;
  return clean;
}

/**
 * Parse sheet rows (objects keyed by header) into BSI records.
 * opts: { filename, getCap(state, eventType) }
 * Returns { records, footerTotal }.
 */
function parseAetnaBsiPayeeRows(rawRows, opts = {}) {
  const rows = (rawRows || []).map(cleanRow);
  const filePeriod = periodFromFilename(opts.filename);
  const records = [];

  for (const row of rows) {
    const paymentDateRaw = String(row['Payment Date'] || '').trim();
    const memberName = String(row['Member Name'] || '').trim();
    // Footer / blank rows
    if (!paymentDateRaw || /^total/i.test(paymentDateRaw)) continue;
    if (!memberName && !String(row['Payee Amount'] || '').trim()) continue;

    const amount = round2(parseMoney(row['Payee Amount']));
    const salesEvent = String(row['Sales Event'] || '').trim();
    const classification = classifyAetnaSalesEvent(salesEvent, amount);
    const effectiveDate = normalizeDate(row['Effective Date']);
    const paymentDate = normalizeDate(paymentDateRaw);
    const period = filePeriod || periodFromDate(paymentDate) || periodFromDate(normalizeDate(row['Coverage Period']));

    const stateRaw = String(row['Member State'] || row['State'] || '').trim().split('-')[0].toUpperCase();
    const memberState = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;

    const planId = String(row['Plan ID'] || '').trim();
    const product = String(row['Product'] || '').trim().toLowerCase();
    const isPdp = product.includes('pdp') || /^s\d/i.test(planId);
    const planType = `${isPdp ? 'Aetna PDP' : 'Aetna MAPD'}${planId ? ` ${planId}` : ''}`;

    const writingAgent = String(row['Writing Agent Name'] || '').trim();
    const agent = writingAgent
      ? writingAgent.replace(/^([^,]+),\s*(.+)$/, '$2 $1').replace(/\s+/g, ' ').trim()
      : 'Broker Society Insurance';

    let anomaly = false;
    const evt = capEventType(classification);
    if (amount > 0 && evt && typeof opts.getCap === 'function') {
      const cap = opts.getCap(memberState, evt);
      if (cap && amount > cap) anomaly = true;
    }

    records.push({
      agent,
      carrier: 'Aetna',
      planType,
      planId: planId || null,
      client: memberName,
      effectiveDate,
      premium: 0,
      commission: amount,
      classification,
      period,
      policyNumber: String(row['Member ID'] || '').trim(),
      payee: 'BSI',
      mga: salesEvent && classification !== 'New Business' && classification !== 'Renewal' ? `Aetna: ${salesEvent}` : '',
      anomaly,
      memberState,
      writingNpn: String(row['Writing Agent NPN'] || '').trim(),
      raw: row,
    });
  }
  return { records, footerTotal: footerTotal(rows) };
}

module.exports = {
  parseAetnaBsiPayeeRows,
  classifyAetnaSalesEvent,
  periodFromFilename,
  footerTotal,
  normalizeDate,
};

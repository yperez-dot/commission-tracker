'use strict';

/**
 * AgentView Commission Report (CNHIC / HealthSpring Med Supp) PDF parser.
 *
 * Source sample: THE HEALTH EXPERTS INSURANCE — AgentView Commission Report
 * Report Period 08/01/26 – 08/14/26 · Agent ID CB142243,CNHIC
 *
 * pdf-parse flattens multi-column earnings tables across pages. We zip:
 *   policy/insured rows × eff/plan/rate × comm paid × writing agent × issue state
 */

function isAgentViewCommissionReport(filename) {
  const f = String(filename || '').toLowerCase().replace(/\s+/g, '_');
  if (!f.endsWith('.pdf')) return false;
  if (f.includes('agentview') || f.includes('agent_view')) return true;
  if (f.includes('agentcommissionreport') || f.includes('agent_commission_report')) return true;
  // Common portal download: AgentCommissionReport….pdf
  if (/agent.?commission.?report/.test(f)) return true;
  return false;
}

function toTitleCaseName(lastFirst) {
  const raw = String(lastFirst || '').trim();
  if (!raw) return '';
  if (raw.includes(',')) {
    const [last, ...rest] = raw.split(',');
    const first = rest.join(',').trim();
    const full = `${first} ${last.trim()}`.trim();
    return full.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return raw.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function parseMoney(s) {
  const n = parseFloat(String(s || '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function formatDateMMDDYYYY(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  let y = m[3];
  if (y.length === 2) y = `20${y}`;
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function periodFromReportText(text) {
  // Report Period:  08/01/26 - to - 08/14/26
  const m = text.match(
    /Report\s*Period:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*to\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i
  );
  if (!m) return null;
  let y = m[6];
  if (y.length === 2) y = `20${y}`;
  const mm = m[4].padStart(2, '0');
  return `${y}${mm}`;
}

function periodFromCycleDate(cycleDate) {
  const iso = formatDateMMDDYYYY(cycleDate);
  if (!iso) return null;
  return iso.slice(0, 4) + iso.slice(5, 7);
}

/**
 * @param {string} text — pdf-parse `data.text`
 * @param {string} [filename]
 * @returns {Array<object>} commission-record shaped rows
 */
function parseAgentViewCommissionReportText(text, filename = 'AgentView.pdf') {
  const compact = String(text || '').replace(/\r/g, '');
  if (!/AgentView\s+Commission\s+Report/i.test(compact) && !/CNHIC/i.test(compact)) {
    return [];
  }

  const reportPeriod = periodFromReportText(compact);

  // CB142243CNHIC60Y0436424MUSHKIN, SILVIA
  const policyRe = /CB\d{6}CNHIC(\d{2}Y\d+)([A-Z]+,\s*[A-Z][A-Z .'-]*)/g;
  const policies = [];
  let pm;
  while ((pm = policyRe.exec(compact)) !== null) {
    const policyNumber = pm[1].trim();
    const clientRaw = pm[2].replace(/\s+/g, ' ').trim().replace(/,$/, '');
    if (!policyNumber || !clientRaw) continue;
    policies.push({
      policyNumber,
      client: toTitleCaseName(clientRaw),
      carrier: 'HealthSpring',
      company: 'CNHIC',
    });
  }

  // 08/01/2026107/01/2026MIM20BM60GHNHIC MEDSUP STD PLAN G (ISSUE AGE) 118.00
  // Dur year digit sits between prem-due and eff dates.
  const detailRe =
    /(\d{1,2}\/\d{1,2}\/\d{4})1(\d{1,2}\/\d{1,2}\/\d{4})([A-Z0-9]+)HNHIC\s*MEDSUP\s*([\s\S]*?)(\d+\.\d{2})/gi;
  const details = [];
  let dm;
  while ((dm = detailRe.exec(compact)) !== null) {
    const planBlob = `HNHIC MEDSUP ${dm[4]}`.replace(/\s+/g, ' ').trim();
    details.push({
      premDueDate: dm[1],
      effectiveDate: formatDateMMDDYYYY(dm[2]),
      planCode: dm[3],
      planType: planBlob,
      premium: parseMoney(dm[5]),
    });
  }

  // $308.82$55.59Earnings Paid$55.5908/14/2026
  const payRe =
    /\$([\d,]+\.\d{2})\$([\d,]+\.\d{2})Earnings\s*Paid\$([\d,]+\.\d{2})(\d{1,2}\/\d{1,2}\/\d{4})/gi;
  const pays = [];
  let ym;
  while ((ym = payRe.exec(compact)) !== null) {
    pays.push({
      commPremium: parseMoney(ym[1]),
      earnings: parseMoney(ym[2]),
      commission: parseMoney(ym[3]),
      cycleDate: ym[4],
    });
  }

  // SYSCB142243PEREZ,YAHOSKAOE01NO
  const agentRe = /SYS(?:CB)?\d+([A-Z]+),([A-Z]+)OE\d{2}/gi;
  const agents = [];
  let am;
  while ((am = agentRe.exec(compact)) !== null) {
    agents.push(toTitleCaseName(`${am[1].trim()},${am[2].trim()}`));
  }

  // Issue state lines: FL0.00 (avoid bare totals)
  const stateRe = /(?:^|\n)\s*([A-Z]{2})0\.00\b/g;
  const states = [];
  let sm;
  while ((sm = stateRe.exec(compact)) !== null) {
    states.push(sm[1]);
  }

  const n = Math.max(policies.length, details.length, pays.length);
  const records = [];
  for (let i = 0; i < n; i++) {
    const pol = policies[i];
    const det = details[i] || {};
    const pay = pays[i] || {};
    if (!pol && !pay.commission) continue;
    const commission = pay.commission || 0;
    if (!(commission > 0) && !(det.premium > 0)) continue;

    const period =
      periodFromCycleDate(pay.cycleDate) ||
      reportPeriod ||
      'Unknown';

    records.push({
      agent: agents[i] || agents[0] || 'The Health Experts Insurance',
      carrier: (pol && pol.carrier) || 'HealthSpring',
      planType: det.planType || 'Medicare Supplement',
      client: (pol && pol.client) || '',
      effectiveDate: det.effectiveDate || '',
      premium: det.premium || 0,
      commission,
      classification: 'NB',
      period,
      policyNumber: (pol && pol.policyNumber) || '',
      payee: 'Direct',
      mga: 'THEI',
      memberState: states[i] || states[0] || '',
      raw: {
        source: 'agentview_cnhic',
        company: (pol && pol.company) || 'CNHIC',
        planCode: det.planCode,
        cycleDate: pay.cycleDate,
        commPremium: pay.commPremium,
        filename,
      },
    });
  }

  // Prefer statement total when present
  const totalMatch = compact.match(/Total\s+Commission\s+Paid\s*\$?([\d,]+\.\d{2})/i);
  if (totalMatch && records.length) {
    const expected = parseMoney(totalMatch[1]);
    const got = Math.round(records.reduce((s, r) => s + r.commission, 0) * 100) / 100;
    if (Math.abs(expected - got) > 0.02) {
      console.warn(
        `[AGENTVIEW] sum $${got} ≠ statement total $${expected} (${records.length} rows)`
      );
    }
  }

  console.log(`[AGENTVIEW] parsed ${records.length} records from ${filename}`);
  return records;
}

async function parseAgentViewCommissionReportPDF(filePath, filename, pdfParse) {
  if (!pdfParse) {
    console.error('[AGENTVIEW] pdf-parse not installed');
    return [];
  }
  const fs = require('fs');
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return parseAgentViewCommissionReportText(data.text, filename || require('path').basename(filePath));
}

function looksLikeAgentViewText(text) {
  const t = String(text || '');
  return /AgentView\s+Commission\s+Report/i.test(t)
    || (/CNHIC/i.test(t) && /Earnings\s*Paid/i.test(t) && /\d{2}Y\d+/i.test(t));
}

/**
 * Filename match OR PDF content sniff (portal downloads sometimes rename the file).
 * Returns null when this is clearly not an AgentView PDF.
 */
async function tryParseAgentViewUpload(filePath, filename, pdfParseFn) {
  const nameHit = isAgentViewCommissionReport(filename);
  const isPdf = /\.pdf$/i.test(String(filename || ''));
  if (!nameHit && !isPdf) return null;
  if (!pdfParseFn) return nameHit ? [] : null;
  try {
    const fs = require('fs');
    const data = await pdfParseFn(fs.readFileSync(filePath));
    if (!nameHit && !looksLikeAgentViewText(data.text)) return null;
    return parseAgentViewCommissionReportText(data.text, filename);
  } catch (err) {
    console.error('[AGENTVIEW] parse failed:', err.message);
    return nameHit ? [] : null;
  }
}

module.exports = {
  isAgentViewCommissionReport,
  looksLikeAgentViewText,
  parseAgentViewCommissionReportText,
  parseAgentViewCommissionReportPDF,
  tryParseAgentViewUpload,
  toTitleCaseName,
};

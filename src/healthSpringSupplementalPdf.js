'use strict';

/**
 * HealthSpring Supplemental Benefits agency PDF (payee THE HEALTH EXPERTS INS).
 * Portal filenames are opaque (01M70M2E…). Sniff "HealthSpring Supplemental Benefits"
 * + COMMISSION ACTIVITY DETAILS. AgentView CNHIC reports are a different parser.
 */

const { periodFromStatementDate } = require('./periodFormat');
const { normalizeAgentName } = require('../routes/normalize');

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

function normalizePdfText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\r/g, '');
}

function looksLikeHealthSpringSupplementalText(text) {
  const t = normalizePdfText(text);
  return /HealthSpring\s+Supplemental\s+Benefits/i.test(t)
    && /COMMISSION\s+ACTIVITY\s+DETAILS/i.test(t);
}

function isHealthSpringSupplementalFilename(filename) {
  const f = String(filename || '').toLowerCase().replace(/\s+/g, '_');
  if (!f.endsWith('.pdf')) return false;
  if (f.includes('agentview') || f.includes('agent_commission_report')) return false;
  return f.includes('healthspring') || f.includes('health_spring') || f.includes('hsbcommission');
}

function titleName(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function hyphenDateToMdY(s) {
  const m = String(s || '').trim().match(/^(\d{2})-(\d{2})-(\d{2,4})$/);
  if (!m) return '';
  let y = m[3];
  if (y.length === 2) y = `20${y}`;
  return `${m[1]}/${m[2]}/${y}`;
}

function parseStatementDate(text) {
  const t = normalizePdfText(text);
  const m = t.match(/Statement\s+Date:\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (!m) return { label: '', isoish: '', period: '' };
  const label = `${m[1]} ${m[2]}, ${m[3]}`;
  const period = periodFromStatementDate(label) || '';
  const months = {
    january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
    april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
    august: '08', aug: '08', september: '09', sep: '09', sept: '09',
    october: '10', oct: '10', november: '11', nov: '11', december: '12', dec: '12',
  };
  const mo = months[m[1].toLowerCase()] || '';
  const dd = String(m[2]).padStart(2, '0');
  return { label, isoish: mo ? `${mo}/${dd}/${m[3]}` : label, period };
}

function extractWritingAgent(text) {
  const t = normalizePdfText(text);
  const m = t.match(/SYS[A-Z]*\d+\s*[-–]\s*([A-Z][A-Z\s,'.-]+?)(?:\s*$|\s{2,}|\n)/im);
  if (!m) return 'The Health Experts Insurance';
  return normalizeAgentName(titleName(m[1])) || titleName(m[1]);
}

function extractStatementTotal(text) {
  const t = normalizePdfText(text);
  const dd = t.match(/Direct\s+Deposit\s*\$?([\d,]+\.\d{2})/i);
  if (dd) return parseMoney(dd[1]);
  let last = null;
  const re = /GRAND\s+TOTAL[\s\S]{0,120}?\$([\d,]+\.\d{2})/gi;
  let m;
  while ((m = re.exec(t))) last = parseMoney(m[1]);
  return last;
}

function classifyRow(newAmt, renewalAmt, description, commission) {
  const desc = String(description || '');
  if (commission < 0 || /chargeback/i.test(desc)) return 'Chargeback';
  if (/manual\s+adjustment/i.test(desc)) return 'Manual Adjustment';
  if (Math.abs(renewalAmt) > 0.001 && Math.abs(newAmt) < 0.001) return 'Renewal';
  if (Math.abs(newAmt) > 0.001) return 'New Business';
  if (Math.abs(renewalAmt) > 0.001) return 'Renewal';
  return 'Agent Commission';
}

const FLAT_HEAD = /(\d{2}Y\d{7})([A-Z0-9]+ [A-Z]+)([A-Z])\s+(\d{2}-\d{2}-\d{2})(\d{2}-\d{2}-\d{2})([A-Z]{2})(\d{2})([A-Z]{3,4})/g;
const LAYOUT_HEAD = /(\d{2}Y\d{7})\s+([A-Z0-9]{6,14})\s+([A-Z][A-Z\s]+?)\s+([A-Z])\s+(\d{2}-\d{2}-\d{2})\s+(\d{2}-\d{2}-\d{2})\s+([A-Z]{2})\s+(\d{2})\s+([A-Z]{3,4})/g;

function splitProductAndFirstName(token) {
  const m = String(token || '').match(/^(.*\d[A-Z])([A-Z]{2,})$/);
  if (m) return { product: m[1], firstName: m[2] };
  return { product: token, firstName: '' };
}

function moneyTokens(s) {
  const out = [];
  const re = /\$[\d,]+\.\d{2}|\(\$[\d,]+\.\d{2}\)|\([\d,]+\.\d{2}\)/g;
  let m;
  while ((m = re.exec(String(s || '')))) out.push(parseMoney(m[0]));
  return out;
}

function tailUntilNext(text, from) {
  const rest = String(text || '').slice(from);
  const next = rest.search(/\d{2}Y\d{7}|Subtotal/i);
  return next === -1 ? rest : rest.slice(0, next);
}

function buildRow(fields, ctx) {
  const newAmt = fields.newAmt;
  const renewalAmt = fields.renewalAmt;
  const commission = Math.round(fields.commission * 100) / 100;
  const classification = classifyRow(newAmt, renewalAmt, fields.description, commission);
  const client = titleName(fields.client);
  return {
    agent: ctx.agent,
    carrier: 'HealthSpring',
    planType: fields.product,
    client,
    effectiveDate: fields.effectiveDate,
    premium: fields.premium,
    commission,
    classification,
    period: ctx.period,
    policyNumber: fields.policyNumber,
    payee: 'HealthSpring',
    lob: 'Med Supp',
    memberState: fields.state,
    statementDate: ctx.statementDate,
    paidToDate: fields.paidToDate,
    source: 'healthspring_supplemental',
    raw: {
      'Policy Number': fields.policyNumber,
      Product: fields.product,
      Insured: client,
      Status: fields.status,
      'Effective Date': fields.effectiveDate,
      'Paid To Date': fields.paidToDate,
      'Issue State': fields.state,
      'Billing Mode': fields.mode,
      Premium: fields.premium,
      New: newAmt,
      Renewal: renewalAmt,
      'Amount to Pay': commission,
      'Statement Date': ctx.statementDate,
      'Writing Agent': ctx.agent,
    },
  };
}

function amountsFromTail(tail) {
  const moneys = moneyTokens(tail);
  const premium = moneys[0] || 0;
  const newAmt = moneys[1] || 0;
  const renewalAmt = moneys[2] || 0;
  const amountToPay = moneys[4] != null ? moneys[4] : newAmt + renewalAmt;
  return { premium, newAmt, renewalAmt, commission: amountToPay };
}

function extractFlatRows(text, ctx) {
  const rows = [];
  FLAT_HEAD.lastIndex = 0;
  let m;
  while ((m = FLAT_HEAD.exec(text))) {
    const parts = splitProductAndFirstName(m[2].split(' ')[0]);
    const lastName = m[2].split(' ').slice(1).join(' ');
    const client = `${parts.firstName} ${lastName}`.trim();
    const tail = tailUntilNext(text, m.index + m[0].length);
    const amts = amountsFromTail(tail);
    rows.push(buildRow({
      policyNumber: m[1],
      product: parts.product,
      client,
      status: m[3],
      effectiveDate: hyphenDateToMdY(m[4]),
      paidToDate: hyphenDateToMdY(m[5]),
      state: m[6],
      mode: m[8],
      description: m[0],
      premium: amts.premium,
      newAmt: amts.newAmt,
      renewalAmt: amts.renewalAmt,
      commission: amts.commission,
    }, ctx));
  }
  return rows;
}

function extractLayoutRows(text, ctx) {
  const rows = [];
  LAYOUT_HEAD.lastIndex = 0;
  let m;
  while ((m = LAYOUT_HEAD.exec(text))) {
    const tail = tailUntilNext(text, m.index + m[0].length);
    const amts = amountsFromTail(tail);
    rows.push(buildRow({
      policyNumber: m[1],
      product: m[2],
      client: m[3],
      status: m[4],
      effectiveDate: hyphenDateToMdY(m[5]),
      paidToDate: hyphenDateToMdY(m[6]),
      state: m[7],
      mode: m[9],
      description: m[0],
      premium: amts.premium,
      newAmt: amts.newAmt,
      renewalAmt: amts.renewalAmt,
      commission: amts.commission,
    }, ctx));
  }
  return rows;
}

function parseHealthSpringSupplementalText(text, filename) {
  const t = normalizePdfText(text);
  const records = [];
  if (!/COMMISSION\s+ACTIVITY\s+DETAILS/i.test(t) && !/HealthSpring\s+Supplemental\s+Benefits/i.test(t)) {
    return records;
  }
  const stmt = parseStatementDate(t);
  const ctx = {
    agent: extractWritingAgent(t),
    statementDate: stmt.isoish,
    period: stmt.period || periodFromStatementDate(filename) || '',
  };
  const extracted = extractLayoutRows(t, ctx);
  const use = extracted.length ? extracted : extractFlatRows(t, ctx);
  const seen = {};
  for (let i = 0; i < use.length; i++) {
    const rec = use[i];
    if (!rec || !rec.policyNumber) continue;
    const key = `${rec.policyNumber}|${rec.paidToDate}|${rec.commission}`;
    if (seen[key]) continue;
    seen[key] = true;
    records.push(rec);
  }
  const expected = extractStatementTotal(t);
  const parsedTotal = Math.round(records.reduce((s, r) => s + (r.commission || 0), 0) * 100) / 100;
  records.reconciliation = {
    checked: expected != null,
    ok: expected == null || Math.abs(parsedTotal - expected) < 0.015,
    parsedTotal,
    expectedTotal: expected,
    source: expected != null ? 'Direct Deposit / GRAND TOTAL' : null,
  };
  return records;
}

async function parseHealthSpringSupplementalPDF(filePath, filename, pdfParseFn) {
  const fs = require('fs');
  const pdfParse = pdfParseFn || require('pdf-parse');
  const data = await pdfParse(fs.readFileSync(filePath));
  return parseHealthSpringSupplementalText(data.text, filename || require('path').basename(filePath));
}

async function tryParseHealthSpringSupplementalUpload(filePath, filename, pdfParseFn) {
  const nameHit = isHealthSpringSupplementalFilename(filename);
  const isPdf = /\.pdf$/i.test(String(filename || filePath || ''));
  if (!nameHit && !isPdf) return null;
  if (!pdfParseFn && !nameHit) return null;
  try {
    const fs = require('fs');
    const pdfParse = pdfParseFn || require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(filePath));
    if (!nameHit && !looksLikeHealthSpringSupplementalText(data.text)) return null;
    return parseHealthSpringSupplementalText(data.text, filename);
  } catch (err) {
    console.error('[HEALTHSPRING-SUPP] parse failed:', err.message);
    return nameHit ? [] : null;
  }
}

module.exports = {
  parseMoney,
  looksLikeHealthSpringSupplementalText,
  isHealthSpringSupplementalFilename,
  parseHealthSpringSupplementalText,
  parseHealthSpringSupplementalPDF,
  tryParseHealthSpringSupplementalUpload,
};

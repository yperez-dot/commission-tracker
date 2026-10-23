'use strict';

const { agentNameMatches, agentNameInList } = require('./agentNameMatch');

/**
 * Shared payee / override schedule definitions.
 * Keep upload-time splits (files.js / records.js) aligned with statement builders.
 */

const INTEGRITY_AGENTS = Object.freeze([
  'christian munoz',
  'horacio mendieta',
  'cam insurance solutions corp',
]);

const MARCO_AGENTS = Object.freeze([
  'jena brewer',
  'kelly carpenter',
  'adrian cruz',
  'long khuu',
  'nicholas mccalla',
  'tyler payton',
  'anthony portorreal',
  'michael rivera',
  'cristy witcher',
  'michael mateo',
  'miriam jimenez',
  'jendy vanheyningen',
]);

/** Jendy leaves Marco $10 schedule starting this payment_period (YYYYMM). */
const MARCO_JENDY_CUTOFF = '202606';

const STATEMENT_TYPES = Object.freeze({
  /** Combined THEI share (NHP + BSI) — kept for scripts; House Statements UI uses the split types. */
  THEI_OVERRIDE: 'thei_override',
  /** THEI house — NHP agency statement sales / overrides only. */
  THEI_NHP: 'thei_nhp',
  /** THEI house — what BSI remits to THEI (BSI→THEI pay). */
  THEI_BSI: 'thei_bsi',
  /** BSI's share of Agency Override rows (house / residual view). */
  BSI_OVERRIDE: 'bsi_override',
  /** Marco $10 sub_agent_override rollup — Swan agency peel (display name Marco), not an agent. */
  MARCO: 'marco',
  /** Integrity Partners producer_payable (Chris / Horacio / CAM) — agency schedule. */
  INTEGRITY: 'integrity',
  /** Lina agent production (builder helper) — paid via Agent Statements, not Override Statements. */
  ALBA: 'alba',
});

function normName(name) {
  return String(name || '').toLowerCase().trim();
}

/** Integrity agent (middle initials / punctuation / case tolerant — see agentNameMatch). */
function isIntegrityAgent(agentName) {
  return agentNameInList(agentName, INTEGRITY_AGENTS);
}

/**
 * Integrity chargeback: a 'Chargeback' line for Munoz / CAM / Mendieta.
 * They are paid 50% of the override, so a chargeback takes back the same 50%
 * (and THEI / BSI give back their 25% each) — never 100% of the line.
 */
function isIntegrityChargeback(agentName, classification) {
  return isIntegrityAgent(agentName) &&
    String(classification || '').toLowerCase().trim() === 'chargeback';
}

/**
 * Integrity renewal: a 'Renewal' line for Munoz / CAM / Mendieta. They are not
 * paid renewals — the whole line is house pot (THEI / BSI 50/50), producer 0.
 */
function isIntegrityRenewal(agentName, classification) {
  return isIntegrityAgent(agentName) &&
    String(classification || '').toLowerCase().trim() === 'renewal';
}

/** Integrity new sale: a 'New Business' line for Munoz / CAM / Mendieta (paid 50%). */
function isIntegrityNewBusiness(agentName, classification) {
  return isIntegrityAgent(agentName) &&
    String(classification || '').toLowerCase().trim() === 'new business';
}

/**
 * Humana/Devoted BSI feeds carry a 'First Year/Renewal' column. Returns true when it
 * says renewal, false when it says first year, null when the column is missing/blank.
 */
function firstYearRenewalIsRenewal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = Object.keys(raw).find((k) => /^\s*first\s*year\s*\/\s*renewal\s*$/i.test(k));
  if (!key) return null;
  const v = String(raw[key] == null ? '' : raw[key]).trim().toLowerCase();
  if (!v) return null;
  return v.includes('renew') || v === 'rn' || v === 'r';
}

/** Swan/Marco agent (middle initials / punctuation / case tolerant — see agentNameMatch). */
function isMarcoAgent(agentName, paymentPeriod) {
  if (!agentNameInList(agentName, MARCO_AGENTS)) return false;
  if (agentNameMatches(agentName, 'jendy vanheyningen') && String(paymentPeriod || '') >= MARCO_JENDY_CUTOFF) {
    return false;
  }
  return true;
}

/**
 * THEI itself as the writing agent on a carrier feed ("The Health Experts Insurance",
 * "... LLC", "Health Experts", etc.).
 */
function isTheiWritingAgent(agentName) {
  return /\bhealth experts\b/.test(normName(agentName).replace(/[^a-z0-9]+/g, ' '));
}

/** Canonical payroll / statement display name for Alba / Lina Hernandez. */
const ALBA_DISPLAY_NAME = 'Lina Hernandez';

function isAlbaHernandez(agentName) {
  const n = normName(agentName);
  if (!n.includes('hernandez')) return false;
  // BSI labels her "Lina"; carrier feeds often use Alba / Alba Ritela.
  return n.includes('alba') || n.includes('lina') || n.includes('ritela');
}

/** Classifications paid to Lina as agent production (never Agency Override). */
function isAlbaAgentCommission(classification) {
  const c = String(classification || '').toLowerCase();
  if (c.includes('override')) return false;
  return (
    c.includes('new business') ||
    c.includes('renewal') ||
    c.includes('chargeback') ||
    c.includes('agent commission') ||
    c === 'commission'
  );
}

/** HRA payments (UHC "HA payment" / Humana HRA bonus) are paid through to Lina. */
function isAlbaHra(classification) {
  const c = String(classification || '').toLowerCase();
  return c.includes('hra');
}

function isAgencyOverride(classification) {
  return String(classification || '').toLowerCase().includes('override');
}

function normalizeSource(source) {
  return String(source || '').toUpperCase().trim();
}

/**
 * Oscar + all ACA LOBs live on NHP house statements — never BSI remittance / BSI Overrides.
 */
function isAcaNhpHouseRow(row = {}) {
  const lob = String(row.lob || '').toUpperCase().trim();
  if (lob === 'ACA') return true;
  const carrier = String(row.carrier || '').toLowerCase();
  if (/\boscar\b/.test(carrier)) return true;
  const plan = String(row.plan_type || row.planType || '').toLowerCase();
  if (plan.includes('aca') || /\boscar\b/.test(plan)) return true;
  return false;
}

/** NHP agency commission statements uploaded as source = NHP. */
function isNhpSource(source) {
  return normalizeSource(source) === 'NHP';
}

/**
 * Row belongs on THEI — NHP sales (source, payee, or upload filename).
 * Older uploads sometimes landed as direct_carrier with payee NHP / NHP filename.
 * ACA / Oscar always belong here even if source was mistagged BSI.
 */
function isNhpHouseRow(row = {}) {
  if (isAcaNhpHouseRow(row)) return true;
  if (isNhpSource(row.source)) return true;
  if (normalizeSource(row.payee) === 'NHP') return true;
  const fn = String(row.upload_original_name || row.original_name || '')
    .toLowerCase()
    .replace(/[\s()]/g, '_');
  if (!fn) return false;
  return (
    fn.includes('the_health_experts_insurance_statement') ||
    fn.includes('the_health_experst_insurance') ||
    (fn.includes('the_health_experts') && fn.includes('statement')) ||
    (fn.includes('yahoska') && fn.includes('katy')) ||
    (fn.includes('agency') && fn.includes('statement') && fn.includes('health_experts')) ||
    /(^|_)nhp(_|$)/.test(fn)
  );
}

/** BSI remittance / BSI payee feeds — money BSI pays THEI (never ACA/Oscar). */
function isBsiRemitSource(source, row = null) {
  if (row && isAcaNhpHouseRow(row)) return false;
  const s = normalizeSource(source);
  return s === 'BSI' || s === 'BSI_PAYEE';
}

/**
 * BSI other-agent house line: a BSI-feed row (not classified as an override) for an agent who
 * is not Lina/Alba and not Integrity (THEI-written lines included), with a stored THEI/BSI/Marco share. Upload
 * stores the 50/50 house split (Marco $10 first) on these rows, chargebacks included, so
 * House Statements list them as stored (never re-split at read time).
 */
function isBsiHouseSplitLine(row = {}) {
  if (!isBsiRemitSource(row.source, row)) return false;
  const cls = String(row.classification || '').toLowerCase();
  // Agent-production classes only (New Business / Renewal / Chargeback / Agent Commission),
  // and only rows the upload marked as split (split_applies) — older rows never qualify.
  if (!isAlbaAgentCommission(cls)) return false;
  const applies = row.split_applies != null ? row.split_applies : row.splitApplies;
  if (applies !== true && applies !== 't' && applies !== 'true') return false;
  const agent = row.agent_name != null ? row.agent_name : row.agent;
  if (isAlbaHernandez(agent) || isIntegrityAgent(agent)) return false;
  const n = normName(agent);
  // THEI-written lines (agent = THEI itself) are split 50/50 like other agents' lines.
  if (!n || n.includes('broker society')) return false;
  const v = (x) => Math.abs(parseFloat(x) || 0) >= 0.005;
  return v(row.thei_share) || v(row.bsi_share) || v(row.sub_agent_override);
}

function isTheiHouseType(statementType) {
  return (
    statementType === STATEMENT_TYPES.THEI_OVERRIDE ||
    statementType === STATEMENT_TYPES.THEI_NHP ||
    statementType === STATEMENT_TYPES.THEI_BSI
  );
}

module.exports = {
  isBsiHouseSplitLine,
  INTEGRITY_AGENTS,
  MARCO_AGENTS,
  MARCO_JENDY_CUTOFF,
  STATEMENT_TYPES,
  ALBA_DISPLAY_NAME,
  isIntegrityAgent,
  isIntegrityChargeback,
  isIntegrityRenewal,
  isIntegrityNewBusiness,
  firstYearRenewalIsRenewal,
  isMarcoAgent,
  isTheiWritingAgent,
  isAlbaHernandez,
  isAlbaAgentCommission,
  isAlbaHra,
  isAgencyOverride,
  isAcaNhpHouseRow,
  isNhpSource,
  isNhpHouseRow,
  isBsiRemitSource,
  isTheiHouseType,
  normName,
};

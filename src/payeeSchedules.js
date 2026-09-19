'use strict';

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

function isIntegrityAgent(agentName) {
  const n = normName(agentName);
  return INTEGRITY_AGENTS.some((a) => n.includes(a));
}

function isMarcoAgent(agentName, paymentPeriod) {
  const n = normName(agentName);
  if (!MARCO_AGENTS.some((a) => n.includes(a))) return false;
  if (n.includes('jendy vanheyningen') && String(paymentPeriod || '') >= MARCO_JENDY_CUTOFF) {
    return false;
  }
  return true;
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

/**
 * BSI → THE remittance upload filenames (what BSI pays THEI).
 * Carrier BSI feeds (UHC/Humana/Aetna statements) also use source=BSI — those are NOT remittance.
 */
function isTheRemittanceUploadName(name) {
  const f = String(name || '')
    .toLowerCase()
    .replace(/[\s()]/g, '_');
  if (!f) return false;
  return (
    /t\.?h\.?e[_.-]*statements?/.test(f) ||
    /the_statements?/.test(f) ||
    /thei_statement_bsi/.test(f) ||
    (/thei_statement/.test(f) && /bsi/.test(f)) ||
    /medicare[_-]?statement.*[_-]?the(i)?([_.-]|$)/.test(f)
  );
}

/**
 * Row belongs on THEI — BSI remittance (money BSI pays THEI).
 * Prefer remittance upload identity when present so carrier BSI statement peels
 * (also source=BSI) do not inflate the remittance house total.
 */
function isBsiRemitSource(source, row = null) {
  if (row && isAcaNhpHouseRow(row)) return false;
  if (row) {
    const fn = row.upload_original_name || row.original_name || '';
    if (fn) return isTheRemittanceUploadName(fn);
  }
  // Legacy / unit-test rows without an upload name: keep BSI source fallback.
  const s = normalizeSource(source);
  return s === 'BSI' || s === 'BSI_PAYEE';
}

function isTheiHouseType(statementType) {
  return (
    statementType === STATEMENT_TYPES.THEI_OVERRIDE ||
    statementType === STATEMENT_TYPES.THEI_NHP ||
    statementType === STATEMENT_TYPES.THEI_BSI
  );
}

module.exports = {
  INTEGRITY_AGENTS,
  MARCO_AGENTS,
  MARCO_JENDY_CUTOFF,
  STATEMENT_TYPES,
  ALBA_DISPLAY_NAME,
  isIntegrityAgent,
  isMarcoAgent,
  isAlbaHernandez,
  isAlbaAgentCommission,
  isAgencyOverride,
  isAcaNhpHouseRow,
  isNhpSource,
  isNhpHouseRow,
  isTheRemittanceUploadName,
  isBsiRemitSource,
  isTheiHouseType,
  normName,
};

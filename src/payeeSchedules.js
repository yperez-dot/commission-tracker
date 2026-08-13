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
  /** THEI's share of Agency Override rows (BSI→THEI remittance view). */
  THEI_OVERRIDE: 'thei_override',
  /** BSI's share of Agency Override rows (house / residual view). */
  BSI_OVERRIDE: 'bsi_override',
  /** Marco $10 sub_agent_override rollup across Marco downline. */
  MARCO: 'marco',
  /** Integrity Partners producer_payable (Chris / Horacio / CAM). */
  INTEGRITY: 'integrity',
  /** Alba Hernandez agent payout (producer_payable). */
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

function isAlbaHernandez(agentName) {
  const n = normName(agentName);
  return n.includes('alba') && n.includes('hernandez');
}

/** Classifications THEI/BSI pays Alba as agent commission (not agency override). */
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

module.exports = {
  INTEGRITY_AGENTS,
  MARCO_AGENTS,
  MARCO_JENDY_CUTOFF,
  STATEMENT_TYPES,
  isIntegrityAgent,
  isMarcoAgent,
  isAlbaHernandez,
  isAlbaAgentCommission,
  isAgencyOverride,
  normName,
};

'use strict';

/**
 * THEI principal / direct Medicare agents — single source of truth.
 *
 * Direct agents (Sales Recon, dashboard agent view): Yahoska, Katy, Carolina.
 * Missing Renewals BOB scope stays Yahoska + Katy only (ops rule).
 */

/** Carrier-commission Medicare writers on THEI house (Sales Recon direct-agents filter). */
const THEI_DIRECT_AGENTS = Object.freeze([
  'Yahoska Perez',
  'Katy Robles',
  'Carolina Robles',
]);

/** House/agency production payee in commission_records. */
const THEI_HOUSE_AGENT = 'The Health Experts Insurance';

/** Dashboard Agent view — principal production (direct writers + house). */
const DASHBOARD_PRINCIPAL_AGENTS = Object.freeze([
  ...THEI_DIRECT_AGENTS,
  THEI_HOUSE_AGENT,
]);

/** Admin dashboard sidebar agent filter (principals + common downline). */
const DASHBOARD_MY_AGENTS = Object.freeze([
  ...THEI_DIRECT_AGENTS,
  THEI_HOUSE_AGENT,
  'Gina Berenguer',
  'Jill Taylor',
  'Osmary Orozco',
  'Sabri Perez',
]);

function normalizeAgentKey(name) {
  return String(name || '').toLowerCase().trim();
}

/** Sales Recon / dashboard: Yahoska, Katy, Carolina (+ name variants). */
function isTheiDirectAgent(agentName) {
  const n = normalizeAgentKey(agentName);
  if (!n) return false;
  return THEI_DIRECT_AGENTS.some((canonical) => {
    const c = canonical.toLowerCase();
    if (n.includes(c) || c.includes(n)) return true;
    const tokens = c.split(/\s+/).filter(Boolean);
    return tokens.length >= 2 && tokens.every((t) => n.includes(t));
  });
}

/**
 * Missing Renewals default BOB scope — Yahoska + Katy only (not Carolina).
 * Per ops: renewals chase is principals' BOB, not all direct writers.
 */
function isTheiPrincipalAgent(agentName) {
  const a = normalizeAgentKey(agentName);
  return (
    a.includes('yahoska') ||
    a.includes('katy') ||
    a.includes('perez, yahoska') ||
    a.includes('robles, katy')
  );
}

function directAgentsLabel() {
  return THEI_DIRECT_AGENTS.map((n) => n.split(' ')[0]).join(', ');
}

module.exports = {
  THEI_DIRECT_AGENTS,
  THEI_HOUSE_AGENT,
  DASHBOARD_PRINCIPAL_AGENTS,
  DASHBOARD_MY_AGENTS,
  isTheiDirectAgent,
  isTheiPrincipalAgent,
  directAgentsLabel,
};

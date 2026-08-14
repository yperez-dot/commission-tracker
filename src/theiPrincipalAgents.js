'use strict';

/**
 * THEI principal / direct Medicare agents — single source of truth.
 *
 * Direct agents (Sales Recon, dashboard agent view): Yahoska, Katy, Carolina,
 * plus THEI house writing name (UHC statements often post as agency, not personal).
 * Missing Renewals BOB scope stays Yahoska + Katy only (ops rule).
 *
 * Alan Elchami (Eidi Alan): pre–writing-name-change UHC posted on Yahoska's writer /
 * house name — his production, not Yahoska's. Tag those rows as `Alan Elchami` in DB;
 * names here are excluded from direct/principal filters even if logic changes later.
 */

/** Carrier-commission Medicare writers on THEI house (Sales Recon direct-agents filter). */
const THEI_DIRECT_AGENTS = Object.freeze([
  'Yahoska Perez',
  'Katy Robles',
  'Carolina Robles',
]);

/** House/agency production payee in commission_records. */
const THEI_HOUSE_AGENT = 'The Health Experts Insurance';

/** UHC / carrier writing-agent strings that map to THEI house (see routes/files.js isAgencyName). */
const THEI_HOUSE_WRITING_KEYS = Object.freeze([
  'the health experts insurance',
  'the health experts',
  'health experts insurance',
  'health experts',
]);

/** Dashboard Agent view — principal production (direct writers + house). */
const DASHBOARD_PRINCIPAL_AGENTS = Object.freeze([
  ...THEI_DIRECT_AGENTS,
  THEI_HOUSE_AGENT,
]);

/**
 * Downline whose production must never roll into direct/principal views
 * (paid separately; may have posted under house writing before UHC name change).
 */
const THEI_EXCLUDED_FROM_DIRECT = Object.freeze([
  'Alan Elchami',
  'Eidi Alan',
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

/** Known downline excluded from direct/principal production (see module header). */
function isTheiExcludedFromDirect(agentName) {
  const n = normalizeAgentKey(agentName);
  if (!n) return false;
  return THEI_EXCLUDED_FROM_DIRECT.some((canonical) => {
    const c = canonical.toLowerCase();
    if (n.includes(c) || c.includes(n)) return true;
    const tokens = c.split(/\s+/).filter(Boolean);
    return tokens.length >= 2 && tokens.every((t) => n.includes(t));
  });
}

/** UHC (and some carrier feeds): writing agent = THEI house, not a person's name. */
function isTheiHouseWritingName(agentName) {
  const n = normalizeAgentKey(agentName);
  if (!n) return false;
  return THEI_HOUSE_WRITING_KEYS.some((key) => n.includes(key));
}

/** Sales Recon / dashboard: direct writers + THEI house UHC writing. */
function isTheiDirectAgent(agentName) {
  if (isTheiExcludedFromDirect(agentName)) return false;
  if (isTheiHouseWritingName(agentName)) return true;
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
  const names = THEI_DIRECT_AGENTS.map((n) => n.split(' ')[0]).join(', ');
  return `${names} + THEI house (UHC writing)`;
}

module.exports = {
  THEI_DIRECT_AGENTS,
  THEI_HOUSE_AGENT,
  THEI_EXCLUDED_FROM_DIRECT,
  DASHBOARD_PRINCIPAL_AGENTS,
  DASHBOARD_MY_AGENTS,
  isTheiDirectAgent,
  isTheiExcludedFromDirect,
  isTheiHouseWritingName,
  isTheiPrincipalAgent,
  directAgentsLabel,
};

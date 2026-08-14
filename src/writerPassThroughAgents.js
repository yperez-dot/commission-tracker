'use strict';

/**
 * Downline agents who write on Yahoska's UHC / house writer number.
 * Carrier chargebacks hit the house; the liable agent owes THEI back.
 *
 * Alan Elchami: Katy audit list (historical). Sabri Perez: add clients as she enrolls.
 */

const THEI_HOUSE_AGENT = 'The Health Experts Insurance';

const THEI_HOUSE_WRITING_KEYS = Object.freeze([
  'the health experts insurance',
  'the health experts',
  'health experts insurance',
  'health experts',
]);

function normalizeKey(value) {
  return String(value || '').toLowerCase().trim();
}

function isTheiHouseWritingName(agentName) {
  const n = normalizeKey(agentName);
  if (!n) return false;
  return THEI_HOUSE_WRITING_KEYS.some((key) => n.includes(key));
}

/** Katy audit — Alan Elchami clients (UHC posted on house writer). */
const ALAN_ELCHAMI_CLIENT_PATTERNS = Object.freeze([
  { label: 'Winston Benjamin', test: (n) => /winston.*benjamin|benjamin.*winston/i.test(n) },
  { label: 'Barbara Ferring', test: (n) => /barbara.*ferring|ferring.*barbara/i.test(n) },
  { label: 'Willie Nelson', test: (n) => /willie.*nelson|nelson.*willie/i.test(n) },
  { label: 'Kenneth Nelson', test: (n) => /kenneth.*nelson|nelson.*kenneth/i.test(n) },
  { label: 'Cheryl Thielen', test: (n) => /cheryl.*thielen|thielen.*cheryl/i.test(n) },
  { label: 'Deloris Moise', test: (n) => /deloris.*moise|moise.*deloris/i.test(n) },
  { label: 'Leila Henry', test: (n) => /leila.*henry|henry.*leila/i.test(n) },
  { label: 'Wade Daniels', test: (n) => /wade.*daniels|daniels.*wade/i.test(n) },
  { label: 'Mary Carman', test: (n) => /mary.*carman|carman.*mary/i.test(n) },
  { label: 'Frances Lambert', test: (n) => /frances.*lambert|lambert.*frances/i.test(n) },
  { label: 'Linda Forman', test: (n) => /linda.*forman|forman.*linda/i.test(n) },
  { label: 'John Scheibl', test: (n) => /john.*scheibl|scheibl.*john/i.test(n) },
  { label: 'Yvetane Vilmael', test: (n) => /yvetane.*vilmael|vilmael.*yvetane/i.test(n) },
  { label: 'Joivil Vilmael', test: (n) => /joivil.*vilmael|vilmael.*joivil/i.test(n) },
  {
    label: 'Maria Guillaume',
    test: (n) => /maria.*guillaume|guillaume.*maria|marie.*guillaume|guillaume.*marie/i.test(n),
  },
  { label: 'Melba Elwell', test: (n) => /melba.*elwell|elwell.*melba/i.test(n) },
  { label: 'Herbert Raymond', test: (n) => /herbert.*raymond|raymond.*herbert/i.test(n) },
  {
    label: 'Elaine Bertram Raymond',
    test: (n) => /elaine.*raymond|raymond.*elaine|bertram.*raymond/i.test(n),
  },
  { label: 'Beverly Brown', test: (n) => /beverly.*brown|brown.*beverly/i.test(n) },
  { label: 'Wendy Chapman', test: (n) => /wendy.*chapman|chapman.*wendy/i.test(n) },
  { label: 'Inese Jean', test: (n) => /inese.*jean|jean.*inese/i.test(n) },
  { label: 'Lynn Jones', test: (n) => /lynn.*jones|jones.*lynn/i.test(n) },
]);

/**
 * @typedef {object} PassThroughAgentConfig
 * @property {string} canonicalName
 * @property {string[]} aliases
 * @property {readonly {label:string, test:(n:string)=>boolean}[]} clientPatterns
 * @property {boolean} matchMedicareProAgent — when house writing, use sale agent if listed
 * @property {string|null} notes
 */

/** @type {readonly PassThroughAgentConfig[]} */
const WRITER_PASS_THROUGH_AGENTS = Object.freeze([
  Object.freeze({
    canonicalName: 'Alan Elchami',
    aliases: Object.freeze(['alan elchami', 'eidi alan']),
    clientPatterns: ALAN_ELCHAMI_CLIENT_PATTERNS,
    matchMedicareProAgent: false,
    notes: 'Katy audit list — historical UHC on house writer; no longer uses Yahoska number.',
  }),
  Object.freeze({
    canonicalName: 'Sabri Perez',
    aliases: Object.freeze(['sabri perez', 'sabri']),
    clientPatterns: Object.freeze([]),
    matchMedicareProAgent: true,
    notes: 'Will write on Yahoska UHC number — add client patterns or rely on MedicarePro agent.',
  }),
]);

function matchesPassThroughAgentName(agentName, config) {
  const n = normalizeKey(agentName);
  if (!n) return false;
  const canonical = normalizeKey(config.canonicalName);
  if (n.includes(canonical) || canonical.includes(n)) return true;
  return config.aliases.some((alias) => {
    const a = normalizeKey(alias);
    return n.includes(a) || a.includes(n);
  });
}

function clientMatchesPassThroughPatterns(clientName, patterns) {
  const n = String(clientName || '').trim();
  if (!n) return false;
  return patterns.some((p) => p.test(n));
}

function isPrincipalWriterHit(agentName) {
  const n = normalizeKey(agentName);
  if (!n) return false;
  if (isTheiHouseWritingName(agentName)) return true;
  if (n === normalizeKey(THEI_HOUSE_AGENT)) return true;
  return n.includes('yahoska') || n.includes('perez, yahoska');
}

/**
 * Resolve downline agent who owes THEI when a chargeback hits house/principal writer.
 * @param {{ agentName?: string, clientName?: string, commission?: number, saleAgentName?: string|null }} row
 * @returns {string|null}
 */
function resolvePassThroughLiableAgent(row) {
  const commission = parseFloat(row.commission);
  if (!Number.isFinite(commission) || commission >= 0) return null;

  for (const config of WRITER_PASS_THROUGH_AGENTS) {
    if (matchesPassThroughAgentName(row.agentName, config)) {
      return config.canonicalName;
    }
  }

  if (!isPrincipalWriterHit(row.agentName)) return null;

  for (const config of WRITER_PASS_THROUGH_AGENTS) {
    if (clientMatchesPassThroughPatterns(row.clientName, config.clientPatterns)) {
      return config.canonicalName;
    }
  }

  if (row.saleAgentName) {
    for (const config of WRITER_PASS_THROUGH_AGENTS) {
      if (config.matchMedicareProAgent && matchesPassThroughAgentName(row.saleAgentName, config)) {
        return config.canonicalName;
      }
    }
  }

  return null;
}

function listPassThroughAgents() {
  return WRITER_PASS_THROUGH_AGENTS.map((a) => ({
    name: a.canonicalName,
    clientCount: a.clientPatterns.length,
    matchMedicareProAgent: a.matchMedicareProAgent,
    notes: a.notes,
  }));
}

module.exports = {
  WRITER_PASS_THROUGH_AGENTS,
  ALAN_ELCHAMI_CLIENT_PATTERNS,
  resolvePassThroughLiableAgent,
  matchesPassThroughAgentName,
  clientMatchesPassThroughPatterns,
  isPrincipalWriterHit,
  listPassThroughAgents,
};

'use strict';

/**
 * BSI Statements Upload attribution for Alba/Lina agent production.
 *
 * Carrier→BSI feeds often list Writing Agent as "Broker Society Insurance"
 * for Alba/Lina's book, and historically left producer_payable null — so
 * August+ Lina payroll would miss those lines without a BSI payee PDF.
 *
 * Rules:
 *  - Agency Override / Held → leave agent as-is; producer_payable = 0
 *  - NB / Renewal / Chargeback / Agent Commission:
 *      • BSI house writing agent, Alba NPN 21209073, or Alba/Lina name
 *        → agent = Alba Hernandez, producer_payable = commission
 *      • Any other individual writing agent → leave unchanged
 *        (other agents are paid via Commission Statements / splits;
 *         do not invent producer_payable on the BSI feed)
 */

const {
  isAlbaHernandez,
  isAlbaAgentCommission,
  isAgencyOverride,
  normName,
} = require('./payeeSchedules');

/** Canonical DB agent for Lina/Alba book (UI displays as Lina). */
const ALBA_DB_AGENT = 'Alba Hernandez';

/** Alba / Lina NPN on BSI feeds. */
const ALBA_NPN = '21209073';

function isBsiHouseAgent(name) {
  const n = normName(name);
  if (!n) return true;
  return (
    n.includes('broker society') ||
    n === 'bsi' ||
    n === 'bsi agent' ||
    n === 'broker society insurance / level up insurance'
  );
}

function isHeldClassification(classification) {
  return String(classification || '').toLowerCase().includes('held');
}

function extractWritingNpn(record) {
  const raw = record.raw || {};
  return String(
    record.writingNpn ||
      raw['Writing Agent NPN'] ||
      raw['Writing Agent NPN '] ||
      raw['NPN'] ||
      ''
  )
    .trim()
    .replace(/\.0$/, '');
}

/**
 * Apply attribution + producer_payable to parsed BSI statement records (in place).
 * Returns the same array for chaining.
 */
function applyBsiBookAgentProduction(records) {
  if (!Array.isArray(records)) return records;

  let remapped = 0;
  let payableSet = 0;

  for (const r of records) {
    const classification = r.classification || '';
    const commission = parseFloat(r.commission) || 0;

    if (isAgencyOverride(classification) || isHeldClassification(classification)) {
      if (r.producerPayable == null) r.producerPayable = 0;
      if (r.splitApplies == null) r.splitApplies = false;
      if (!r.source) r.source = 'BSI';
      continue;
    }

    // Treat generic "Agent Commission" as agent production too
    const agentProd =
      isAlbaAgentCommission(classification) ||
      String(classification).toLowerCase() === 'agent commission';
    if (!agentProd) {
      if (!r.source) r.source = 'BSI';
      continue;
    }

    const npn = extractWritingNpn(r);
    const isAlbaNpn = npn === ALBA_NPN;
    const house = isBsiHouseAgent(r.agent);
    const albaNamed = isAlbaHernandez(r.agent);

    // Only Alba's book on this feed — do not attribute other agents' lines.
    if (!(house || isAlbaNpn || albaNamed)) {
      if (!r.source) r.source = 'BSI';
      continue;
    }

    if (normName(r.agent) !== normName(ALBA_DB_AGENT)) remapped += 1;
    r.agent = ALBA_DB_AGENT;
    r.producerPayable = commission;
    r.grossCommission = r.grossCommission != null ? r.grossCommission : commission;
    r.theiShare = 0;
    r.bsiShare = 0;
    r.splitApplies = false;
    r.payee = r.payee || 'BSI';
    r.source = r.source || 'BSI';
    payableSet += 1;
  }

  console.log(
    `[BSI-ATTR] agent-production payable set=${payableSet}, BSI-house→Alba remapped=${remapped}`
  );
  return records;
}

module.exports = {
  ALBA_DB_AGENT,
  ALBA_NPN,
  isBsiHouseAgent,
  applyBsiBookAgentProduction,
  extractWritingNpn,
};

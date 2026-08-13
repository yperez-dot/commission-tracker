'use strict';

/**
 * Shared THEI/BSI agency-override split math.
 *
 * Conventions:
 * - BSI payee books (consolidated / carrier statements): `commission` is the
 *   FULL override pot → THEI 50% / BSI 50% (after Marco $10 or Integrity cut).
 * - THE remittance half-model: `commission` is already THEI's half → mirror to
 *   BSI and set gross = 2× commission.
 */

const { isIntegrityAgent, isMarcoAgent } = require('./payeeSchedules');

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Split a full override pot (BSI-book convention).
 * @param {number} pot
 * @param {{ agentName?: string, paymentPeriod?: string, alreadyDeducted?: boolean }} opts
 */
function splitFullOverridePot(pot, opts = {}) {
  const gross = num(pot);
  const agentName = opts.agentName || '';
  const period = opts.paymentPeriod || '';

  if (isIntegrityAgent(agentName)) {
    const producerPayable = round2(gross * 0.5);
    const theiShare = round2(gross * 0.25);
    const bsiShare = round2(gross * 0.25);
    return {
      grossCommission: gross,
      theiShare,
      bsiShare,
      producerPayable,
      subAgentOverride: 0,
      splitApplies: false,
      schedule: 'integrity_50_25_25',
    };
  }

  if (isMarcoAgent(agentName, period)) {
    const already = !!opts.alreadyDeducted;
    if (!already && Math.abs(gross) >= 10) {
      const sign = gross < 0 ? -1 : 1;
      const sub = 10 * sign;
      const remaining = gross - sub;
      return {
        grossCommission: gross,
        theiShare: round2(remaining / 2),
        bsiShare: round2(remaining / 2),
        producerPayable: 0,
        subAgentOverride: sub,
        splitApplies: true,
        schedule: 'marco_10_then_50_50',
      };
    }
    return {
      grossCommission: gross,
      theiShare: round2(gross / 2),
      bsiShare: round2(gross / 2),
      producerPayable: 0,
      subAgentOverride: 0,
      splitApplies: true,
      schedule: 'marco_50_50',
    };
  }

  return {
    grossCommission: gross,
    theiShare: round2(gross / 2),
    bsiShare: round2(gross / 2),
    producerPayable: 0,
    subAgentOverride: 0,
    splitApplies: true,
    schedule: 'standard_50_50',
  };
}

/**
 * Legacy THE remittance half-model: amount is already THEI's half of a 50/50.
 */
function splitTheRemittanceHalf(halfAmount) {
  const half = num(halfAmount);
  return {
    grossCommission: round2(half * 2),
    theiShare: half,
    bsiShare: half,
    producerPayable: 0,
    subAgentOverride: 0,
    splitApplies: true,
    schedule: 'the_remittance_half_model',
  };
}

/**
 * Normalize filename for payee / source detectors (spaces → underscores).
 */
function normalizeFilename(filename) {
  return String(filename || '')
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * True when filename / payee indicates a BSI agency book (full-pot commission).
 */
function isBsiBookPayee(payee, filename) {
  const p = String(payee || '').toLowerCase().trim();
  if (p === 'bsi') return true;
  const f = normalizeFilename(filename);
  return (
    f.includes('statement-health_experts') ||
    f.includes('statement_health_experts') ||
    f.includes('broker_society') ||
    f.includes('brokersociety') ||
    (f.includes('bsi') && f.includes('statement'))
  );
}

module.exports = {
  num,
  round2,
  splitFullOverridePot,
  splitTheRemittanceHalf,
  normalizeFilename,
  isBsiBookPayee,
};

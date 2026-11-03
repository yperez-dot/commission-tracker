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

const {
  isIntegrityAgent,
  isIntegrityChargeback,
  isIntegrityRenewal,
  isIntegrityNewBusiness,
  isMarcoAgent,
} = require('./payeeSchedules');

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** 50/50 house split that always sums to `gross`. Extra half-cent goes to THEI (both signs). */
function splitEvenHouse(gross) {
  const g = round2(num(gross));
  const sign = g < 0 ? -1 : 1;
  const abs = Math.abs(g);
  const theiAbs = round2(abs / 2);
  const bsiAbs = round2(abs - theiAbs);
  return { theiShare: round2(sign * theiAbs), bsiShare: round2(sign * bsiAbs) };
}

/** Integrity 50/25/25 that always sums to `gross`. Remainder cent goes to THEI. */
function splitIntegrityThreeWay(gross) {
  const g = round2(num(gross));
  const producerPayable = round2(g * 0.5);
  const bsiShare = round2(g * 0.25);
  const theiShare = round2(g - producerPayable - bsiShare);
  return { producerPayable, theiShare, bsiShare };
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
    const three = splitIntegrityThreeWay(gross);
    return {
      grossCommission: gross,
      theiShare: three.theiShare,
      bsiShare: three.bsiShare,
      producerPayable: three.producerPayable,
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
      const remaining = round2(gross - sub);
      const house = splitEvenHouse(remaining);
      return {
        grossCommission: gross,
        theiShare: house.theiShare,
        bsiShare: house.bsiShare,
        producerPayable: 0,
        subAgentOverride: sub,
        splitApplies: true,
        schedule: 'marco_10_then_50_50',
      };
    }
    const house = splitEvenHouse(gross);
    return {
      grossCommission: gross,
      theiShare: house.theiShare,
      bsiShare: house.bsiShare,
      producerPayable: 0,
      subAgentOverride: 0,
      splitApplies: true,
      schedule: 'marco_50_50',
    };
  }

  const house = splitEvenHouse(gross);
  return {
    grossCommission: gross,
    theiShare: house.theiShare,
    bsiShare: house.bsiShare,
    producerPayable: 0,
    subAgentOverride: 0,
    splitApplies: true,
    schedule: 'standard_50_50',
  };
}

/**
 * Integrity (Munoz / CAM / Mendieta) chargeback → same 50 / 25 / 25 split as the
 * override it reverses, so the producer gives back exactly what they were paid.
 * Returns null for any other agent or classification (caller keeps its logic).
 */
function splitIntegrityChargeback(amount, agentName, classification) {
  if (!isIntegrityChargeback(agentName, classification)) return null;
  const gross = num(amount);
  const three = splitIntegrityThreeWay(gross);
  return {
    grossCommission: gross,
    theiShare: three.theiShare,
    bsiShare: three.bsiShare,
    producerPayable: three.producerPayable,
    subAgentOverride: 0,
    splitApplies: false,
    schedule: 'integrity_chargeback_50_25_25',
  };
}

/**
 * Integrity (Munoz / CAM / Mendieta) renewal on a BSI feed → not paid to the
 * producer; the line is house pot split THEI 50% / BSI 50%.
 * Returns null for any other agent or classification.
 */
function splitIntegrityRenewal(amount, agentName, classification) {
  if (!isIntegrityRenewal(agentName, classification)) return null;
  return splitHouseOnly(amount);
}

/** Producer 0, whole line split THEI 50% / BSI 50% (odd cent to THEI). */
function splitHouseOnly(amount) {
  const gross = num(amount);
  const house = splitEvenHouse(gross);
  return {
    grossCommission: gross,
    theiShare: house.theiShare,
    bsiShare: house.bsiShare,
    producerPayable: 0,
    subAgentOverride: 0,
    splitApplies: true,
    schedule: 'integrity_renewal_house_50_50',
  };
}

/**
 * Integrity (Munoz / CAM / Mendieta) new sale on a BSI UHC / Aetna feed → 50% producer,
 * 25% THEI, 25% BSI. Returns null for any other agent or classification.
 */
function splitIntegrityNewBusiness(amount, agentName, classification) {
  if (!isIntegrityNewBusiness(agentName, classification)) return null;
  return { ...splitFullOverridePot(amount, { agentName }), schedule: 'integrity_new_sale_50_25_25' };
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

/**
 * True when an Agency Override row has dollars on `commission` but no THEI/BSI shares.
 * Carrier→BSI Humana/Devoted uploads wrote commission only (House Statements then shows $0).
 */
function rowNeedsBsiOverrideShareFill(row = {}) {
  const cls = String(row.classification || '').toLowerCase();
  if (!cls.includes('override')) return false;
  const thei = num(row.thei_share != null ? row.thei_share : row.theiShare);
  const bsi = num(row.bsi_share != null ? row.bsi_share : row.bsiShare);
  const comm = num(row.commission);
  return thei === 0 && bsi === 0 && comm !== 0;
}

/**
 * Stored THEI/BSI share, or the BSI-book split of `commission` when shares were never written.
 * Does not invent a share when the other side is already populated.
 */
function resolveBsiBookShare(row, field) {
  const storedThei = num(row.thei_share != null ? row.thei_share : row.theiShare);
  const storedBsi = num(row.bsi_share != null ? row.bsi_share : row.bsiShare);
  const stored = field === 'bsi_share' ? storedBsi : storedThei;
  if (stored !== 0) return stored;
  if (storedThei !== 0 || storedBsi !== 0) return stored;
  if (!rowNeedsBsiOverrideShareFill(row)) return stored;
  const split = splitFullOverridePot(num(row.commission), {
    agentName: row.agent_name || row.agent,
    paymentPeriod: row.payment_period || row.period,
    alreadyDeducted:
      num(row.sub_agent_override != null ? row.sub_agent_override : row.subAgentOverride) !== 0,
  });
  return field === 'bsi_share' ? split.bsiShare : split.theiShare;
}

/**
 * Compute persistable THEI/BSI share updates for BSI Agency Override rows.
 * `deductedPolicies` is a Set of policy numbers that already took Marco's $10.
 */
function computeBsiOverrideShareUpdates(rows, deductedPolicies) {
  const deducted = deductedPolicies instanceof Set ? deductedPolicies : new Set(deductedPolicies || []);
  const sorted = [...(rows || [])].sort((a, b) => {
    const p = String(a.payment_period || a.period || '').localeCompare(String(b.payment_period || b.period || ''));
    if (p !== 0) return p;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
  return sorted.map((row) => {
    const policy = row.policy_number || row.policyNumber;
    const split = splitFullOverridePot(num(row.commission), {
      agentName: row.agent_name || row.agent,
      paymentPeriod: row.payment_period || row.period,
      alreadyDeducted: deducted.has(policy),
    });
    if (split.subAgentOverride) deducted.add(policy);
    return { id: row.id, policyNumber: policy, ...split };
  });
}

module.exports = {
  num,
  round2,
  splitEvenHouse,
  splitIntegrityThreeWay,
  splitFullOverridePot,
  splitIntegrityChargeback,
  splitIntegrityRenewal,
  splitIntegrityNewBusiness,
  splitHouseOnly,
  splitTheRemittanceHalf,
  normalizeFilename,
  isBsiBookPayee,
  rowNeedsBsiOverrideShareFill,
  resolveBsiBookShare,
  computeBsiOverrideShareUpdates,
};

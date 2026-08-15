'use strict';

/**
 * NHP Medicare Agency Override → THEI / BSI / producer / Marco peel.
 * Keep statement fields aligned with overrideStatementBuilder:
 * - Integrity producer cuts → producer_payable (never sub_agent_override)
 * - Marco $10 peel → sub_agent_override
 */

const { isIntegrityAgent, isMarcoAgent } = require('./payeeSchedules');
const { splitFullOverridePot, round2, num } = require('./overrideSplitMath');

/** Fixed Chris/Horacio NB cuts on select carriers (NHP honor pots). */
function integrityFixedProducerCut(carrier) {
  const c = String(carrier || '').toLowerCase();
  if (c.includes('unitedhealthcare') || c.includes('united healthcare')) return 82.5;
  if (c.includes('doctors')) return 50;
  if (c.includes('solis')) return 62.5;
  if (c.includes('healthsun')) return 52.5;
  return 0;
}

function isNhpIntegrityFixedNb(agentName, carrier, classification) {
  if (!isIntegrityAgent(agentName)) return false;
  const n = String(agentName || '').toLowerCase();
  // Fixed-rate schedule is Chris/Horacio only (not CAM — CAM uses 50/25/25).
  if (!n.includes('christian munoz') && !n.includes('horacio mendieta')) return false;
  if (integrityFixedProducerCut(carrier) <= 0) return false;
  const cls = String(classification || '').toLowerCase();
  if (cls.includes('renewal') || cls.includes('carry')) return false;
  return cls.includes('new') || cls.includes('initial') || cls.includes('override') || !cls;
}

/**
 * @param {{
 *   pot: number,
 *   agentName: string,
 *   carrier: string,
 *   classification?: string,
 *   paymentPeriod?: string,
 *   isBsiEligible: boolean,
 *   alreadyDeducted?: boolean,
 * }} opts
 */
function splitNhpMedicareOverride(opts) {
  const pot = num(opts.pot);
  const agentName = opts.agentName || '';
  const period = opts.paymentPeriod || '';
  const isBsiEligible = !!opts.isBsiEligible;

  if (isNhpIntegrityFixedNb(agentName, opts.carrier, opts.classification) && pot > 0) {
    const producerPayable = integrityFixedProducerCut(opts.carrier);
    const remaining = Math.max(0, pot - producerPayable);
    if (isBsiEligible) {
      return {
        grossCommission: pot,
        theiShare: round2(remaining * 0.5),
        bsiShare: round2(remaining * 0.5),
        producerPayable,
        subAgentOverride: 0,
        splitApplies: true,
        schedule: 'nhp_integrity_fixed_then_50_50',
      };
    }
    return {
      grossCommission: pot,
      theiShare: remaining,
      bsiShare: 0,
      producerPayable,
      subAgentOverride: 0,
      splitApplies: false,
      schedule: 'nhp_integrity_fixed_thei_keeps_rest',
    };
  }

  if (isIntegrityAgent(agentName)) {
    // CAM + Integrity renewals / other carriers: standard 50/25/25 on full pot
    const split = splitFullOverridePot(pot, { agentName, paymentPeriod: period });
    if (!isBsiEligible) {
      // Pre–BSI-split: THEI keeps house remainder; producer still gets 50%
      return {
        ...split,
        theiShare: round2(split.theiShare + split.bsiShare),
        bsiShare: 0,
        splitApplies: false,
        schedule: 'nhp_integrity_50_thei_keeps_house',
      };
    }
    return split;
  }

  if (isMarcoAgent(agentName, period)) {
    const split = splitFullOverridePot(pot, {
      agentName,
      paymentPeriod: period,
      alreadyDeducted: !!opts.alreadyDeducted,
    });
    if (!isBsiEligible) {
      return {
        ...split,
        theiShare: round2(split.theiShare + split.bsiShare),
        bsiShare: 0,
        splitApplies: false,
        schedule: split.schedule === 'marco_10_then_50_50'
          ? 'nhp_marco_10_thei_keeps_rest'
          : 'nhp_marco_thei_keeps_rest',
      };
    }
    return split;
  }

  if (isBsiEligible) {
    return splitFullOverridePot(pot, { agentName, paymentPeriod: period });
  }
  return {
    grossCommission: pot,
    theiShare: pot,
    bsiShare: 0,
    producerPayable: 0,
    subAgentOverride: 0,
    splitApplies: false,
    schedule: 'nhp_thei_100',
  };
}

module.exports = {
  integrityFixedProducerCut,
  isNhpIntegrityFixedNb,
  splitNhpMedicareOverride,
};

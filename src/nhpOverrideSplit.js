'use strict';

/**
 * NHP Medicare Agency Override → THEI / BSI / producer / Marco peel.
 * Keep statement fields aligned with overrideStatementBuilder:
 * - Integrity producer cuts → producer_payable (never sub_agent_override)
 * - Marco $10 peel → sub_agent_override
 */

const { isIntegrityAgent, isMarcoAgent } = require('./payeeSchedules');
const { splitFullOverridePot, round2, num } = require('./overrideSplitMath');

/**
 * Fixed Integrity new-sale cuts per carrier (NHP honor pots), by plan year where known.
 *   UHC: plan year 2026 = $82.50 for Chris (Munoz + CAM) and Horacio Mendieta.
 *        Other / unknown plan years keep the earlier $82.50 (not yet confirmed).
 *   Doctors $50 / Solis $62.50 / HealthSun $52.50: Chris and Horacio only (CAM is 50/25/25).
 */
const INTEGRITY_FIXED_CUTS = Object.freeze({
  uhc: { byPlanYear: { 2026: 82.5 }, fallback: 82.5, includesCam: true },
  doctors: { byPlanYear: {}, fallback: 50, includesCam: false },
  solis: { byPlanYear: {}, fallback: 62.5, includesCam: false },
  healthsun: { byPlanYear: {}, fallback: 52.5, includesCam: false },
});

function fixedCutCarrierKey(carrier) {
  const c = String(carrier || '').toLowerCase();
  if (c.includes('unitedhealthcare') || c.includes('united healthcare')) return 'uhc';
  if (c.includes('doctors')) return 'doctors';
  if (c.includes('solis')) return 'solis';
  if (c.includes('healthsun')) return 'healthsun';
  return null;
}

function planYearOf(effectiveDate) {
  const s = String(effectiveDate || '');
  const m = s.match(/(20\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}

/** Fixed cut for a carrier (and plan year when given). 0 = no fixed cut. */
function integrityFixedProducerCut(carrier, effectiveDate) {
  const key = fixedCutCarrierKey(carrier);
  if (!key) return 0;
  const row = INTEGRITY_FIXED_CUTS[key];
  const y = planYearOf(effectiveDate);
  if (y && row.byPlanYear[y] != null) return row.byPlanYear[y];
  return row.fallback;
}

/** Agent is on the fixed-cut schedule for this carrier (CAM only where the table says so). */
function agentHasFixedCut(agentName, carrier) {
  if (!isIntegrityAgent(agentName)) return false;
  const key = fixedCutCarrierKey(carrier);
  if (!key) return false;
  const n = String(agentName || '').toLowerCase();
  if (n.includes('christian munoz') || n.includes('horacio mendieta')) return true;
  return n.includes('cam insurance solutions corp') && INTEGRITY_FIXED_CUTS[key].includesCam;
}

function isNhpIntegrityFixedNb(agentName, carrier, classification) {
  if (!agentHasFixedCut(agentName, carrier)) return false;
  const cls = String(classification || '').toLowerCase();
  if (cls.includes('renewal') || cls.includes('carry')) return false;
  return cls.includes('new') || cls.includes('initial') || cls.includes('override') || !cls;
}

/** Integrity agent on a carrier with a fixed new-sale cut (see INTEGRITY_FIXED_CUTS). */
function isChrisOrHoracioFixedCarrier(agentName, carrier) {
  return agentHasFixedCut(agentName, carrier);
}

function isRenewalClass(classification) {
  return String(classification || '').toLowerCase().includes('renewal');
}

/** Remaining (non-producer) part of the pot: THEI/BSI 50/50 when BSI-eligible, else THEI. */
function houseRemainder(remaining, isBsiEligible) {
  if (!isBsiEligible) return { theiShare: round2(remaining), bsiShare: 0 };
  const theiShare = round2(remaining / 2);
  return { theiShare, bsiShare: round2(remaining - theiShare) };
}

/**
 * House shares around a fixed producer cut. When the cut is more than half the pot
 * (e.g. $82.50 of a $150 UHC pot), BSI keeps its 25% of the pot and THEI absorbs the
 * extra (pending confirmation of who absorbs it). Otherwise the rest is 50/50.
 * Works for positive sales and (negative) chargebacks alike.
 */
function fixedCutHouseShares(pot, producerPayable, isBsiEligible) {
  const remaining = round2(pot - producerPayable);
  if (isBsiEligible && Math.abs(producerPayable) > Math.abs(pot) / 2) {
    const bsiShare = round2(pot * 0.25);
    return { theiShare: round2(remaining - bsiShare), bsiShare };
  }
  return houseRemainder(remaining, isBsiEligible);
}

/**
 * Chargeback of a Chris/Horacio fixed-cut new sale: take back exactly what was paid.
 * With the original sale ({ gross, producer }) the cut comes back in the same proportion
 * as the chargeback vs the original line (partial chargeback → partial cut). Without it,
 * the full fixed cut comes back (never more than the chargeback) and needsReview is set.
 */
function splitFixedCutChargeback(pot, carrier, isBsiEligible, originalSale, effectiveDate) {
  const fixed = integrityFixedProducerCut(carrier, effectiveDate);
  const abs = Math.abs(pot);
  let producerAbs;
  let needsReview = false;
  const og = originalSale ? num(originalSale.gross) : 0;
  const op = originalSale ? num(originalSale.producer) : 0;
  if (og > 0 && op > 0) {
    producerAbs = Math.min(op, round2(op * (abs / og)));
  } else {
    producerAbs = Math.min(fixed, abs);
    needsReview = true;
  }
  const producerPayable = -round2(producerAbs);
  const house = fixedCutHouseShares(pot, producerPayable, isBsiEligible);
  return {
    grossCommission: pot,
    ...house,
    producerPayable,
    subAgentOverride: 0,
    splitApplies: !!isBsiEligible,
    schedule: 'nhp_integrity_fixed_chargeback',
    needsReview,
  };
}

/**
 * Splits are per Medicare override row. A net-negative NHP statement (or the
 * house Charge Backs rollup) does not skip BSI's half or Chris/Horacio's cut
 * on new sales on that same file — or on the next NHP file.
 *
 * @param {{
 *   pot: number,
 *   agentName: string,
 *   carrier: string,
 *   classification?: string,
 *   paymentPeriod?: string,
 *   isBsiEligible: boolean,
 *   alreadyDeducted?: boolean,
 *   originalSale?: { gross: number, producer: number },
 *   effectiveDate?: string,
 * }} opts
 */
function splitNhpMedicareOverride(opts) {
  const pot = num(opts.pot);
  const agentName = opts.agentName || '';
  const period = opts.paymentPeriod || '';
  const isBsiEligible = !!opts.isBsiEligible;

  // Integrity agents are not paid renewals (positive or charged back): producer 0.
  if (isIntegrityAgent(agentName) && isRenewalClass(opts.classification)) {
    return {
      grossCommission: pot,
      ...houseRemainder(pot, isBsiEligible),
      producerPayable: 0,
      subAgentOverride: 0,
      splitApplies: isBsiEligible,
      schedule: 'nhp_integrity_renewal_not_paid',
    };
  }

  // Chargeback of a fixed-cut new sale: take back the fixed cut, not 50% of the line.
  if (pot < 0 && isChrisOrHoracioFixedCarrier(agentName, opts.carrier) &&
      !String(opts.classification || '').toLowerCase().includes('carry')) {
    return splitFixedCutChargeback(pot, opts.carrier, isBsiEligible, opts.originalSale, opts.effectiveDate);
  }

  if (isNhpIntegrityFixedNb(agentName, opts.carrier, opts.classification) && pot > 0) {
    const producerPayable = integrityFixedProducerCut(opts.carrier, opts.effectiveDate);
    const remaining = Math.max(0, pot - producerPayable);
    if (isBsiEligible) {
      const house = producerPayable > pot / 2
        ? fixedCutHouseShares(pot, producerPayable, true)
        : { theiShare: round2(remaining * 0.5), bsiShare: round2(remaining * 0.5) };
      return {
        grossCommission: pot,
        theiShare: house.theiShare,
        bsiShare: house.bsiShare,
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
  isChrisOrHoracioFixedCarrier,
  agentHasFixedCut,
  INTEGRITY_FIXED_CUTS,
  splitNhpMedicareOverride,
};

'use strict';

/**
 * BSI Statements Upload attribution — Alba / Lina ONLY.
 *
 * She is the only agent with intertwined agent commission + agency override on
 * carrier→BSI feeds (Writing Agent often = Broker Society Insurance).
 *
 * Flow:
 *  1. Remap house / Alba-NPN / Alba-named agent-production lines → Alba Hernandez
 *  2. Peel using overrideRateEngine (carrier × state rate table):
 *       producer_payable = albaComp   → Lina agent statement / payroll
 *       thei_share / bsi_share        → Override Statements for THEI & BSI (50/50)
 *  3. Agency Override / Held rows stay under the house label (not Lina pay)
 *  4. Integrity (Munoz / CAM / Mendieta): new sales 50/25/25 (UHC 2026 fixed rate),
 *     renewals not paid (producer 0, THEI/BSI 50/50), chargebacks take back what was paid.
 *  5. Other agents (paid their own commission by the carrier): the BSI line is the agency
 *     override → house, THEI/BSI 50/50 (Swan/Marco: $10 first). Chargebacks reverse the
 *     same shares. Lines left with no split are flagged (anomaly).
 */

const {
  isAlbaHernandez,
  isAlbaAgentCommission,
  isAgencyOverride,
  isIntegrityAgent,
  isMarcoAgent,
  firstYearRenewalIsRenewal,
  normName,
} = require('./payeeSchedules');
const { calculateAlbaOverrideSplit } = require('./overrideRateEngine');
const { getCMSCap2026 } = require('./cmsFmvCaps2026');
const {
  rowNeedsBsiOverrideShareFill,
  splitFullOverridePot,
  splitIntegrityChargeback,
  splitIntegrityRenewal,
  splitIntegrityNewBusiness,
  splitHouseOnly,
} = require('./overrideSplitMath');
const {
  INTEGRITY_BSI_UHC_FIXED,
  integrityBsiUhcFixedCut,
  fixedCutCarrierKey,
} = require('./nhpOverrideSplit');

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

/** Map parser carrier labels → overrideRateEngine keys. */
function normalizeRateCarrier(carrier) {
  const c = String(carrier || '').trim().toLowerCase();
  if (!c) return '';
  // Life Omaha — never map to UHC Medicare rates
  if (c.includes('omaha')) return 'UnitedOfOmaha';
  if ((c.includes('united') || c === 'uhc') && !c.includes('omaha')) return 'UHC';
  if (c.includes('aetna')) return 'Aetna';
  if (c.includes('humana')) return 'Humana';
  if (c.includes('devoted')) return 'Devoted';
  if (c.includes('healthspring') || c.includes('cigna')) return 'HealthSpring';
  if (c.includes('optimum')) return 'Optimum';
  if (c.includes('freedom')) return 'Freedom';
  if (c.includes('elevance') || c.includes('anthem')) return 'Elevance';
  if (c.includes('doctors')) return 'Doctors';
  if (c.includes('healthsun') || c.includes('health sun')) return 'HealthSun';
  if (c.includes('solis')) return 'Solis';
  return String(carrier || '').trim();
}

function extractMemberState(record) {
  const raw = record.raw || {};
  const candidates = [
    record.memberState,
    raw['Member State'],
    raw['State'],
    raw['MemberState'],
    raw['Writing Agent State'],
  ];
  for (const v of candidates) {
    const s = String(v || '')
      .trim()
      .toUpperCase()
      .split(/[-/\s]/)[0];
    if (/^[A-Z]{2}$/.test(s)) return s;
  }
  return null;
}

function extractPlanId(record) {
  const raw = record.raw || {};
  const direct =
    record.planId ||
    raw['Plan ID'] ||
    raw['Plan Id'] ||
    raw['PlanID'] ||
    raw['Product ID'] ||
    '';
  if (direct) return String(direct).trim();

  // UHC-style Contract + PBP → H5322-025
  const contract = String(raw['Contract'] || '').trim();
  const pbp = String(raw['PBP'] || '').trim();
  if (contract && pbp) return `${contract}-${pbp.padStart(3, '0')}`;
  return null;
}

/**
 * Build calculateAlbaOverrideSplit input from a parsed BSI record.
 * Year-type fields come from raw when present; classification is fallback.
 */
function buildAlbaRateInput(record, commissionAbs) {
  const raw = record.raw || {};
  const classification = String(record.classification || '').toLowerCase();

  let commissionAction =
    raw['Commission Action'] != null ? String(raw['Commission Action']).trim() : '';
  if (!commissionAction) {
    if (classification.includes('renewal')) commissionAction = 'Renewal';
    else if (classification.includes('new business') || classification === 'agent commission') {
      commissionAction = 'New';
    }
  }

  return {
    carrier: normalizeRateCarrier(record.carrier),
    memberState: extractMemberState(record),
    commission: commissionAbs,
    planId: extractPlanId(record),
    compType: raw['Comp Type'] != null ? String(raw['Comp Type']).trim() : '',
    firstYearRenewal:
      raw['First Year/Renewal'] != null ? String(raw['First Year/Renewal']).trim() : '',
    salesEvent: raw['Sales Event'] != null ? String(raw['Sales Event']).trim() : '',
    commissionAction,
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}


/** Parse MM/DD/YYYY, YYYY-MM-DD, Date, or Excel serial → {y, m} (month 1-12) or null. */
function parseYearMonth(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1 };
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000)); // Excel serial → UTC date
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { y: parseInt(m[3], 10), m: parseInt(m[1], 10) };
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: parseInt(m[1], 10), m: parseInt(m[2], 10) };
  return null;
}

/**
 * UHC chargebacks give back only the UNEARNED part of the override:
 *   override_chargeback = annual_override × unearned_months / 12
 * earned months = effective month through term month, inclusive
 * (eff 01/2026, term 09/30/2026 → 9 earned, 3 unearned → 25%).
 * Returns null when there is no Term Date or the policy year can't be determined
 * (e.g. earned > 12) — the caller then keeps the full-override behavior.
 */
function chargebackUnearnedFactor(record) {
  const raw = record.raw || {};
  const term = parseYearMonth(raw['Term Date']);
  const eff = parseYearMonth(raw['Original Effective Date'] != null ? raw['Original Effective Date'] : record.effectiveDate);
  if (!term || !eff) return null;
  const earned = (term.y - eff.y) * 12 + (term.m - eff.m) + 1;
  if (earned < 1 || earned > 12) return null;
  return { earnedMonths: earned, unearnedMonths: 12 - earned, factor: (12 - earned) / 12 };
}

/**
 * Aetna pays renewals monthly, but the rate table holds the ANNUAL renewal override.
 * Take off only the line's share of it:
 *   annual renewal amount = CMS renewal FMV for the member's state + annual override
 *   override taken        = annual override × line / annual renewal amount
 * (e.g. a 1/12 monthly line gives back 1/12 of the override). If the annual amount
 * can't be determined (no member state), use 1/12 of the override and flag the line.
 * Never more than the line, so Lina can't go negative on a positive renewal line.
 * Returns null when it doesn't apply (not Aetna, not a positive Renewal).
 */
function aetnaRenewalProration(record, commission, split) {
  if (!(commission > 0)) return null;
  if (split.yearType !== 'Renewal' || split.carrier !== 'Aetna') return null;
  const annualOverride = Number(split.totalOverride) || 0;
  if (!(annualOverride > 0)) return null;
  const state = record.memberState || extractMemberState(record);
  let factor;
  let fellBack = false;
  let annualRenewal = null;
  if (state) {
    annualRenewal = round2(getCMSCap2026(state, 'renewal') + annualOverride);
    factor = Math.min(1, commission / annualRenewal);
  } else {
    factor = 1 / 12;
    fellBack = true;
  }
  const overrideTaken = Math.min(commission, round2(annualOverride * factor));
  return { overrideTaken, annualOverride, annualRenewal, factor, fellBack };
}

/**
 * Peel Alba house production with the carrier×state override rate table.
 * Chargebacks use the absolute rate then re-apply the commission sign.
 */
function peelAlbaProduction(record, commission) {
  const sign = commission < 0 ? -1 : 1;
  const abs = Math.abs(commission);
  const input = buildAlbaRateInput(record, abs);
  const split = calculateAlbaOverrideSplit(input);

  if (split.needsReview) {
    return {
      ok: false,
      reason: split.reason || 'needs review',
      producerPayable: commission,
      theiShare: 0,
      bsiShare: 0,
      totalOverride: 0,
      grossCommission: commission,
    };
  }

  if (split.nonCommissionable) {
    return {
      ok: true,
      nonCommissionable: true,
      producerPayable: commission,
      theiShare: 0,
      bsiShare: 0,
      totalOverride: 0,
      grossCommission: commission,
      certGap: !!split.certGap,
      stateGroup: split.stateGroup,
      yearType: split.yearType,
    };
  }

  let totalOverride = round2(sign * (split.totalOverride || 0));
  let theiShare = round2(sign * (split.theiShare || 0));
  let bsiShare = round2(sign * (split.bsiShare || 0));
  let producerPayable = round2(sign * (split.albaComp || 0));

  // Aetna CMS Trueup = the new-sale override paid after Medicare confirms: the override
  // taken is never more than the line, so Lina can't go negative on it.
  const salesEventUpper = String((record.raw || {})['Sales Event'] || '').trim().toUpperCase();
  if (sign > 0 && salesEventUpper === 'CMS TRUEUP' && split.totalOverride > abs) {
    const thei = round2(abs / 2);
    totalOverride = round2(abs);
    theiShare = thei;
    bsiShare = round2(abs - thei);
    producerPayable = 0;
  }

  // Aetna monthly renewals: take off the line's share of the annual override only.
  const renewalProration = aetnaRenewalProration(record, commission, split);
  if (renewalProration) {
    const o = renewalProration.overrideTaken;
    const thei = round2(o / 2);
    totalOverride = o;
    theiShare = thei;
    bsiShare = round2(o - thei);
    producerPayable = round2(commission - o);
  }

  // Chargebacks: only the unearned share of the (annual) override comes back, so
  // prorate it; Lina keeps the rest of the chargeback. Skipped when the engine did
  // not peel an override (shorted/underpaid rows) or there is no Term Date.
  let chargebackProration = null;
  if (sign < 0 && split.totalOverride > 0) {
    const pr = chargebackUnearnedFactor(record);
    const peelsCleanly = Math.abs((split.albaComp || 0) + split.totalOverride - abs) < 0.01;
    if (pr && peelsCleanly) {
      const scaledAbs = round2(split.totalOverride * pr.factor);
      const theiAbs = round2(scaledAbs / 2);
      totalOverride = -scaledAbs;
      theiShare = -theiAbs;
      bsiShare = round2(-scaledAbs + theiAbs);
      producerPayable = round2(-(abs - scaledAbs));
      chargebackProration = {
        earnedMonths: pr.earnedMonths,
        unearnedMonths: pr.unearnedMonths,
        fullOverride: split.totalOverride,
        proratedOverride: scaledAbs,
      };
    }
  }

  return {
    ok: true,
    producerPayable,
    theiShare,
    bsiShare,
    totalOverride,
    grossCommission: commission,
    certGap: !!split.certGap,
    stateGroup: split.stateGroup,
    yearType: split.yearType,
    carrier: split.carrier || input.carrier,
    chargebackProration,
    renewalProration,
  };
}

function addNote(r, note) {
  r.mga = [r.mga, note].filter(Boolean).join(' | ');
}

function isUhcCarrier(carrier) {
  return fixedCutCarrierKey(carrier) === 'uhc';
}

/**
 * Integrity new sale on a BSI UHC feed, using the plan-year rate table:
 *  - full $150 line with a table entry (2026) → fixed $82.50; BSI keeps 25% of the
 *    line and THEI absorbs the rest (pending confirmation)
 *  - partial / prorated line → 50% of the line, flagged for review (no bump)
 *  - no table entry for the plan year → 50% of the line
 */
function integrityBsiUhcNewSale(r, commission) {
  const fixed = integrityBsiUhcFixedCut(r.agent, r.carrier, r.effectiveDate || (r.raw || {})['Original Effective Date']);
  const base = splitFullOverridePot(commission, { agentName: r.agent });
  if (fixed == null) return { split: base, note: null };
  if (Math.abs(commission - INTEGRITY_BSI_UHC_FIXED.fullPot) < 0.005) {
    const bsiShare = round2(commission * 0.25);
    return {
      split: {
        ...base,
        producerPayable: fixed,
        bsiShare,
        theiShare: round2(commission - fixed - bsiShare),
      },
      note: `Integrity UHC fixed $${fixed.toFixed(2)} (THEI absorbs the amount over 50% — pending confirmation)`,
    };
  }
  return {
    split: base,
    note: 'Integrity UHC partial/prorated line: paid 50% of the line, not the fixed rate — review against UHC',
  };
}

/**
 * Integrity chargeback on a BSI UHC feed: take back exactly what was paid on the policy
 * (same proportion when the chargeback is only part of the original line). BSI gives
 * back 25% of the line, THEI the rest. Original not found:
 *  - plan year with a table entry (2026) → the fixed rate's share of the line
 *    (line / 150 × 82.50, capped at the line), flagged — Joselyn's June 2026 true-ups
 *    brought full 2026 UHC sales to $82.50
 *  - no table entry → 50% of the line, flagged
 */
function integrityBsiUhcChargeback(r, commission, original) {
  const abs = Math.abs(commission);
  const chargebackSplit = (backAbs) => {
    const producerPayable = -round2(backAbs);
    const bsiShare = round2(commission * 0.25);
    return {
      grossCommission: commission,
      producerPayable,
      bsiShare,
      theiShare: round2(commission - producerPayable - bsiShare),
      subAgentOverride: 0,
      splitApplies: false,
    };
  };
  if (original && original.gross > 0 && original.producer > 0) {
    const back = Math.min(original.producer, round2(original.producer * (abs / original.gross)));
    return { split: chargebackSplit(back), note: null };
  }
  const fixed = integrityBsiUhcFixedCut(
    r.agent, r.carrier, r.effectiveDate || (r.raw || {})['Original Effective Date']
  );
  if (fixed != null) {
    const back = Math.min(abs, round2((abs / INTEGRITY_BSI_UHC_FIXED.fullPot) * fixed));
    return {
      split: chargebackSplit(back),
      note: `Integrity chargeback: original sale not found — took back the fixed-rate share ($${back.toFixed(2)} of $${fixed.toFixed(2)}), please verify`,
    };
  }
  return {
    split: splitIntegrityChargeback(commission, r.agent, 'chargeback'),
    note: 'Integrity chargeback: original sale not found — took back 50% of the line, please verify',
  };
}

/** HRA (paid to Lina) and BSI fees are never house-split. */
function isHraOrFee(classification) {
  const c = String(classification || '').toLowerCase();
  return c.includes('hra') || c.includes('bsi fee');
}

const zero = (v) => v == null || Math.abs(Number(v) || 0) < 0.005;

function hasNoSplit(r) {
  return zero(r.producerPayable) && zero(r.theiShare) && zero(r.bsiShare) && zero(r.subAgentOverride);
}

function policyKey(r) {
  return String(r.policyNumber || r.policy_number || '').trim().toLowerCase();
}

/**
 * "Other agent" on a BSI feed: a real writing agent who is not Lina/Alba, not
 * Integrity (Munoz / CAM / Mendieta), not the BSI house label and not THEI itself.
 * The carrier pays these agents their own commission, so the BSI line is the
 * agency override and belongs to the house.
 */
function isOtherBsiAgent(agent) {
  if (isBsiHouseAgent(agent) || isAlbaHernandez(agent) || isIntegrityAgent(agent)) return false;
  return !/health experts/.test(normName(agent));
}

/**
 * Guard: a BSI line with dollars whose split is missing.
 * - Other agents' lines and every chargeback (negative line) need a THEI/BSI share.
 * - Lina / Integrity positive lines need at least one stored share (agent, THEI or BSI).
 * HRA and fee rows are never split, so they're never flagged.
 */
function isUnsplitBsiLine(r) {
  const amount = parseFloat(r.commission != null ? r.commission : r.amount) || 0;
  if (Math.abs(amount) < 0.005) return false;
  const cls = r.classification;
  if (isHraOrFee(cls)) return false;
  const agent = r.agent != null ? r.agent : r.agent_name;
  const row = {
    producerPayable: r.producerPayable != null ? r.producerPayable : r.producer_payable,
    theiShare: r.theiShare != null ? r.theiShare : r.thei_share,
    bsiShare: r.bsiShare != null ? r.bsiShare : r.bsi_share,
    subAgentOverride: r.subAgentOverride != null ? r.subAgentOverride : r.sub_agent_override,
  };
  if (amount < 0 || isOtherBsiAgent(agent)) return zero(row.theiShare) && zero(row.bsiShare);
  return hasNoSplit(row);
}

/**
 * House split for other agents' lines (see isOtherBsiAgent): producer 0, THEI/BSI 50/50.
 * Swan/Marco agents use the existing Marco rule (splitFullOverridePot, the same call the
 * Humana/Devoted Agency Override path uses): $10 off the top on the first line seen per
 * policy, then 50/50. Chargebacks are handled after the main loop (reverseHouseSplit).
 * Only fills lines nothing else has split. Returns 'filled', 'deferred' or null.
 */
function fillHouseSplit(r, commission, deductedPolicies) {
  if (!hasNoSplit(r) || Math.abs(commission) < 0.005) return null;
  if (!isOtherBsiAgent(r.agent) || isHraOrFee(r.classification)) return null;
  if (commission < 0) return 'deferred';
  const policy = r.policyNumber || r.policy_number;
  const already = deductedPolicies.has(policy) || deductedPolicies.has(policyKey(r));
  const split = splitFullOverridePot(commission, {
    agentName: r.agent,
    paymentPeriod: r.period,
    alreadyDeducted: already,
  });
  if (split.subAgentOverride && policy) {
    deductedPolicies.add(policy);
    deductedPolicies.add(policyKey(r));
  }
  applySplit(r, { ...split, producerPayable: 0 });
  r.subAgentOverride = split.subAgentOverride || 0;
  r.splitApplies = true;
  return 'filled';
}

/**
 * Other agent's chargeback / reversal: take back the shares in the same proportions as
 * the sale. THEI and BSI go negative 50/50. For Swan/Marco agents Marco's $10 is reversed
 * too: in proportion to the original sale when it's known (this file or an earlier upload),
 * otherwise $10 (flagged). Never reverses more of Marco's $10 than was taken on the policy.
 */
function reverseHouseSplit(r, commission, marcoOriginals) {
  const abs = Math.abs(commission);
  let marcoBack = 0;
  if (isMarcoAgent(r.agent, r.period)) {
    const pk = policyKey(r);
    const orig = pk ? marcoOriginals.get(pk) : null;
    if (orig && orig.sub > 0) {
      const remaining = Math.max(0, round2(orig.sub - (orig.reversed || 0)));
      const ratio = orig.gross > 0 ? Math.min(1, abs / orig.gross) : 1;
      marcoBack = Math.min(remaining, round2(orig.sub * ratio), abs);
      orig.reversed = round2((orig.reversed || 0) + marcoBack);
    } else if (orig && orig.sub <= 0) {
      marcoBack = 0;
    } else if (abs >= 10) {
      marcoBack = 10;
      if (pk) marcoOriginals.set(pk, { gross: abs, sub: 10, reversed: 10 });
      addNote(r, "Marco chargeback: original sale not found — reversed Marco's $10, please verify");
    }
  }
  const rest = round2(abs - marcoBack);
  const thei = round2(rest / 2);
  applySplit(r, {
    grossCommission: commission,
    producerPayable: 0,
    theiShare: -thei,
    bsiShare: -round2(rest - thei),
  });
  r.subAgentOverride = marcoBack ? -marcoBack : 0;
  r.splitApplies = true;
}

function applySplit(r, split) {
  r.grossCommission = split.grossCommission;
  r.producerPayable = split.producerPayable;
  r.theiShare = split.theiShare;
  r.bsiShare = split.bsiShare;
  r.subAgentOverride = 0;
  r.splitApplies = !!split.splitApplies;
}

/**
 * Apply Alba attribution + rate peel to parsed BSI statement records (in place).
 * opts.integrityOriginalSales: Map policy (lower-case) → { gross, producer } of Integrity
 * UHC new sales already stored, so chargebacks take back exactly what was paid.
 */
function applyBsiBookAgentProduction(records, opts = {}) {
  if (!Array.isArray(records)) return records;
  const integrityOriginalSales = new Map(
    opts.integrityOriginalSales instanceof Map ? opts.integrityOriginalSales : []
  );
  const deferredIntegrityChargebacks = [];
  let houseFilled = 0;

  let remapped = 0;
  let peeled = 0;
  let review = 0;
  const deductedPolicies = new Set();
  for (const r of records) {
    if (Number(r.subAgentOverride || r.sub_agent_override || 0)) {
      deductedPolicies.add(r.policyNumber || r.policy_number);
    }
  }
  // Other-agent house split (UHC / Aetna / chargebacks on every BSI feed).
  // houseDeducted: policies that already gave Marco his $10 (earlier uploads via opts,
  // or earlier in this file). The Humana/Devoted Agency Override path above keeps its
  // own file-only set, unchanged.
  const houseDeducted = new Set([
    ...deductedPolicies,
    ...(opts.deductedPolicies ? [...opts.deductedPolicies] : []),
  ]);
  // marcoOriginals: policy (lower-case) → { gross, sub, reversed } of Marco's $10 already
  // stored, so a chargeback reverses his share in proportion.
  const marcoOriginals = new Map();
  if (opts.marcoOriginals instanceof Map) {
    for (const [k, v] of opts.marcoOriginals) marcoOriginals.set(k, { ...v });
  }
  const deferredHouseChargebacks = [];
  const tryHouseSplit = (r, commission) => {
    const res = fillHouseSplit(r, commission, houseDeducted);
    if (res === 'filled') houseFilled += 1;
    if (res === 'deferred') deferredHouseChargebacks.push(r);
  };

  for (const r of records) {
    const classification = r.classification || '';
    const commission = parseFloat(r.commission) || 0;

    if (isAgencyOverride(classification) || isHeldClassification(classification)) {
      if (r.producerPayable == null) r.producerPayable = 0;
      if (r.splitApplies == null) r.splitApplies = false;
      if (!r.source) r.source = 'BSI';
      // Carrier→BSI Humana/Devoted parsers store the full pot on `commission`
      // and never write theiShare — House Statements then shows $0.00.
      if (rowNeedsBsiOverrideShareFill(r)) {
        // Integrity agents are not paid renewals: Humana/Devoted rows whose
        // 'First Year/Renewal' says renewal → producer 0, THEI/BSI 50/50.
        // Missing/blank column → keep the normal split.
        const integrityRenewal =
          isIntegrityAgent(r.agent) && firstYearRenewalIsRenewal(r.raw) === true;
        const split = integrityRenewal
          ? splitHouseOnly(commission)
          : splitFullOverridePot(commission, {
            agentName: r.agent,
            paymentPeriod: r.period,
            alreadyDeducted: deductedPolicies.has(r.policyNumber || r.policy_number),
          });
        r.theiShare = split.theiShare;
        r.bsiShare = split.bsiShare;
        r.grossCommission = split.grossCommission;
        r.producerPayable = split.producerPayable;
        r.subAgentOverride = split.subAgentOverride;
        r.splitApplies = split.splitApplies;
        if (split.subAgentOverride) deductedPolicies.add(r.policyNumber || r.policy_number);
      }
      continue;
    }

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

    if (!(house || isAlbaNpn || albaNamed)) {
      if (!r.source) r.source = 'BSI';
      // Integrity (Munoz / CAM / Mendieta) chargebacks: 50% producer, 25% THEI, 25% BSI —
      // the same split as the override they reverse. Only fills rows a parser left unsplit.
      // Integrity renewals are not paid to the producer: producer 0, THEI/BSI 50/50.
      // Integrity new sales (UHC / Aetna feeds): 50/25/25.
      // A chargeback the feed marks as a renewal ('First Year/Renewal') was never paid,
      // so nothing comes back from the producer either.
      const chargebackOfRenewal =
        String(classification).toLowerCase().trim() === 'chargeback' &&
        isIntegrityAgent(r.agent) &&
        firstYearRenewalIsRenewal(r.raw) === true;
      const integritySplit = chargebackOfRenewal
        ? splitHouseOnly(commission)
        : splitIntegrityChargeback(commission, r.agent, classification) ||
          splitIntegrityRenewal(commission, r.agent, classification) ||
          splitIntegrityNewBusiness(commission, r.agent, classification);
      const unsplit = r.producerPayable == null && r.theiShare == null && r.bsiShare == null;
      if (integritySplit && unsplit && isUhcCarrier(r.carrier)) {
        const cls = String(classification).toLowerCase().trim();
        if (cls === 'new business') {
          const { split, note } = integrityBsiUhcNewSale(r, commission);
          applySplit(r, split);
          if (note) addNote(r, note);
          const pk = String(r.policyNumber || r.policy_number || '').trim().toLowerCase();
          if (pk && split.producerPayable > 0 && commission > 0) {
            integrityOriginalSales.set(pk, { gross: commission, producer: split.producerPayable });
          }
          continue;
        }
        if (cls === 'chargeback' && !chargebackOfRenewal) {
          // After the loop, so a sale later in the same file is found too.
          deferredIntegrityChargebacks.push(r);
          continue;
        }
      }
      if (integritySplit && unsplit) applySplit(r, integritySplit);
      // Other agents (not Lina, not Integrity): override goes to the house, 50/50
      // (Marco $10 first for Swan agents).
      tryHouseSplit(r, commission);
      continue;
    }

    if (normName(r.agent) !== normName(ALBA_DB_AGENT)) remapped += 1;
    r.agent = ALBA_DB_AGENT;

    if (!r.memberState) {
      const st = extractMemberState(r);
      if (st) r.memberState = st;
    }

    const peel = peelAlbaProduction(r, commission);
    r.producerPayable = peel.producerPayable;
    r.theiShare = peel.theiShare;
    r.bsiShare = peel.bsiShare;
    r.grossCommission = peel.grossCommission;
    r.splitApplies = false;
    r.payee = r.payee || 'BSI';
    r.source = r.source || 'BSI';

    if (peel.renewalProration) {
      const rp = peel.renewalProration;
      addNote(r, rp.fellBack
        ? `Renewal override prorated 1/12 — annual renewal amount unknown, please review ($${rp.annualOverride} → $${rp.overrideTaken.toFixed(2)})`
        : `Renewal override prorated to this line ($${rp.annualOverride} annual → $${rp.overrideTaken.toFixed(2)})`);
    }

    if (peel.chargebackProration) {
      const cp = peel.chargebackProration;
      r.mga = [r.mga, `Chargeback override prorated ${cp.unearnedMonths}/12 ($${cp.fullOverride} → $${cp.proratedOverride})`]
        .filter(Boolean)
        .join(' | ');
    }

    if (!peel.ok) {
      review += 1;
      r.anomaly = true;
      r.mga = [r.mga, `Alba rate review: ${peel.reason}`].filter(Boolean).join(' | ');
    } else {
      peeled += 1;
      if (peel.certGap) {
        r.mga = [r.mga, 'Alba override cert gap — entitled but not paid']
          .filter(Boolean)
          .join(' | ');
      }
    }
  }

  for (const r of deferredIntegrityChargebacks) {
    const commission = parseFloat(r.commission) || 0;
    const pk = String(r.policyNumber || r.policy_number || '').trim().toLowerCase();
    const { split, note } = integrityBsiUhcChargeback(r, commission, pk ? integrityOriginalSales.get(pk) : null);
    applySplit(r, split);
    if (note) addNote(r, note);
  }

  // Other agents' chargebacks, after the loop so a sale later in this file is found too.
  for (const r of records) {
    const sub = Number(r.subAgentOverride) || 0;
    const pk = policyKey(r);
    if (sub > 0 && pk && (Number(r.commission) || 0) > 0 && !marcoOriginals.has(pk)) {
      marcoOriginals.set(pk, { gross: Number(r.commission) || 0, sub, reversed: 0 });
    }
  }
  for (const r of deferredHouseChargebacks) {
    reverseHouseSplit(r, parseFloat(r.commission) || 0, marcoOriginals);
    houseFilled += 1;
  }

  // Guard: any line with dollars that still has no split is flagged for review.
  let unsplit = 0;
  for (const r of records) {
    if (!isUnsplitBsiLine(r)) continue;
    unsplit += 1;
    r.anomaly = true;
    addNote(r, 'No THEI/BSI split stored for this line — review');
  }

  console.log(
    `[BSI-ATTR] Alba peeled=${peeled}, needsReview=${review}, BSI-house→Alba remapped=${remapped}, ` +
    `house 50/50 filled=${houseFilled}, unsplit flagged=${unsplit}`
  );
  return records;
}

module.exports = {
  ALBA_DB_AGENT,
  ALBA_NPN,
  isBsiHouseAgent,
  applyBsiBookAgentProduction,
  isUnsplitBsiLine,
  isOtherBsiAgent,
  extractWritingNpn,
  normalizeRateCarrier,
  extractMemberState,
  extractPlanId,
  buildAlbaRateInput,
  peelAlbaProduction,
  chargebackUnearnedFactor,
};

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
 *  4. Other agents on the feed are left untouched, except Integrity chargebacks
 *     (50/25/25 split of the override they reverse), Integrity new sales
 *     (50/25/25) and Integrity renewals (not paid: producer 0, THEI/BSI 50/50)
 */

const {
  isAlbaHernandez,
  isAlbaAgentCommission,
  isAgencyOverride,
  isIntegrityAgent,
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

  let remapped = 0;
  let peeled = 0;
  let review = 0;
  const deductedPolicies = new Set();
  for (const r of records) {
    if (Number(r.subAgentOverride || r.sub_agent_override || 0)) {
      deductedPolicies.add(r.policyNumber || r.policy_number);
    }
  }

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
      // Aetna CMS Trueup lines stay unsplit until Yahoska decides who they belong to.
      if (String(classification).toLowerCase().trim() === 'cms trueup') {
        addNote(r, 'CMS Trueup: not split yet (pending decision on who it belongs to)');
      }
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

  console.log(
    `[BSI-ATTR] Alba peeled=${peeled}, needsReview=${review}, BSI-house→Alba remapped=${remapped}`
  );
  return records;
}

module.exports = {
  ALBA_DB_AGENT,
  ALBA_NPN,
  isBsiHouseAgent,
  applyBsiBookAgentProduction,
  extractWritingNpn,
  normalizeRateCarrier,
  extractMemberState,
  extractPlanId,
  buildAlbaRateInput,
  peelAlbaProduction,
  chargebackUnearnedFactor,
};

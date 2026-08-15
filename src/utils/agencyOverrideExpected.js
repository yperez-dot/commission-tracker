'use strict';

/**
 * Expected BSI→THEI agency override for Agency Override Recon.
 * Uses the carrier×state override rate table; THEI share = 50% of pot.
 */

const {
  calculateAlbaOverrideSplit,
  resolveYearType,
} = require('../overrideRateEngine');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function parseRaw(prod) {
  const raw = prod?.raw_data;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Map production carrier labels → overrideRateEngine keys. */
function normalizeRateCarrier(carrier) {
  const c = String(carrier || '').trim().toLowerCase();
  if (!c) return '';
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

function extractPlanId(prod, raw) {
  const candidates = [
    prod?.plan_id,
    raw['Plan ID'],
    raw['Plan_ID'],
    raw['PlanId'],
    raw['Contract Plan ID'],
    raw['Affinitypolicyid'],
    prod?.plan_name,
    prod?.policy_type,
  ];
  for (const v of candidates) {
    const s = String(v || '').toUpperCase();
    const m = s.match(/H\d{4}-\d{3}/);
    if (m) return m[0];
  }
  return null;
}

function extractMemberState(prod, raw) {
  const candidates = [
    prod?.state,
    raw['Member State'],
    raw['STATE'],
    raw['State'],
    raw['App_State'],
    raw['Beneficiary_State'],
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

function yearTypeFromProduction(prod, raw) {
  const fromEngine = resolveYearType({
    compType: raw['Comp Type'] || raw.Comp_Type,
    firstYearRenewal: raw['First Year/Renewal'] || raw['First Year / Renewal'],
    salesEvent: raw['Sales Event'] || raw.Sales_Event || raw['Enrollment_Type'],
    commissionAction: raw['Commission Action'] || raw.Commission_Action,
  });
  if (fromEngine) return fromEngine;

  const blob = `${prod?.enrollment_type || ''} ${prod?.status || ''} ${prod?.policy_type || ''}`.toLowerCase();
  if (blob.includes('renew')) return 'Renewal';
  // Active / Future production enrollments default to Initial for expected display
  return 'Initial';
}

/**
 * @returns {{
 *   amount: number|null,
 *   pot: number|null,
 *   yearType: string|null,
 *   stateGroup: string|null,
 *   carrierKey: string,
 *   memberState: string|null,
 *   note: string,
 *   kind: 'rate'|'noncomm'|'unknown',
 * }}
 */
function expectedAgencyOverride(production) {
  const raw = parseRaw(production);
  const carrierKey = normalizeRateCarrier(production?.carrier);
  const memberState = extractMemberState(production, raw);
  const planId = extractPlanId(production, raw);
  const yearType = yearTypeFromProduction(production, raw);

  if (!carrierKey) {
    return {
      amount: null,
      pot: null,
      yearType,
      stateGroup: null,
      carrierKey: '',
      memberState,
      note: 'Need carrier',
      kind: 'unknown',
    };
  }

  const split = calculateAlbaOverrideSplit({
    carrier: carrierKey,
    memberState: memberState || 'XX', // National fallback when state missing
    commission: 0,
    planId,
    commissionAction: yearType === 'Renewal' ? 'Renewal' : 'New',
    salesEvent: yearType === 'Initial' ? 'New Business' : 'Renewal',
  });

  if (split.nonCommissionable) {
    return {
      amount: 0,
      pot: 0,
      yearType: split.yearType || yearType,
      stateGroup: split.stateGroup || null,
      carrierKey,
      memberState,
      note: 'Non-commissionable',
      kind: 'noncomm',
    };
  }

  if (split.needsReview || split.theiShare == null) {
    return {
      amount: null,
      pot: null,
      yearType,
      stateGroup: null,
      carrierKey,
      memberState,
      note: split.reason || 'Rate not resolved',
      kind: 'unknown',
    };
  }

  return {
    amount: round2(split.theiShare),
    pot: round2(split.totalOverride),
    yearType: split.yearType || yearType,
    stateGroup: split.stateGroup || null,
    carrierKey,
    memberState: split.memberState || memberState,
    note: null,
    kind: 'rate',
  };
}

function expectedOverrideLabel(meta) {
  if (!meta) return '';
  if (meta.kind === 'noncomm') return 'Non-commissionable';
  if (meta.kind === 'unknown') return meta.note || 'Need rate inputs';
  const yt = meta.yearType || 'Initial';
  const group = meta.stateGroup || meta.memberState || 'National';
  return `${meta.carrierKey} ${yt} · ${group} · THEI 50%`;
}

module.exports = {
  expectedAgencyOverride,
  expectedOverrideLabel,
  normalizeRateCarrier,
  extractPlanId,
  extractMemberState,
  yearTypeFromProduction,
};

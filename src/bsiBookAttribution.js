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
 *  4. Other agents on the feed are left untouched
 */

const {
  isAlbaHernandez,
  isAlbaAgentCommission,
  isAgencyOverride,
  normName,
} = require('./payeeSchedules');
const { calculateAlbaOverrideSplit } = require('./overrideRateEngine');

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
  if (c.includes('united') || c === 'uhc') return 'UHC';
  if (c.includes('aetna')) return 'Aetna';
  if (c.includes('humana')) return 'Humana';
  if (c.includes('devoted')) return 'Devoted';
  if (c.includes('healthspring') || c.includes('cigna')) return 'HealthSpring';
  if (c.includes('optimum')) return 'Optimum';
  if (c.includes('freedom')) return 'Freedom';
  if (c.includes('elevance') || c.includes('anthem')) return 'Elevance';
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

  const totalOverride = round2(sign * (split.totalOverride || 0));
  const theiShare = round2(sign * (split.theiShare || 0));
  const bsiShare = round2(sign * (split.bsiShare || 0));
  const producerPayable = round2(sign * (split.albaComp || 0));

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
  };
}

/**
 * Apply Alba attribution + rate peel to parsed BSI statement records (in place).
 */
function applyBsiBookAgentProduction(records) {
  if (!Array.isArray(records)) return records;

  let remapped = 0;
  let peeled = 0;
  let review = 0;

  for (const r of records) {
    const classification = r.classification || '';
    const commission = parseFloat(r.commission) || 0;

    if (isAgencyOverride(classification) || isHeldClassification(classification)) {
      if (r.producerPayable == null) r.producerPayable = 0;
      if (r.splitApplies == null) r.splitApplies = false;
      if (!r.source) r.source = 'BSI';
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
};

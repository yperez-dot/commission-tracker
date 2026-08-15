'use strict';

/**
 * Medicare Supplement agent commission — Year 1 rates.
 *
 * Carriers:
 * - UHC / AARP: fixed Year-1 schedule by state/area/plan (Drive packet).
 * - HealthSpring / CNHIC / HNHIC / Cigna Med Supp: as-earned rate derived from
 *   AgentView Commission Report (THEI, period 08/01–08/14/2026, agent CB142243):
 *     Silvia Mushkin 60Y0436424 Plan G FL — Comm Paid $55.59 (modal book $118)
 *     Julius Mushkin 60Y0436880 Plan G FL — Comm Paid $55.86
 *   Year-1 expected = monthly_premium × (55.59 / 118) × 12.
 *   Default monthly premium when unknown = $118 (statement Mode Rate).
 *
 * Sales Recon expected = Year 1 (not MA $347 calendar proration).
 */

/** @type {Record<string, Record<string, number>>} */
const YEAR1_BY_STATE_PLAN = {
  'FL-1': {
    B: 582, C: 582, F: 582, G: 582, 'SELECT G': 582,
    N: 397.5, 'SELECT N': 397.5,
    A: 198.75, K: 198.75, L: 198.75,
    'HIGH-DEDUCTIBLE G': 141.5, HDG: 141.5,
  },
  'FL-2': {
    B: 468.25, C: 468.25, F: 468.25, G: 468.25, 'SELECT G': 468.25,
    N: 320.5, 'SELECT N': 320.5,
    A: 160.25, K: 160.25, L: 160.25,
    'HIGH-DEDUCTIBLE G': 114.25, HDG: 114.25,
  },
  'FL-3': {
    B: 431, C: 431, F: 431, G: 431, 'SELECT G': 431,
    N: 295, 'SELECT N': 295,
    A: 147.5, K: 147.5, L: 147.5,
    'HIGH-DEDUCTIBLE G': 105, HDG: 105,
  },
  'FL-4': {
    B: 443.25, C: 443.25, F: 443.25, G: 443.25, 'SELECT G': 443.25,
    N: 303.25, 'SELECT N': 303.25,
    A: 151.75, K: 151.75, L: 151.75,
    'HIGH-DEDUCTIBLE G': 108, HDG: 108,
  },
  AL: { B: 242, C: 242, F: 242, G: 242, 'SELECT G': 242, N: 210, 'SELECT N': 210, A: 105, K: 105, L: 105 },
  LA: { B: 242, C: 242, F: 242, G: 242, 'SELECT G': 242, N: 210, 'SELECT N': 210, A: 105, K: 105, L: 105 },
  NH: { B: 242, C: 242, F: 242, G: 242, 'SELECT G': 242, N: 210, 'SELECT N': 210, A: 105, K: 105, L: 105 },
  GA: { B: 350, C: 350, F: 350, G: 350, 'SELECT G': 350, N: 250, 'SELECT N': 250, A: 125, K: 125, L: 125 },
  NC: { B: 275, C: 275, D: 275, F: 275, G: 275, 'SELECT G': 275, N: 225, 'SELECT N': 225, A: 112.5, K: 112.5, L: 112.5 },
  SC: { B: 275, C: 275, F: 275, G: 275, 'SELECT G': 275, N: 225, 'SELECT N': 225, A: 112.5, K: 112.5, L: 112.5 },
  MD: { B: 360, C: 360, F: 360, G: 360, N: 300, A: 150, K: 150, L: 150 },
  // TX Area 1 default when area unknown
  TX: {
    B: 300, C: 300, F: 300, G: 300, 'SELECT G': 300,
    N: 275, 'SELECT N': 275, A: 137.5, K: 137.5, L: 137.5,
  },
};

/** AgentView book modal used for Silvia Mushkin Plan G (Aug 2026 statement). */
const HS_AGENTVIEW_MODAL_PREMIUM = 118;
/** Silvia Mushkin Comm Paid 08/14/2026 — primary calibration point. */
const HS_AGENTVIEW_MONTHLY_PAID = 55.59;
/** As-earned monthly commission ÷ modal premium. */
const HS_EARN_RATE = HS_AGENTVIEW_MONTHLY_PAID / HS_AGENTVIEW_MODAL_PREMIUM;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normPlan(planName) {
  const s = String(planName || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/HIGH[\s-]*DED.*\bG\b|\bHDG\b|\bHD\s*G\b/.test(s)) return 'HIGH-DEDUCTIBLE G';
  if (/SELECT\s*G/.test(s)) return 'SELECT G';
  if (/SELECT\s*N/.test(s)) return 'SELECT N';
  const letter = s.match(/\bPLAN\s*([A-N])\b/) || s.match(/\b([BCFGNAKLD])\b/);
  if (letter) return letter[1];
  return null;
}

function normState(state) {
  const s = String(state || '').trim().toUpperCase();
  if (!s) return null;
  if (s.length === 2) return s;
  const map = {
    FLORIDA: 'FL', TEXAS: 'TX', GEORGIA: 'GA', 'NORTH CAROLINA': 'NC',
    'SOUTH CAROLINA': 'SC', MARYLAND: 'MD', ALABAMA: 'AL', LOUISIANA: 'LA',
    'NEW HAMPSHIRE': 'NH',
  };
  return map[s] || null;
}

function resolveTableKey(state, area, { defaultFl = true } = {}) {
  const st = normState(state);
  if (!st) {
    // THEI book is FL-primary; allow FL-1 default when state missing
    return defaultFl ? 'FL-1' : null;
  }
  if (st === 'FL') {
    const a = parseInt(area, 10);
    if (a >= 1 && a <= 4) return `FL-${a}`;
    return 'FL-1';
  }
  return st;
}

/**
 * Route Med Supp sale to carrier schedule family.
 * HealthSpring / CNHIC / HNHIC / Cigna Med Supp → AgentView-derived %.
 * Everything else (incl. unknown) → UHC AARP fixed table.
 */
function detectMedSuppCarrierFamily(sale = {}) {
  const blob = [
    sale.carrier,
    sale.company,
    sale.plan_name,
    sale.plan,
    sale.marketing_name,
    sale.product,
  ].filter(Boolean).join(' ').toUpperCase();

  if (/HEALTH\s*SPRING|\bCNHIC\b|\bHNHIC\b|\bCIGNA\b/.test(blob)) {
    return 'healthspring';
  }
  return 'uhc_aarp';
}

function resolveMonthlyPremium(sale = {}) {
  const raw = sale.monthly_premium ?? sale.premium ?? sale.modal_premium ?? sale.mode_rate;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return HS_AGENTVIEW_MODAL_PREMIUM;
}

/**
 * HealthSpring / CNHIC Year-1 from AgentView as-earned calibration.
 */
function lookupHealthSpringYear1(sale = {}) {
  const plan = normPlan(sale.plan_name || sale.plan || sale.policy_type || sale.product);
  const premium = resolveMonthlyPremium(sale);
  const usedDefaultPremium = !(
    Number(sale.monthly_premium) > 0
    || Number(sale.premium) > 0
    || Number(sale.modal_premium) > 0
    || Number(sale.mode_rate) > 0
  );
  const monthlyCommission = round2(premium * HS_EARN_RATE);
  const amount = round2(monthlyCommission * 12);

  const notes = [
    `HS AgentView ${(HS_EARN_RATE * 100).toFixed(2)}% of modal`,
    `$${premium}/mo${usedDefaultPremium ? ' book default' : ''}`,
  ];
  if (plan) notes.push(`Plan ${plan}`);

  return {
    amount,
    monthlyCommission,
    monthlyPremium: premium,
    plan,
    tableKey: 'HS-AGENTVIEW',
    note: notes.join(' · '),
    source: 'healthspring_agentview_derived',
    usedDefaultFlArea: false,
    usedDefaultFlState: false,
    usedDefaultPremium,
  };
}

/**
 * Year-1 expected agent commission for a Med Supp sale (UHC AARP or HealthSpring).
 */
function lookupUhcAarpYear1(sale = {}) {
  const plan = normPlan(sale.plan_name || sale.plan || sale.policy_type || sale.product);
  const explicitState = sale.state || sale.member_state || sale.applicant_state;
  const tableKey = resolveTableKey(
    explicitState,
    sale.med_supp_area || sale.area || sale.rate_area,
    { defaultFl: true }
  );
  const usedDefaultFlArea = String(tableKey || '').startsWith('FL-')
    && !sale.med_supp_area && !sale.area && !sale.rate_area;
  const usedDefaultFlState = !normState(explicitState) && tableKey === 'FL-1';

  if (!tableKey) {
    return {
      amount: null,
      plan,
      tableKey: null,
      note: 'Med Supp: need state (and FL area 1–4) for schedule lookup',
      source: 'uhc_aarp_med_supp',
      usedDefaultFlArea: false,
      usedDefaultFlState: false,
    };
  }

  const table = YEAR1_BY_STATE_PLAN[tableKey];
  if (!table) {
    return {
      amount: null,
      plan,
      tableKey,
      note: `Med Supp: no Year-1 table for ${tableKey} yet`,
      source: 'uhc_aarp_med_supp',
      usedDefaultFlArea,
      usedDefaultFlState,
    };
  }

  if (!plan || table[plan] == null) {
    return {
      amount: null,
      plan,
      tableKey,
      note: plan
        ? `Med Supp: plan ${plan} not in ${tableKey} table`
        : 'Med Supp: need plan letter (G/N/F/…) in plan name',
      source: 'uhc_aarp_med_supp',
      usedDefaultFlArea,
      usedDefaultFlState,
    };
  }

  const notes = [];
  if (usedDefaultFlState) notes.push('assumed FL');
  if (usedDefaultFlArea) notes.push('Area 1 default');

  return {
    amount: table[plan],
    plan,
    tableKey,
    note: notes.length ? `UHC AARP Year 1 · ${tableKey} · Plan ${plan} (${notes.join(', ')})` : `UHC AARP Year 1 · ${tableKey} · Plan ${plan}`,
    source: 'uhc_aarp_med_supp',
    usedDefaultFlArea,
    usedDefaultFlState,
  };
}

/**
 * Year-1 expected agent commission for a Med Supp sale.
 */
function lookupMedSuppYear1(sale = {}) {
  const family = detectMedSuppCarrierFamily(sale);
  if (family === 'healthspring') {
    return lookupHealthSpringYear1(sale);
  }
  return lookupUhcAarpYear1(sale);
}

module.exports = {
  YEAR1_BY_STATE_PLAN,
  HS_AGENTVIEW_MODAL_PREMIUM,
  HS_AGENTVIEW_MONTHLY_PAID,
  HS_EARN_RATE,
  normPlan,
  normState,
  resolveTableKey,
  detectMedSuppCarrierFamily,
  lookupMedSuppYear1,
};

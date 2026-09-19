'use strict';

/**
 * Aetna producer compensation — 2027 Schedule One, Agent 4.
 *
 * Source PDF: Highspot “2027 Schedule One_Agent 4”
 *   https://view.highspot.com/viewer/8cbb5eafa4bf209130b315642486740c?iid=6a95dc3fb0c2d20afeb35c08
 *   Imported by Aetna 2026-08-31. Document id: 2027 Compensation Schedule_Agent 4.
 *
 * This is the writing-agent (AG4) packet, not the FMO/agency override schedule.
 * BSI→THEI override pots in overrideRateEngine.js stay on the 2026 contract
 * until an agency-level 2027 schedule arrives.
 *
 * MA lump sum is annualized (prorate by effective month when applicable).
 * Renewal PMPM = full renewal ÷ 12 per month.
 * LOA / LOAAM = $0.00 on every table.
 * New 2027 PDPs are non-commissionable. Older Choice PDP persistency still pays.
 */

const AETNA_2027_SOURCE =
  'https://view.highspot.com/viewer/8cbb5eafa4bf209130b315642486740c?iid=6a95dc3fb0c2d20afeb35c08';

const CONTRACT_LEVELS = ['AG4', 'AG3', 'AG2', 'AG1', 'LOA', 'LOAAM'];

const ZERO_RATE = { cmsNew: 0, base: 0, renewal: 0 };

/** @typedef {{ cmsNew: number, base: number, renewal: number }} AetnaMaRate */

/** @type {Record<string, Record<string, AetnaMaRate>>} */
const AETNA_2027_MA = {
  National: {
    AG4: { cmsNew: 725, base: 363, renewal: 363 },
    AG3: { cmsNew: 660, base: 330, renewal: 330 },
    AG2: { cmsNew: 602, base: 301, renewal: 301 },
    AG1: { cmsNew: 529, base: 265, renewal: 265 },
    LOA: { ...ZERO_RATE },
    LOAAM: { ...ZERO_RATE },
  },
  CT_PA_DC: {
    AG4: { cmsNew: 816, base: 408, renewal: 408 },
    AG3: { cmsNew: 743, base: 371, renewal: 371 },
    AG2: { cmsNew: 677, base: 339, renewal: 339 },
    AG1: { cmsNew: 596, base: 298, renewal: 298 },
    LOA: { ...ZERO_RATE },
    LOAAM: { ...ZERO_RATE },
  },
  CA_NJ: {
    AG4: { cmsNew: 902, base: 451, renewal: 451 },
    AG3: { cmsNew: 821, base: 410, renewal: 410 },
    AG2: { cmsNew: 749, base: 374, renewal: 374 },
    AG1: { cmsNew: 658, base: 329, renewal: 329 },
    LOA: { ...ZERO_RATE },
    LOAAM: { ...ZERO_RATE },
  },
};

/**
 * Choice PDP persistency (annualized renewal). 2027 new business is $0.
 * Columns match the PDF: 2027 lump/PMPM, 2025–26, 2024, 2023, 2020–22.
 */
const AETNA_2027_PDP = {
  AG4: { cmsNew: 0, base: 0, renewal2027: 0, renewal2025_2026: 0, renewal2024: 52, renewal2023: 48, renewal2020_2022: 46 },
  AG3: { cmsNew: 0, base: 0, renewal2027: 0, renewal2025_2026: 0, renewal2024: 46, renewal2023: 43, renewal2020_2022: 41 },
  AG2: { cmsNew: 0, base: 0, renewal2027: 0, renewal2025_2026: 0, renewal2024: 40, renewal2023: 37, renewal2020_2022: 35 },
  AG1: { cmsNew: 0, base: 0, renewal2027: 0, renewal2025_2026: 0, renewal2024: 35, renewal2023: 33, renewal2020_2022: 31 },
  LOA: { cmsNew: 0, base: 0, renewal2027: 0, renewal2025_2026: 0, renewal2024: 0, renewal2023: 0, renewal2020_2022: 0 },
  LOAAM: { cmsNew: 0, base: 0, renewal2027: 0, renewal2025_2026: 0, renewal2024: 0, renewal2023: 0, renewal2020_2022: 0 },
};

const STATE_GROUP = {
  CT: 'CT_PA_DC',
  PA: 'CT_PA_DC',
  DC: 'CT_PA_DC',
  CA: 'CA_NJ',
  NJ: 'CA_NJ',
};

function normState(state) {
  return String(state || '')
    .trim()
    .toUpperCase()
    .split(/[-/\s]/)[0];
}

function resolveMaStateGroup(state) {
  const st = normState(state);
  return STATE_GROUP[st] || 'National';
}

function normContractLevel(level) {
  const s = String(level || 'AG4')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (s === 'LOAAM' || s === 'LOA-AM') return 'LOAAM';
  if (s === 'LOA') return 'LOA';
  if (/^AG[1-4]$/.test(s)) return s;
  return 'AG4';
}

function parsePlanYear(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    if (n >= 2000 && n <= 2100) return n;
    if (n >= 200001 && n <= 210012) return Math.floor(n / 100);
    return null;
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})(?:[-/](\d{2}))?/);
  if (iso) return parseInt(iso[1], 10);
  const mdY = s.match(/\b(\d{4})\b/);
  if (mdY) return parseInt(mdY[1], 10);
  return null;
}

/**
 * Writing-agent MA rate for a plan year / state / hierarchy level.
 * 2026 and earlier are not in this packet — caller keeps the $347 MA default.
 *
 * @returns {{
 *   found: boolean,
 *   planYear: number|null,
 *   stateGroup: string,
 *   contractLevel: string,
 *   cmsNew: number|null,
 *   base: number|null,
 *   renewal: number|null,
 *   note: string|null,
 * }}
 */
function lookupAetnaMaRate({ planYear, effectiveDate, state, contractLevel } = {}) {
  const year = parsePlanYear(planYear) || parsePlanYear(effectiveDate);
  const stateGroup = resolveMaStateGroup(state);
  const level = normContractLevel(contractLevel);

  if (year !== 2027) {
    return {
      found: false,
      planYear: year,
      stateGroup,
      contractLevel: level,
      cmsNew: null,
      base: null,
      renewal: null,
      note: year
        ? `Aetna Agent 4 packet is 2027-only (got plan year ${year})`
        : 'Need plan year / effective date for Aetna 2027 schedule',
    };
  }

  const table = AETNA_2027_MA[stateGroup] || AETNA_2027_MA.National;
  const rate = table[level] || table.AG4;
  return {
    found: true,
    planYear: 2027,
    stateGroup,
    contractLevel: level,
    cmsNew: rate.cmsNew,
    base: rate.base,
    renewal: rate.renewal,
    note: null,
  };
}

function pdpRenewalForEffectiveYear(row, effectiveYear) {
  if (effectiveYear >= 2027) return row.renewal2027;
  if (effectiveYear >= 2025) return row.renewal2025_2026;
  if (effectiveYear === 2024) return row.renewal2024;
  if (effectiveYear === 2023) return row.renewal2023;
  if (effectiveYear >= 2020 && effectiveYear <= 2022) return row.renewal2020_2022;
  return null;
}

/**
 * Choice PDP rate. New 2027 PDPs are $0 (non-commissionable).
 * Persistency uses the original effective-year column on the 2027 packet.
 */
function lookupAetnaPdpRate({ planYear, effectiveDate, contractLevel } = {}) {
  const year = parsePlanYear(planYear) || parsePlanYear(effectiveDate);
  const level = normContractLevel(contractLevel);
  const row = AETNA_2027_PDP[level] || AETNA_2027_PDP.AG4;

  if (!year) {
    return {
      found: false,
      planYear: null,
      contractLevel: level,
      cmsNew: null,
      base: null,
      renewal: null,
      nonCommissionable: false,
      note: 'Need plan year / effective date for Aetna PDP schedule',
    };
  }

  const renewal = pdpRenewalForEffectiveYear(row, year);
  const is2027New = year >= 2027;
  return {
    found: renewal != null,
    planYear: year,
    contractLevel: level,
    cmsNew: is2027New ? 0 : row.cmsNew,
    base: is2027New ? 0 : row.base,
    renewal,
    nonCommissionable: is2027New || renewal === 0,
    note: is2027New
      ? 'New 2027 Aetna Choice PDPs are non-commissionable'
      : renewal == null
        ? `No Aetna Choice PDP persistency column for ${year}`
        : null,
  };
}

function isAetnaCarrier(carrier) {
  return String(carrier || '')
    .toLowerCase()
    .includes('aetna');
}

module.exports = {
  AETNA_2027_SOURCE,
  AETNA_2027_MA,
  AETNA_2027_PDP,
  CONTRACT_LEVELS,
  resolveMaStateGroup,
  normContractLevel,
  parsePlanYear,
  lookupAetnaMaRate,
  lookupAetnaPdpRate,
  isAetnaCarrier,
};

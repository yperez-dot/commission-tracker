'use strict';

/**
 * CMS Medicare Advantage maximum FMV (writing-agent cap) by plan year + state.
 *
 * 2026: Yahoska Perez 2026-07-01 (legacy files.js table).
 * 2027: Aetna Schedule One Agent 4 AG4 rates — these match CMS FMV
 *   National $725 / $363, CT/PA/DC $816 / $408, CA/NJ $902 / $451.
 *   PR/VI were not on the 2027 Aetna packet; keep the 2026 territory caps.
 */

const { lookupAetnaMaRate } = require('./aetnaCommissionSchedule');

const CMS_FMV_BY_YEAR = {
  2026: {
    CA: { initial: 864, renewal: 432 },
    NJ: { initial: 864, renewal: 432 },
    CT: { initial: 781, renewal: 391 },
    PA: { initial: 781, renewal: 391 },
    DC: { initial: 781, renewal: 391 },
    PR: { initial: 474, renewal: 237 },
    VI: { initial: 474, renewal: 237 },
    default: { initial: 694, renewal: 347 },
  },
  2027: {
    CA: { initial: 902, renewal: 451 },
    NJ: { initial: 902, renewal: 451 },
    CT: { initial: 816, renewal: 408 },
    PA: { initial: 816, renewal: 408 },
    DC: { initial: 816, renewal: 408 },
    PR: { initial: 474, renewal: 237 },
    VI: { initial: 474, renewal: 237 },
    default: { initial: 725, renewal: 363 },
  },
};

function planYearFromEffective(effectiveDate) {
  if (effectiveDate == null || effectiveDate === '') return null;
  if (typeof effectiveDate === 'number' && effectiveDate >= 2000 && effectiveDate <= 2100) {
    return Math.trunc(effectiveDate);
  }
  const s = String(effectiveDate).trim();
  const iso = s.match(/^(\d{4})/);
  if (iso) return parseInt(iso[1], 10);
  const mdY = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (mdY) {
    let y = mdY[3];
    if (y.length === 2) y = `20${y}`;
    return parseInt(y, 10);
  }
  return null;
}

/**
 * @param {string} state
 * @param {'initial'|'renewal'|string} eventType
 * @param {number|string|null} planYearOrEffective
 * @returns {number}
 */
function getCmsFmvCap(state, eventType, planYearOrEffective) {
  const year = planYearFromEffective(planYearOrEffective) || 2026;
  const st = String(state || '')
    .trim()
    .toUpperCase()
    .split(/[-/\s]/)[0];
  const table = CMS_FMV_BY_YEAR[year] || (year >= 2027 ? CMS_FMV_BY_YEAR[2027] : CMS_FMV_BY_YEAR[2026]);
  const caps = table[st] || table.default;
  const key = String(eventType || '').toLowerCase() === 'renewal' ? 'renewal' : 'initial';
  return caps[key];
}

/** Convenience: 2027 Aetna AG4 === CMS FMV for that state. */
function getAetna2027Ag4Cap(state, eventType) {
  const ma = lookupAetnaMaRate({ planYear: 2027, state, contractLevel: 'AG4' });
  const key = String(eventType || '').toLowerCase() === 'renewal' ? 'renewal' : 'cmsNew';
  return ma[key];
}

module.exports = {
  CMS_FMV_BY_YEAR,
  planYearFromEffective,
  getCmsFmvCap,
  getAetna2027Ag4Cap,
  // Back-compat aliases used by the Aetna BSI parser
  getCMSCap2026: (state, eventType) => getCmsFmvCap(state, eventType, 2026),
};

'use strict';

/**
 * 2026 CMS maximum FMV (writing-agent) commission per member, by state.
 * Source: Yahoska Perez 2026-07-01. Shared by the upload anomaly check
 * (routes/files.js) and Lina's renewal proration (bsiBookAttribution).
 */
const CMS_FMV_CAPS_2026 = Object.freeze({
  CA: { initial: 864, renewal: 432 },
  NJ: { initial: 864, renewal: 432 },
  CT: { initial: 781, renewal: 391 },
  PA: { initial: 781, renewal: 391 },
  DC: { initial: 781, renewal: 391 },
  PR: { initial: 474, renewal: 237 },
  VI: { initial: 474, renewal: 237 },
});
const CMS_FMV_DEFAULT_2026 = Object.freeze({ initial: 694, renewal: 347 });

function getCMSCap2026(state, eventType) {
  const caps = CMS_FMV_CAPS_2026[String(state || '').toUpperCase()] || CMS_FMV_DEFAULT_2026;
  return caps[eventType] || caps.initial;
}

module.exports = { CMS_FMV_CAPS_2026, CMS_FMV_DEFAULT_2026, getCMSCap2026 };

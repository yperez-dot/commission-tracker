'use strict';

/**
 * Display names for house statement types (Payroll → Statements).
 * Internal type ids stay the same (thei_nhp, thei_bsi, bsi_override, …) — only labels change.
 * Shared by the server (Excel titles, sheet names, file names) and the browser (type picker, downloads).
 */

const HOUSE_STATEMENT_NAMES = Object.freeze({
  thei_nhp: { label: 'THEI. NHP Statement', slug: 'THEI_NHP_Statement' },
  thei_bsi: { label: 'THEI. BSI Statement', slug: 'THEI_BSI_Statement' },
  bsi_override: { label: 'BSI Medicare Overrides', slug: 'BSI_Medicare_Overrides' },
});

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ], and no leading/trailing apostrophe. */
function safeSheetName(name, fallback = 'Statement') {
  const s = String(name || '')
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .slice(0, 31)
    .trim();
  return s || fallback;
}

function houseStatementLabel(type) {
  return HOUSE_STATEMENT_NAMES[type] ? HOUSE_STATEMENT_NAMES[type].label : null;
}

/** e.g. THEI_BSI_Statement_202609.xlsx; null for types that keep their old name. */
function houseStatementFilename(type, period, ext = 'xlsx') {
  const n = HOUSE_STATEMENT_NAMES[type];
  if (!n) return null;
  const periodPart = period && period !== 'all' ? String(period).replace(/[^A-Za-z0-9_-]/g, '') : 'ALL';
  return `${n.slug}_${periodPart}.${ext}`;
}

module.exports = { HOUSE_STATEMENT_NAMES, safeSheetName, houseStatementLabel, houseStatementFilename };

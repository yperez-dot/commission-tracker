'use strict';

/**
 * One period / month display format for OliComm: MM.YYYY (e.g. 09.2026).
 *
 * Internal values (YYYYMM in the DB, API params, file names) are unchanged — this is
 * display only. NHP pay cycles (YYYYMMDD) show as "MM.YYYY · cycle DD" so two cycles in the
 * same month stay distinguishable.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function validMonth(m) {
  return Number.isInteger(m) && m >= 1 && m <= 12;
}

function validYear(y) {
  return Number.isInteger(y) && y >= 1900 && y <= 2100;
}

/**
 * Month-ish value → "MM.YYYY", or null when it isn't a recognisable period.
 * Accepts YYYYMM, YYYYMMDD (cycle), MM/YYYY, M/YYYY, MM/DD/YYYY, MM-YYYY, MM.YYYY, YYYY-MM.
 */
function periodToMmYyyy(p) {
  if (p == null) return null;
  const s = String(p).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})(\d{2})$/))) {
    const y = +m[1]; const mo = +m[2];
    return validYear(y) && validMonth(mo) ? `${pad2(mo)}.${y}` : null;
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    const y = +m[1]; const mo = +m[2]; const d = +m[3];
    if (!validYear(y) || !validMonth(mo) || d < 1 || d > 31) return null;
    return `${pad2(mo)}.${y} · cycle ${pad2(d)}`;
  }
  if ((m = s.match(/^(\d{1,2})[./-](\d{4})$/))) {
    const mo = +m[1]; const y = +m[2];
    return validYear(y) && validMonth(mo) ? `${pad2(mo)}.${y}` : null;
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    const mo = +m[1]; const y = +m[3];
    return validYear(y) && validMonth(mo) ? `${pad2(mo)}.${y}` : null;
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) {
    const y = +m[1]; const mo = +m[2];
    return validYear(y) && validMonth(mo) ? `${pad2(mo)}.${y}` : null;
  }
  return null;
}

/**
 * Display label for a period. Unrecognised values come back as `fallback`
 * (default: the value itself, or '' when empty).
 */
function formatPeriodLabel(p, fallback) {
  const out = periodToMmYyyy(p);
  if (out) return out;
  if (fallback !== undefined) return fallback;
  return p == null ? '' : String(p);
}

/**
 * What a person typed as a month → YYYYMM (or null).
 * Accepts MM.YYYY, MM/YYYY, MM-YYYY, M.YYYY, YYYYMM, YYYY-MM.
 */
function parsePeriodInput(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d{4})(\d{2})$/))) {
    return validYear(+m[1]) && validMonth(+m[2]) ? `${m[1]}${m[2]}` : null;
  }
  if ((m = t.match(/^(\d{1,2})\s*[./-]\s*(\d{4})$/))) {
    return validYear(+m[2]) && validMonth(+m[1]) ? `${m[2]}${pad2(+m[1])}` : null;
  }
  if ((m = t.match(/^(\d{4})-(\d{1,2})$/))) {
    return validYear(+m[1]) && validMonth(+m[2]) ? `${m[1]}${pad2(+m[2])}` : null;
  }
  return null;
}

/** For period inputs: a typed MM.YYYY becomes YYYYMM; anything else passes through trimmed. */
function normalizePeriodInput(s) {
  return parsePeriodInput(s) || String(s == null ? '' : s).trim();
}

/**
 * Rewrite stand-alone YYYYMM tokens inside free text (change-log summaries, server
 * warnings) as MM.YYYY. Skips ids/amounts: tokens next to other digits, '#', '$', '.', ',' or '_'.
 */
function formatPeriodsInText(text) {
  const s = String(text == null ? '' : text);
  return s.replace(/(^|[^0-9#$.,_\w])(20\d{2})(0[1-9]|1[0-2])(?![0-9.,_\w])/g, (all, pre, y, m) => `${pre}${m}.${y}`);
}

module.exports = { periodToMmYyyy, formatPeriodLabel, parsePeriodInput, normalizePeriodInput, formatPeriodsInText };

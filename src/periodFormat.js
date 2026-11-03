'use strict';

/**
 * One period / month display format for OliComm: MM.YYYY (e.g. 09.2026).
 *
 * Internal values (YYYYMM in the DB, API params, file names) are unchanged — this is
 * display only. NHP pay cycles (YYYYMMDD) show as "MM.YYYY · cycle DD" so two cycles in the
 * same month stay distinguishable.
 *
 * NOTE: no array destructuring / spread in this file. The CRA frontend imports it
 * and Babel would inject an ESM helper that hides module.exports (same constraint
 * as src/bsiStatementTitle.js).
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
function twoDigitYear(yy) {
  const n = Number(yy);
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  const y = 2000 + n;
  return validYear(y) ? y : null;
}

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
  if ((m = t.match(/^(\d{1,2})\s*[./-]\s*(\d{2})$/))) {
    const y = twoDigitYear(+m[2]);
    return y && validMonth(+m[1]) ? `${y}${pad2(+m[1])}` : null;
  }
  if ((m = t.match(/^(\d{4})-(\d{1,2})$/))) {
    return validYear(+m[1]) && validMonth(+m[2]) ? `${m[1]}${pad2(+m[2])}` : null;
  }
  return null;
}

/**
 * Filename → YYYYMM. Accepts YYYY-MM-DD, month names, MM.YYYY / MM-YYYY / MM.YY / MM-YY.
 * `BSI.UHC.10.26.xlsx` → 202610.
 */
function periodFromFilename(filename) {
  const f = String(filename == null ? '' : filename);
  if (!f) return null;
  let m;
  if ((m = f.match(/(20\d{2})-(0[1-9]|1[0-2])-\d{2}/))) {
    return `${m[1]}${m[2]}`;
  }
  if ((m = f.match(/(20\d{2})[-_.](0[1-9]|1[0-2])(?!\d)/))) {
    return `${m[1]}${m[2]}`;
  }
  const monthMap = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  };
  const fnLower = f.toLowerCase();
  const monthNames = Object.keys(monthMap);
  for (let i = 0; i < monthNames.length; i += 1) {
    const month = monthNames[i];
    if (fnLower.indexOf(month) !== -1) {
      const ym = f.match(/(20\d{2})/);
      if (ym) return `${ym[1]}${monthMap[month]}`;
    }
  }
  if ((m = f.match(/(?:^|[^\d])(0?[1-9]|1[0-2])[._\- ](20\d{2})(?!\d)/))) {
    return `${m[2]}${pad2(+m[1])}`;
  }
  if ((m = f.match(/(?:^|[^\d])(0?[1-9]|1[0-2])[._\- ](\d{2})(?!\d)/))) {
    const y = twoDigitYear(+m[2]);
    if (y) return `${y}${pad2(+m[1])}`;
  }
  return null;
}

/** Statement Date (MM/DD/YYYY, YYYY-MM-DD, Excel serial) → YYYYMM. */
function periodFromStatementDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !isNaN(value)) {
    const y = value.getUTCFullYear();
    const mo = value.getUTCMonth() + 1;
    return validYear(y) && validMonth(mo) ? `${y}${pad2(mo)}` : null;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    return validYear(y) && validMonth(mo) ? `${y}${pad2(mo)}` : null;
  }
  const t = String(value).trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m && validYear(+m[3]) && validMonth(+m[1])) return `${m[3]}${pad2(+m[1])}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m && validYear(+m[1]) && validMonth(+m[2])) return `${m[1]}${m[2]}`;
  return parsePeriodInput(t);
}

/**
 * UHC/BSI row period: Payment Period, else Statement Date month, else filename.
 */
function resolveBsiRowPeriod(row, filenamePeriod) {
  const pay = parsePeriodInput(row && (row['Payment Period'] != null ? row['Payment Period'] : row.paymentPeriod));
  if (pay) return pay;
  const fromStmt = periodFromStatementDate(row && (row['Statement Date'] || row.statementDate));
  if (fromStmt) return fromStmt;
  const fromFn = parsePeriodInput(filenamePeriod) || (filenamePeriod && /^\d{6}$/.test(String(filenamePeriod)) ? String(filenamePeriod) : null);
  return fromFn || '';
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

module.exports = {
  periodToMmYyyy,
  formatPeriodLabel,
  parsePeriodInput,
  normalizePeriodInput,
  formatPeriodsInText,
  periodFromFilename,
  periodFromStatementDate,
  resolveBsiRowPeriod,
};

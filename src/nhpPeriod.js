'use strict';

/**
 * NHP period helpers.
 *
 * NHP pays on **payment cycles** (deposit dates), not one calendar coverage month.
 * Examples from NHP emails:
 *   - Mar 30, 2026 cycle → statement ~Apr 7, 2026
 *   - May 30, 2026 cycle → statement ~Jun 4, 2026
 *   - Jun 15, 2026 cycle → statement ~Jun 17, 2026
 *
 * OliComm rules:
 *   - payment_period  → cycle batch (YYYYMM of deposit / statement / upload)
 *                       One uploaded NHP file = one cycle (all rows share it).
 *   - statement_month → Carrier-Statement Month coverage label
 *                       e.g. "Cigna - April 2026" (may differ from the cycle month)
 */

/**
 * Extract YYYYMM coverage month from NHP "Carrier-Statement Month"
 * values like "Cigna - April 2026" → "202604".
 * Used for statement_month display / audit — NOT for house payment_period.
 */
function extractPeriodFromStatementMonth(statementMonth) {
  if (!statementMonth) return null;
  const s = String(statementMonth).toLowerCase();

  const yearMatch = s.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const year = yearMatch[1];

  // Longest names first so "september" wins over "sep"
  const months = [
    ['january', '01'], ['february', '02'], ['september', '09'],
    ['october', '10'], ['november', '11'], ['december', '12'],
    ['august', '08'], ['march', '03'], ['april', '04'],
    ['june', '06'], ['july', '07'], ['sept', '09'],
    ['jan', '01'], ['feb', '02'], ['mar', '03'], ['apr', '04'],
    ['may', '05'], ['jun', '06'], ['jul', '07'], ['aug', '08'],
    ['sep', '09'], ['oct', '10'], ['nov', '11'], ['dec', '12'],
  ];

  for (const [name, num] of months) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(s)) {
      return `${year}${num}`;
    }
  }

  // Numeric month: "Cigna - 04/2026" or "Carrier - 2026-04"
  const numeric = s.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/) ||
    s.match(/\b(0?[1-9]|1[0-2])[-/](20\d{2})\b/);
  if (numeric) {
    if (numeric[1].length === 4) {
      return `${numeric[1]}${String(numeric[2]).padStart(2, '0')}`;
    }
    return `${numeric[2]}${String(numeric[1]).padStart(2, '0')}`;
  }

  return null;
}

function toYyyymm(y, m) {
  const year = String(y);
  const month = String(m).padStart(2, '0');
  if (!/^20\d{2}$/.test(year)) return null;
  if (month < '01' || month > '12') return null;
  return `${year}${month}`;
}

function toYyyymmdd(y, m, d) {
  const yyyymm = toYyyymm(y, m);
  if (!yyyymm) return null;
  const day = String(d).padStart(2, '0');
  if (day < '01' || day > '31') return null;
  return `${yyyymm}${day}`;
}

/**
 * Parse a cycle/statement date into YYYYMM (house period) or YYYYMMDD when day is known.
 * Prefer YYYYMM for picker compatibility; pass through YYYYMMDD when filename has a day
 * so May 30 vs Jun 15 cycles in adjacent months stay distinct as 20260530 / 20260615.
 */
function normalizeCycleDate(value, { preferDay = true } = {}) {
  if (value == null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(d.getTime())) {
      return preferDay
        ? toYyyymmdd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
        : toYyyymm(d.getUTCFullYear(), d.getUTCMonth() + 1);
    }
  }

  const s = String(value).trim();
  if (/^\d{6}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return preferDay ? s : s.slice(0, 6);

  // Allow dates after underscores in filenames ( _ is a word char, so \b fails)
  let m = s.match(/(?:^|[^0-9])(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})(?:[^0-9]|$)/);
  if (m) {
    return preferDay
      ? toYyyymmdd(m[1], m[2], m[3])
      : toYyyymm(m[1], m[2]);
  }
  m = s.match(/(?:^|[^0-9])(\d{1,2})[-_/](\d{1,2})[-_/](20\d{2})(?:[^0-9]|$)/);
  if (m) {
    return preferDay
      ? toYyyymmdd(m[3], m[1], m[2])
      : toYyyymm(m[3], m[1]);
  }
  // Compact YYYYMMDD in filename
  m = s.match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
  if (m) {
    return preferDay ? `${m[1]}${m[2]}${m[3]}` : `${m[1]}${m[2]}`;
  }

  // "June 15, 2026" / "Jun 15 2026"
  const months = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
    oct: 10, nov: 11, dec: 12,
  };
  m = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/);
  if (m) {
    const mi = months[m[1].toLowerCase()];
    if (mi) {
      return preferDay
        ? toYyyymmdd(m[3], mi, m[2])
        : toYyyymm(m[3], mi);
    }
  }

  return null;
}

/** Pull a cycle date from common NHP portal / email filenames. */
function extractCycleFromFilename(filename) {
  const f = String(filename || '');
  if (!f) return null;
  return normalizeCycleDate(f, { preferDay: true });
}

/**
 * Resolve NHP **payment cycle** period for house/payroll.
 *
 * Priority:
 *   1. Explicit cycle / statement / deposit date
 *   2. Date embedded in filename
 *   3. Upload-batch YYYYMM (when the file was ingested)
 *
 * Does **not** use Carrier-Statement Month (coverage) — that belongs in statement_month.
 *
 * @param {object|string|null} statementMonthOrOpts
 *   Legacy: (statementMonth, uploadPeriod) still accepted but statementMonth is ignored for period.
 * @param {string} [uploadPeriod]
 */
function resolveNhpPaymentPeriod(statementMonthOrOpts, uploadPeriod) {
  // Legacy two-arg call: (statementMonth, uploadPeriod) — coverage month must NOT drive cycle.
  if (
    statementMonthOrOpts == null ||
    typeof statementMonthOrOpts === 'string' ||
    typeof statementMonthOrOpts === 'number'
  ) {
    return (
      (uploadPeriod && /^\d{6,8}$/.test(String(uploadPeriod)) ? String(uploadPeriod) : null) ||
      'Unknown'
    );
  }

  const opts = statementMonthOrOpts || {};
  return (
    normalizeCycleDate(opts.cycleDate, { preferDay: true }) ||
    normalizeCycleDate(opts.statementDate, { preferDay: true }) ||
    normalizeCycleDate(opts.depositDate, { preferDay: true }) ||
    extractCycleFromFilename(opts.filename) ||
    (opts.uploadPeriod && /^\d{6,8}$/.test(String(opts.uploadPeriod))
      ? String(opts.uploadPeriod)
      : null) ||
    'Unknown'
  );
}

/**
 * Label for house period picker — supports YYYYMM and YYYYMMDD cycles.
 * e.g. 202606 → "Jun 2026", 20260615 → "Jun 15, 2026 cycle"
 */
function formatNhpCyclePeriodLabel(period) {
  const s = String(period || '').trim();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (/^\d{8}$/.test(s)) {
    const m = parseInt(s.slice(4, 6), 10);
    const d = parseInt(s.slice(6, 8), 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${months[m - 1]} ${d}, ${s.slice(0, 4)} cycle`;
    }
  }
  if (/^\d{6}$/.test(s)) {
    const m = parseInt(s.slice(4, 6), 10);
    if (m >= 1 && m <= 12) return `${months[m - 1]} ${s.slice(0, 4)}`;
  }
  return s;
}

module.exports = {
  extractPeriodFromStatementMonth,
  extractCycleFromFilename,
  normalizeCycleDate,
  resolveNhpPaymentPeriod,
  formatNhpCyclePeriodLabel,
};

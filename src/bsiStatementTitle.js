'use strict';

/*
 * NOTE: no array destructuring in this file — Babel would inject an ESM helper
 * import and break `module.exports` for the CRA build.
 */

/**
 * Standard titles for Carrier→BSI statement uploads (BSI Statements page).
 *
 *   BSI · Humana · 2026-09
 *   BSI · Humana · 2025-11 to 2025-12   (statement spans more than one month)
 *
 * Month source, most reliable first:
 *   1. statement period in the parsed rows (commission_records.payment_period)
 *   2. the filename (09.2026, 202512, JULY_2026, 2026-08-01, 08.01.26, 11.25_12.25 …)
 *   3. a fallback title (e.g. a previously stored / typed title)
 *
 * CommonJS so the API (routes/files.js), the backfill script and the CRA
 * frontend can all share one copy.
 */

const MONTH_NAMES = [
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
  ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12],
  ['sept', 9], ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['jun', 6], ['jul', 7],
  ['aug', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
];

// Order matters: first match wins. Keys are matched against a lowercased,
// separator-normalized string.
const CARRIERS = [
  [/\bhumana\b|healthspring/, 'Humana'],
  [/\buhc\b|united\s*health|unitedhealthcare|\bunited\b/, 'UHC'],
  [/\bdevoted\b/, 'Devoted'],
  [/\baetna\b/, 'Aetna'],
  [/\bfreedom\b/, 'Freedom'],
  [/\boptimum\b/, 'Optimum'],
  [/\bwellcare\b/, 'WellCare'],
  [/\bcigna\b/, 'Cigna'],
  [/\bsimply\b/, 'Simply'],
  [/\bsunshine\b/, 'Sunshine Health'],
  [/florida\s*blue/, 'Florida Blue'],
  [/\bmolina\b/, 'Molina'],
  [/\bsolis\b/, 'Solis'],
  [/\bzing\b/, 'Zing'],
  [/\bcarelon\b/, 'Carelon'],
  [/\bclover\b/, 'Clover'],
  [/\bdoctors\s*health(care)?\b/, 'Doctors HealthCare'],
  [/\bleon\b/, 'Leon'],
  [/\bsimpra\b/, 'Simpra'],
  [/\bammex\b|\bmutual of omaha\b|\bomaha\b/, 'Mutual of Omaha'],
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ym(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 2000 || y > 2099) return null;
  return `${y}-${pad2(m)}`;
}

function yearFrom2(yy) {
  const n = Number(yy);
  return Number.isInteger(n) ? 2000 + n : NaN;
}

function monthIndex(ymStr) {
  const parts = ymStr.split('-').map(Number);
  return parts[0] * 12 + (parts[1] - 1);
}

function separatorNormalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.(xlsx|xls|csv|pdf)$/i, '')
    .replace(/[_\s·]+/g, ' ')
    .trim();
}

/** Canonical carrier display name ("Humana", "UHC", …) or ''. */
function carrierDisplayName(text) {
  const s = separatorNormalize(text).replace(/[-.]+/g, ' ');
  for (const entry of CARRIERS) {
    if (entry[0].test(s)) return entry[1];
  }
  return '';
}

/**
 * Pick the carrier: filename keyword first (it names the statement), then the
 * upload's carrier column (comma list from parsed rows).
 */
function resolveCarrier({ filename, carrier, fallbackTitle } = {}) {
  const fromName = carrierDisplayName(filename);
  if (fromName) return fromName;
  const parts = String(carrier || '').split(',').map((x) => x.trim()).filter(Boolean);
  const canon = [...new Set(parts.map((p) => carrierDisplayName(p) || p))];
  if (canon.length === 1) return canon[0];
  const fromTitle = carrierDisplayName(fallbackTitle);
  if (fromTitle) return fromTitle;
  if (canon.length > 1) return canon.join(' + ');
  return '';
}

/** Normalize a stored payment_period ("202609", "2026-09", "09/2026", "09/15/2026") to "YYYY-MM". */
function normalizePeriodToYm(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || /^unknown$/i.test(s)) return null;
  let m = s.match(/^(20\d{2})(0[1-9]|1[0-2])(\d{2})?$/);
  if (m) return ym(m[1], m[2]);
  m = s.match(/^(20\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?(?:[T\s].*)?$/);
  if (m) return ym(m[1], m[2]);
  m = s.match(/^(0?[1-9]|1[0-2])[-/.](?:\d{1,2}[-/.])?(20\d{2})$/);
  if (m) return ym(m[2], m[1]);
  return null;
}

/**
 * Month(s) from a filename or title. Returns { start, end, yearMissing? } or null.
 * Handles: 2026-08-01, 2026-09, 202512, 20260801, 09.2026, 09-2026, 08.01.26,
 * 11.25_12.25 (MM.YY range), JULY_2026, July 2026, Sept 2026, 07.26 (MM.YY).
 */
function monthsFromText(text) {
  const raw = String(text || '').replace(/\.(xlsx|xls|csv|pdf)$/i, '');
  if (!raw.trim()) return null;
  const s = raw.toLowerCase();

  // MM.YY_MM.YY range (e.g. Humana_BSI_11.25_12.25)
  let m = s.match(/(?:^|[^0-9])(0?[1-9]|1[0-2])[.\-](\d{2})[\s_\-]+(?:to[\s_\-]+)?(0?[1-9]|1[0-2])[.\-](\d{2})(?![0-9.\-])/);
  if (m) {
    const a = ym(yearFrom2(m[2]), m[1]);
    const b = ym(yearFrom2(m[4]), m[3]);
    if (a && b) return monthIndex(a) <= monthIndex(b) ? { start: a, end: b } : { start: b, end: a };
  }
  // YYYY-MM to YYYY-MM (our own range format)
  m = s.match(/(20\d{2})-(0[1-9]|1[0-2])\s*(?:to|–|—|_to_)\s*(20\d{2})-(0[1-9]|1[0-2])/);
  if (m) {
    const a = ym(m[1], m[2]);
    const b = ym(m[3], m[4]);
    if (a && b) return { start: a, end: b };
  }
  // ISO date / YYYY-MM (2026-08-01, 2026_09, 2026.09)
  m = s.match(/(?:^|[^0-9])(20\d{2})[-_.](0[1-9]|1[0-2])(?:[-_.](0[1-9]|[12]\d|3[01]))?(?![0-9])/);
  if (m) {
    const a = ym(m[1], m[2]);
    if (a) return { start: a, end: a };
  }
  // YYYYMMDD / YYYYMM (202512, 20260801)
  m = s.match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])(?:(0[1-9]|[12]\d|3[01]))?(?![0-9])/);
  if (m) {
    const a = ym(m[1], m[2]);
    if (a) return { start: a, end: a };
  }
  // MM.DD.YYYY / MM-DD-YYYY / MM.YYYY / MM-YYYY (09.2026)
  m = s.match(/(?:^|[^0-9])(0?[1-9]|1[0-2])[-_.\/](?:(?:0?[1-9]|[12]\d|3[01])[-_.\/])?(20\d{2})(?![0-9])/);
  if (m) {
    const a = ym(m[2], m[1]);
    if (a) return { start: a, end: a };
  }
  // Month name + year (JULY_2026, July 2026, Sept-2026, AUGUST_2026-08-01 caught above)
  const spaced = s.replace(/[_\-.]+/g, ' ');
  for (const entry of MONTH_NAMES) {
    const name = entry[0];
    const num = entry[1];
    const re = new RegExp(`\\b${name}\\b\\s*(?:\\d{1,2}(?:st|nd|rd|th)?\\s*,?\\s*)?(20\\d{2})\\b`);
    const mm = spaced.match(re);
    if (mm) {
      const a = ym(mm[1], num);
      if (a) return { start: a, end: a };
    }
  }
  // MM.DD.YY (08.01.26)
  m = s.match(/(?:^|[^0-9])(0?[1-9]|1[0-2])[.\-\/](0[1-9]|[12]\d|3[01])[.\-\/](\d{2})(?![0-9])/);
  if (m) {
    const a = ym(yearFrom2(m[3]), m[1]);
    if (a) return { start: a, end: a };
  }
  // MM.YY (07.26) — only with a dot/dash, and YY in a plausible range
  m = s.match(/(?:^|[^0-9])(0[1-9]|1[0-2])[.\-](2[0-9])(?![0-9.\-])/);
  if (m) {
    const a = ym(yearFrom2(m[2]), m[1]);
    if (a) return { start: a, end: a };
  }
  // Month name alone (year missing)
  for (const entry of MONTH_NAMES) {
    const name = entry[0];
    const num = entry[1];
    if (name.length < 3) continue;
    if (new RegExp(`\\b${name}\\b`).test(spaced)) {
      return { start: null, end: null, month: num, yearMissing: true };
    }
  }
  return null;
}

/**
 * Month(s) from parsed rows. `periods` is [{ period, count }] (or an array of
 * raw period strings). Months holding ≥ 20% of dated rows count as statement
 * months; stray chargeback/back-pay months below that are ignored.
 */
function monthsFromPeriods(periods) {
  const counts = new Map();
  let total = 0;
  for (const p of periods || []) {
    const value = p && typeof p === 'object' ? p.period : p;
    const n = p && typeof p === 'object' ? Number(p.count) || 0 : 1;
    const k = normalizePeriodToYm(value);
    if (!k || n <= 0) continue;
    counts.set(k, (counts.get(k) || 0) + n);
    total += n;
  }
  if (!total) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const major = sorted.filter((e) => e[1] / total >= 0.2).map((e) => e[0]);
  if (!major.length) major.push(sorted[0][0]);
  major.sort((a, b) => monthIndex(a) - monthIndex(b));
  const start = major[0];
  const end = major[major.length - 1];
  const topShare = sorted[0][1] / total;
  return {
    start,
    end,
    spanMonths: monthIndex(end) - monthIndex(start) + 1,
    distinctMonths: counts.size,
    topShare,
    total,
  };
}

function formatRange(start, end) {
  if (!start) return '';
  return !end || end === start ? start : `${start} to ${end}`;
}

function rangesEqual(a, b) {
  return a && b && a.start === b.start && (a.end || a.start) === (b.end || b.start);
}

function overlaps(a, b) {
  if (!a || !b || !a.start || !b.start) return false;
  const a0 = monthIndex(a.start); const a1 = monthIndex(a.end || a.start);
  const b0 = monthIndex(b.start); const b1 = monthIndex(b.end || b.start);
  return a0 <= b1 && b0 <= a1;
}

/** Fill in a missing year using the upload date (latest such month not after upload). */
function inferYear(month, uploadedAt) {
  const d = uploadedAt ? new Date(uploadedAt) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  let y = d.getUTCFullYear();
  if (month > d.getUTCMonth() + 1) y -= 1;
  return ym(y, month);
}

/**
 * Build the standardized title.
 * @param {object} input
 * @param {string} input.filename       uploads.original_name
 * @param {string} [input.carrier]      uploads.carrier (comma list)
 * @param {Array}  [input.periods]      [{ period, count }] from commission_records
 * @param {string} [input.fallbackTitle] previously stored / typed title
 * @param {string|Date} [input.uploadedAt]
 * @returns {{ title, carrier, start, end, source, confidence, notes: string[] }}
 */
function buildBsiStatementTitle(input = {}) {
  const { filename, periods, fallbackTitle, uploadedAt } = input;
  const notes = [];
  const carrier = resolveCarrier(input);
  if (!carrier) notes.push('carrier not recognized');

  const fromData = monthsFromPeriods(periods);
  let fromName = monthsFromText(filename);
  let fromTitle = monthsFromText(fallbackTitle);
  if (fromName && fromName.yearMissing) {
    const guess = inferYear(fromName.month, uploadedAt);
    fromName = guess ? { start: guess, end: guess, yearInferred: true } : null;
  }
  if (fromTitle && fromTitle.yearMissing) fromTitle = null;

  let range = null;
  let source = 'none';
  let confidence = 'low';

  if (fromData) {
    range = { start: fromData.start, end: fromData.end };
    source = 'data';
    confidence = 'high';
    if (fromData.spanMonths > 3) {
      notes.push(`statement rows span ${fromData.spanMonths} months (${formatRange(fromData.start, fromData.end)})`);
      confidence = 'low';
      if (fromName && !fromName.yearInferred) {
        range = { start: fromName.start, end: fromName.end };
        source = 'filename';
        notes.push('used filename month instead');
      }
    } else if (fromData.topShare < 0.6 && fromData.spanMonths === 1) {
      confidence = 'medium';
    }
    if (fromName && source === 'data' && !rangesEqual(range, fromName)) {
      if (overlaps(range, fromName)) {
        notes.push(`filename says ${formatRange(fromName.start, fromName.end)}`);
        confidence = confidence === 'high' ? 'medium' : confidence;
      } else {
        notes.push(`filename says ${formatRange(fromName.start, fromName.end)} but rows say ${formatRange(range.start, range.end)}`);
        confidence = 'low';
      }
    }
  } else if (fromName) {
    range = { start: fromName.start, end: fromName.end };
    source = 'filename';
    confidence = fromName.yearInferred ? 'low' : 'medium';
    notes.push('no statement period in rows; month from filename');
    if (fromName.yearInferred) notes.push('year not in filename; inferred from upload date');
  } else if (fromTitle) {
    range = { start: fromTitle.start, end: fromTitle.end };
    source = 'title';
    confidence = 'low';
    notes.push('month from previous title');
  } else {
    notes.push('statement month could not be determined');
  }

  const title = ['BSI', carrier || 'Unknown carrier', range ? formatRange(range.start, range.end) : '']
    .filter(Boolean)
    .join(' · ');

  return {
    title,
    carrier,
    start: range ? range.start : null,
    end: range ? range.end || range.start : null,
    source,
    confidence,
    notes,
  };
}

/** Title to show in the list: stored title wins, else computed from filename/carrier. */
function bsiUploadTitle(upload) {
  if (!upload) return '';
  const stored = String(upload.display_title || '').trim();
  if (stored) return stored;
  return buildBsiStatementTitle({
    filename: upload.original_name,
    carrier: upload.carrier,
    periods: upload.period_counts,
    uploadedAt: upload.uploaded_at,
  }).title;
}

const MAX_TITLE_LENGTH = 120;

/** Clean an admin-typed title. Returns '' when it should reset to auto. */
function cleanManualTitle(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

module.exports = {
  buildBsiStatementTitle,
  bsiUploadTitle,
  carrierDisplayName,
  resolveCarrier,
  monthsFromText,
  monthsFromPeriods,
  normalizePeriodToYm,
  cleanManualTitle,
  MAX_TITLE_LENGTH,
};

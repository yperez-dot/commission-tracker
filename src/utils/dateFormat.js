import { periodToMmYyyy } from '../periodFormat';
/**
 * Format dates consistently across OliComm as MM-DD-YYYY.
 * Compact carrier values (Doctors Healthcare 20240101, statement period 202606)
 * are converted to the same display style used elsewhere in the app.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isValidYmd(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function mdY(year, month, day) {
  return `${pad2(month)}-${pad2(day)}-${year}`;
}

/** Statement period YYYYMM → "06.2026" (Dashboard / Payroll / All Data). */
export function formatPeriod(periodStr) {
  if (periodStr == null || periodStr === '') return '—';
  const s = String(periodStr).trim();
  if (!s) return '—';
  if (/^\d{6}$/.test(s) || /^\d{1,2}\/\d{4}$/.test(s) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) {
    const us = s.match(/^(\d{1,2})[\/\-]\d{1,2}[\/\-](\d{4})$/);
    return periodToMmYyyy(us ? `${us[1]}/${us[2]}` : s) || s;
  }
  return s;
}

export function formatDate(dateStr) {
  if (dateStr == null || dateStr === '') return '—';

  try {
    if (dateStr instanceof Date && !Number.isNaN(dateStr.getTime())) {
      return `${pad2(dateStr.getUTCMonth() + 1)}-${pad2(dateStr.getUTCDate())}-${dateStr.getUTCFullYear()}`;
    }

    const s = String(dateStr).trim();
    if (!s) return '—';

    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return mdY(iso[1], iso[2], iso[3]);

    const us = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (us) return mdY(us[3], us[1], us[2]);

    // Doctors Healthcare and similar: 20240101 → 01-01-2024
    if (/^\d{8}$/.test(s) && isValidYmd(s.slice(0, 4), s.slice(4, 6), s.slice(6, 8))) {
      return mdY(s.slice(0, 4), s.slice(4, 6), s.slice(6, 8));
    }

    // Statement period stored on last-commission: 202606 → Jun 2026
    if (/^\d{6}$/.test(s)) return formatPeriod(s);

    return s;
  } catch (e) {
    return String(dateStr);
  }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();

    return `${month}-${day}-${year}`;
  } catch (e) {
    return dateStr;
  }
}

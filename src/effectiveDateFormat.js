'use strict';

/**
 * Normalize commission effective dates to MM-DD-YYYY for House Statements
 * (UI, CSV, Excel). Accepts Date, ISO, YYYY-MM-DD, MM/DD/YYYY, MM-DD-YYYY.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatEffectiveDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}-${value.getUTCFullYear()}`;
  }
  const s = String(value).trim();
  if (!s || s === '—') return '';

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}-${iso[3]}-${iso[1]}`;

  const us = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (us) return `${pad2(us[1])}-${pad2(us[2])}-${us[3]}`;

  return s;
}

module.exports = { formatEffectiveDate };

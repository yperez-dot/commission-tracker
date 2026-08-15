'use strict';

/**
 * Extract YYYYMM payment_period from NHP "Carrier-Statement Month"
 * values like "Cigna - April 2026" → "202604".
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

/**
 * Prefer statement-month period; fall back to upload-date YYYYMM.
 */
function resolveNhpPaymentPeriod(statementMonth, uploadPeriod) {
  return extractPeriodFromStatementMonth(statementMonth) || uploadPeriod || 'Unknown';
}

module.exports = {
  extractPeriodFromStatementMonth,
  resolveNhpPaymentPeriod,
};

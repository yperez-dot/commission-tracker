/**
 * Period helpers for the Payroll → Statements page (agent + house statements in one place).
 *
 * The page has one month picker (YYYYMM). Agent statements are monthly. House statements
 * are also keyed by month, except NHP payment cycles, which are stored as YYYYMMDD; those
 * show up as an extra "Pay cycle" choice for the picked month.
 */

const { periodToMmYyyy } = require('../periodFormat');

function isMonth(p) {
  return /^\d{6}$/.test(String(p || ''));
}

/**
 * Month the Statements page opens on: the requested month when it is in the list,
 * else the newest YYYYMM period (same default the other Payroll tabs use).
 */
function statementsMonth(periods, requested) {
  const list = (periods || []).map(String);
  if (isMonth(requested) && list.includes(String(requested))) return String(requested);
  const months = list.filter(isMonth).sort((a, b) => b.localeCompare(a));
  return months[0] || '';
}

function monthLabel(m) {
  const s = String(m);
  return periodToMmYyyy(s) || s;
}

/**
 * House statement periods available for one month: the month itself first, then any
 * NHP payment cycles (YYYYMMDD) that fall in that month, oldest first.
 * `overridePeriods` is the /override-statements/periods payload ([{ period }] or strings).
 */
function houseCycleOptions(month, overridePeriods) {
  if (!isMonth(month)) return [];
  const m = String(month);
  const cycles = Array.from(new Set((overridePeriods || [])
    .map((p) => String(p && typeof p === 'object' ? p.period : p))
    .filter((p) => /^\d{8}$/.test(p) && p.startsWith(m))))
    .sort();
  return [
    { value: m, label: `${monthLabel(m)} (month)` },
    ...cycles.map((c) => ({ value: c, label: periodToMmYyyy(c) })),
  ];
}

module.exports = { statementsMonth, houseCycleOptions, isMonth };

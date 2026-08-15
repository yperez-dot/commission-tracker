'use strict';

/**
 * Pure helpers for ADP / 1099 export CSV formatting.
 */
function buildAdpCsv(producers) {
  const header = ['Agent', 'Total Payable', 'Record Count'];
  const lines = [header.join(',')];
  for (const r of producers || []) {
    lines.push([
      `"${String(r.name || '').replace(/"/g, '""')}"`,
      Number(r.total_payable || 0).toFixed(2),
      r.record_count || 0,
    ].join(','));
  }
  return lines.join('\n');
}

module.exports = { buildAdpCsv };

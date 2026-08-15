'use strict';

/**
 * Page through a limit/offset list endpoint until all rows are loaded
 * (or a safety cap is hit). Avoids silent undercounts on recon/payroll.
 *
 * @param {string} path - API path under /api (e.g. '/records?period=202607')
 * @param {object} [opts]
 * @param {number} [opts.pageSize=5000]
 * @param {string} [opts.itemsKey='records'] - response array key
 * @param {string} [opts.totalKey='total'] - response total key (also checks db_total)
 * @param {number} [opts.maxRows=200000] - hard safety cap
 * @param {Function} [fetchFn] - injectable fetch (defaults to apiFetch in browser)
 */
async function fetchAllPages(path, opts = {}, fetchFn) {
  const pageSize = opts.pageSize || 5000;
  const itemsKey = opts.itemsKey || 'records';
  const totalKey = opts.totalKey || 'total';
  const maxRows = opts.maxRows || 200000;

  if (typeof fetchFn !== 'function') {
    fetchFn = require('./api').apiFetch;
  }

  const sep = path.includes('?') ? '&' : '?';
  const items = [];
  let total = null;
  let pages = 0;

  while (true) {
    pages += 1;
    const offset = items.length;
    const data = await fetchFn(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    const chunk = Array.isArray(data[itemsKey]) ? data[itemsKey] : [];
    const reported =
      typeof data[totalKey] === 'number'
        ? data[totalKey]
        : typeof data.db_total === 'number'
          ? data.db_total
          : typeof data.total === 'number'
            ? data.total
            : null;
    if (reported != null) total = reported;

    items.push(...chunk);

    if (chunk.length === 0) break;
    if (total != null && items.length >= total) break;
    if (chunk.length < pageSize) break;
    if (items.length >= maxRows) {
      return summarize(items, total, pages, true);
    }
  }

  return summarize(items, total, pages, false);
}

function summarize(items, total, pages, capped) {
  const effectiveTotal = total != null ? total : items.length;
  const truncated = capped || (total != null && items.length < total);
  return {
    items,
    total: effectiveTotal,
    fetched: items.length,
    truncated,
    capped: !!capped,
    pages,
    warning: truncated
      ? `Loaded ${items.length.toLocaleString()} of ${effectiveTotal.toLocaleString()} rows` +
        (capped ? ' (safety cap reached)' : '') +
        ' — totals may be incomplete.'
      : null,
  };
}

function truncationMessage(parts) {
  const msgs = (parts || []).filter(Boolean);
  if (!msgs.length) return null;
  return msgs.join(' ');
}

module.exports = {
  fetchAllPages,
  truncationMessage,
  summarize,
};

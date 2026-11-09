'use strict';

/**
 * All Data helpers for UHC advance recoup (UAD) filtering.
 *
 * UAD lines live on uad_activity (often commission = 0). The Dashboard KPI
 * counts payment rows; All Data "By client" collapses the same people across
 * months (e.g. Sept 7 + Oct 2 Cheung/Willsromero → 7 clients, 9 payments).
 */

const { UAD_CLASSIFICATION } = require('./uhcUad');

function wantsUadPaymentsView(filters = {}) {
  if (filters.amountSign === 'uad') return true;
  if (filters.classification === UAD_CLASSIFICATION) return true;
  const classes = filters.classifications;
  if (Array.isArray(classes) && classes.includes(UAD_CLASSIFICATION)) return true;
  return false;
}

/** Default All Data list mode for a deep-link / drill-down. */
function initialListModeForFilters(filters = {}) {
  return wantsUadPaymentsView(filters) ? 'payments' : 'clients';
}

/** SQL predicate used by GET /records?amountSign=uad (and by-client). */
function uadAmountSignSql(alias = 'cr') {
  const col = alias ? `${alias}.uad_activity` : 'uad_activity';
  return `COALESCE(${col}, 0) <> 0`;
}

module.exports = {
  wantsUadPaymentsView,
  initialListModeForFilters,
  uadAmountSignSql,
  UAD_CLASSIFICATION,
};

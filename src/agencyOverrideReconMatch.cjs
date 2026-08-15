'use strict';

/**
 * CJS bridge for Node (routes, Jest). Keep in sync with agencyOverrideReconMatch.js.
 */
const { normName, normalizeCarrier, carriersMatch, namesLooseMatch } = require('./matchingNormalize.cjs');

function findOverrideMatch(production, overrides) {
  const prodClient = production.client_name;
  const prodClientNorm = normName(prodClient);
  const prodCarrier = normalizeCarrier(production.carrier);
  if (!prodClientNorm || !prodCarrier) return null;

  const matches = [];
  for (const override of overrides || []) {
    const overrideClient = override.client_full_name;
    const overrideClientNorm = normName(overrideClient);
    const overrideCarrier = normalizeCarrier(override.carrier);
    const clientMatch =
      prodClientNorm === overrideClientNorm || namesLooseMatch(prodClient, overrideClient);
    if (!clientMatch) continue;
    if (!carriersMatch(prodCarrier, overrideCarrier)) continue;
    matches.push(override);
  }

  if (!matches.length) return null;

  const override_net =
    Math.round(matches.reduce((sum, m) => sum + (parseFloat(m.commission) || 0), 0) * 100) / 100;
  const hasChargeback = matches.some((m) => (parseFloat(m.commission) || 0) < 0);

  return {
    ...matches[0],
    commission: override_net,
    commission_amount: override_net,
    allMatches: matches,
    matchCount: matches.length,
    override_net,
    hasChargeback,
  };
}

function isOverridePaid(overrideMatch) {
  if (!overrideMatch) return false;
  const net =
    overrideMatch.override_net != null
      ? parseFloat(overrideMatch.override_net)
      : parseFloat(overrideMatch.commission || overrideMatch.commission_amount || 0);
  return net > 0;
}

function isAetnaActivePolicy(row) {
  const str = (v) => String(v == null ? '' : v);
  const enrollStatus = str(row.Enroll_Status || row.enroll_status || row.status).trim().toUpperCase();
  const exitStatus = str(row.Exit_Status || row.exit_status).trim().toUpperCase();
  const termStatus = str(row.Term_Status || row.term_status).trim().toUpperCase();

  // Current enroll wins over stale exit/term from a prior leave (returnees).
  if (enrollStatus.includes('CANCEL')) return false;
  if (enrollStatus.includes('ACTIVE') || enrollStatus.includes('FUTURE')) return true;
  if (exitStatus.includes('VOLUNTARY') || exitStatus.includes('CANCEL')) return false;
  if (termStatus.includes('VOLUNTARY') || termStatus.includes('CANCEL')) return false;
  return false;
}

module.exports = {
  findOverrideMatch,
  isOverridePaid,
  isAetnaActivePolicy,
};

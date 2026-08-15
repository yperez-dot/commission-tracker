import { normName, normalizeCarrier, carriersMatch, namesLooseMatch } from './matchingNormalize';

/**
 * Match agency production → BSI→THEI override commission rows.
 * Nets ALL matching rows for client+carrier so +$80 override and −$80
 * chargeback → override_net 0 → Missing (not falsely Paid).
 */
export function findOverrideMatch(production, overrides) {
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

/** Paid only when net override dollars remain after chargebacks. */
export function isOverridePaid(overrideMatch) {
  if (!overrideMatch) return false;
  const net =
    overrideMatch.override_net != null
      ? parseFloat(overrideMatch.override_net)
      : parseFloat(overrideMatch.commission || overrideMatch.commission_amount || 0);
  return net > 0;
}

function wrapSingleOverride(row) {
  const amt = Math.round((parseFloat(row.commission) || 0) * 100) / 100;
  return {
    ...row,
    commission: amt,
    commission_amount: amt,
    allMatches: [row],
    matchCount: 1,
    override_net: amt,
    hasChargeback: amt < 0,
  };
}

/**
 * Expand one production row into lifecycle history rows so recon buckets
 * show the full story: Paid (+override), Cancelled (chargeback/left),
 * and Missing again when she returns with no open override.
 */
export function expandOverrideLifecycle(production, overrides) {
  const prodId = production?.id != null ? String(production.id) : 'unknown';
  const bundled = findOverrideMatch(production, overrides);

  if (!bundled) {
    return [
      {
        production,
        override: null,
        lifecycle: 'missing',
        categoryHint: 'missing',
        rowKey: `prod-${prodId}-missing`,
        isHistory: false,
      },
    ];
  }

  const rows = [];
  const all = bundled.allMatches || [];

  all.forEach((row, idx) => {
    const amt = parseFloat(row.commission) || 0;
    const idPart = row.id != null ? String(row.id) : String(idx);
    if (amt > 0) {
      rows.push({
        production,
        override: wrapSingleOverride(row),
        lifecycle: 'paid',
        categoryHint: 'paid',
        rowKey: `prod-${prodId}-paid-${idPart}`,
        isHistory: true,
      });
    } else if (amt < 0) {
      rows.push({
        production,
        override: wrapSingleOverride(row),
        lifecycle: 'chargeback',
        categoryHint: 'cancelled',
        rowKey: `prod-${prodId}-chargeback-${idPart}`,
        isHistory: true,
      });
    }
  });

  // Return / clawed-back: still in production but no open paid override.
  if (!isOverridePaid(bundled)) {
    rows.push({
      production,
      override: bundled,
      lifecycle: 'missing',
      categoryHint: 'missing',
      rowKey: `prod-${prodId}-missing`,
      isHistory: false,
    });
  }

  return rows;
}

/**
 * Aetna returnee-safe active check.
 * If Enroll_Status is Active / Future Active, keep even when Exit/Term still
 * says Voluntary from a prior disenrollment (client came back to the plan).
 */
export function isAetnaActivePolicy(row) {
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

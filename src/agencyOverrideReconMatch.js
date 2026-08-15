import { normName, normalizeCarrier, carriersMatch, namesLooseMatch } from './matchingNormalize';

/** Token-sorted client key (same idea as clientNameKey). */
function saleClientKey(name) {
  if (!name) return '';
  const noAccents = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return noAccents
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .sort()
    .join('|');
}

/**
 * Identity of one sale across rolling 90-day production uploads.
 * Same client + carrier + eff date + policy = same sale (not a new enrollment).
 */
export function productionSaleKey(prod) {
  const client = saleClientKey(prod?.client_name);
  const carrier = normalizeCarrier(prod?.carrier);
  const eff = String(prod?.effective_date || '').slice(0, 10);
  const policy = String(prod?.policy_number || prod?.policy_number_production || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return `${client}|${carrier}|${eff}|${policy}`;
}

function productionRecency(prod) {
  const t = Date.parse(prod?.upload_date || prod?.uploaded_at || '') || 0;
  const id = Number(prod?.id) || 0;
  return t * 1e6 + id;
}

/**
 * Collapse rolling production duplicates to one row per true sale.
 * Keeps the newest upload when the same sale repeats across batches.
 */
export function dedupeProductionSales(rows) {
  const map = new Map();
  for (const p of rows || []) {
    const key = productionSaleKey(p);
    const [client, carrier] = key.split('|');
    if (!client || !carrier) continue;
    const prev = map.get(key);
    if (!prev || productionRecency(p) >= productionRecency(prev)) {
      map.set(key, p);
    }
  }
  return [...map.values()];
}

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

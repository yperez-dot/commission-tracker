'use strict';

/**
 * CJS bridge for Node (routes, Jest). Keep in sync with agencyOverrideReconMatch.js.
 */
const { normName, normalizeCarrier, carriersMatch, namesLooseMatch } = require('./matchingNormalize.cjs');

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

function productionSaleKey(prod) {
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

function dedupeProductionSales(rows) {
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

function expandOverrideLifecycle(production, overrides) {
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

function isAetnaActivePolicy(row) {
  const str = (v) => String(v == null ? '' : v);
  const enrollStatus = str(row.Enroll_Status || row.enroll_status || row.status).trim().toUpperCase();
  const exitStatus = str(row.Exit_Status || row.exit_status).trim().toUpperCase();
  const termStatus = str(row.Term_Status || row.term_status).trim().toUpperCase();

  if (enrollStatus.includes('CANCEL')) return false;
  if (enrollStatus.includes('ACTIVE') || enrollStatus.includes('FUTURE')) return true;
  if (exitStatus.includes('VOLUNTARY') || exitStatus.includes('CANCEL')) return false;
  if (termStatus.includes('VOLUNTARY') || termStatus.includes('CANCEL')) return false;
  return false;
}

module.exports = {
  findOverrideMatch,
  isOverridePaid,
  expandOverrideLifecycle,
  isAetnaActivePolicy,
  productionSaleKey,
  dedupeProductionSales,
};

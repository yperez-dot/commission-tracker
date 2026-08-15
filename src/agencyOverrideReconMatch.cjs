'use strict';

/** CJS bridge — keep in sync with agencyOverrideReconMatch.js */
const { normName, normalizeCarrier, carriersMatch, namesLooseMatch } = require('./matchingNormalize.cjs');

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

/**
 * Collapse rolling production duplicates to one row per true sale.
 * Keeps the newest upload when the same sale repeats across batches.
 */
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

/**
 * BSI→THEI override / chargeback rows only.
 * Do NOT include every payee=THE commission line — that exploded lifecycle
 * history into thousands of rows and crashed Agency Override Recon.
 */
function isOverrideStatementRow(row) {
  const c = String(row?.classification || '').toLowerCase();
  if (!c) return false;
  if (c.includes('chargeback')) return true;
  if (c.includes('agency override')) return true;
  // bare "Override" / "override commission" — not Agent Commission
  if (c.includes('override') && !c.includes('agent')) return true;
  return false;
}

/**
 * Match agency production → BSI→THEI override commission rows.
 * Nets ALL matching rows for client+carrier so +$80 override and −$80
 * chargeback → override_net 0 → Missing (not falsely Paid).
 */
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

/** Paid only when net override dollars remain after chargebacks. */
function isOverridePaid(overrideMatch) {
  if (!overrideMatch) return false;
  const net =
    overrideMatch.override_net != null
      ? parseFloat(overrideMatch.override_net)
      : parseFloat(overrideMatch.commission || overrideMatch.commission_amount || 0);
  return net > 0;
}

function isLicensingHoldRecord(record) {
  if (!record || record.classification !== 'Held') return false;
  try {
    const rd =
      typeof record.raw_data === 'string' ? JSON.parse(record.raw_data) : record.raw_data || {};
    const reason = String(rd['Hold Reason'] || '').toLowerCase();
    return reason.includes('not licensed') || reason.includes('not appointed');
  } catch {
    return false;
  }
}

/**
 * Three-way status for Hector production → Carrier→BSI → BSI→THEI.
 *
 *   not_paid_to_bsi — on Hector, carrier BSI file uploaded, sale NOT on it
 *                     (carrier never paid BSI → don't chase remittance yet)
 *   chase_bsi       — on Hector AND on Carrier→BSI with $, but THEI not paid
 *   pending         — carrier BSI statement not uploaded yet for this carrier
 */
function getThreeWayOverrideStatus(m) {
  if (!m) return 'pending';
  if (m.lifecycle === 'paid') return 'paid';
  if (m.lifecycle === 'chargeback') return 'chargeback';
  if (m.production?.manual_override_status) return m.production.manual_override_status;
  if (isOverridePaid(m.override)) return 'paid';

  const prodStatus = String(m.production?.status || '')
    .toUpperCase()
    .trim();
  if (['WITHDRAWN', 'IN PROGRESS', 'CANCELLED', 'DENIED'].includes(prodStatus)) {
    return 'no_pay_expected';
  }

  const carrierAmt = m.carrierBSI ? parseFloat(m.carrierBSI.commission || 0) : null;
  if (m.carrierBSI && carrierAmt > 0 && !isOverridePaid(m.override)) return 'chase_bsi';
  if (m.carrierBSI && carrierAmt === 0) {
    if (isLicensingHoldRecord(m.carrierBSI)) return 'held_licensing';
    return 'request_audit';
  }
  if (!m.carrierBSI && m.heldRecord && isLicensingHoldRecord(m.heldRecord)) {
    return 'held_licensing';
  }
  if (!m.carrierBSI && m.carrierUploaded) return 'not_paid_to_bsi';
  return 'pending';
}

/**
 * Tab bucket for Agency Override Recon.
 * Auto chase_bsi / not_paid_to_bsi must not all dump into Missing.
 */
function getOverrideReconCategory(m) {
  if (!m) return 'missing';
  const manual = m.production?.manual_override_status || null;
  if (manual === 'no_pay_expected') return 'cancelled';
  if (manual === 'paid') return 'paid';
  if (manual === 'chase_bsi') return 'chase';
  if (manual === 'not_paid_to_bsi') return 'not_on_bsi';

  if (m.lifecycle === 'chargeback' || m.categoryHint === 'cancelled') return 'cancelled';
  if (m.lifecycle === 'paid' || m.categoryHint === 'paid') return 'paid';
  if (m.categoryHint && m.categoryHint !== 'missing') return m.categoryHint;

  if (isOverridePaid(m.override)) return 'paid';

  const prodStatus = String(m.production?.status || '')
    .toUpperCase()
    .trim();
  if (['WITHDRAWN', 'IN PROGRESS', 'CANCELLED', 'DENIED'].includes(prodStatus)) {
    return 'cancelled';
  }

  const status = String(m.production?.status || '').toLowerCase();
  if (status.includes('plan denied') || status.includes('plan_denied') || status.includes('denied')) {
    return 'plandenied';
  }
  if (status.includes('plan change') || status.includes('plan_change')) return 'planchange';
  if (status.includes('cancel') || status.includes('terminated')) return 'cancelled';
  if (status.includes('chase') || status.includes('chasing')) return 'chase';

  const tw = getThreeWayOverrideStatus(m);
  if (tw === 'chase_bsi') return 'chase';
  if (tw === 'not_paid_to_bsi') return 'not_on_bsi';
  return 'missing';
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
function expandOverrideLifecycle(production, overrides) {
  const prodId = production?.id != null ? String(production.id) : 'unknown';
  // Never expand agent NB/renewal lines into history — override/chargeback only.
  const overrideOnly = (overrides || []).filter(isOverrideStatementRow);
  const bundled = findOverrideMatch(production, overrideOnly);

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
  expandOverrideLifecycle,
  isAetnaActivePolicy,
  productionSaleKey,
  dedupeProductionSales,
  isOverrideStatementRow,
  getThreeWayOverrideStatus,
  getOverrideReconCategory,
};

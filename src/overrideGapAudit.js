'use strict';

/**
 * Audit agency production vs BSI→THEI overrides for gaps like Milagros:
 * paid override → chargeback → still in production with no open override.
 */

const { clientNameKey } = require('./clientNameKey');
const {
  findOverrideMatch,
  isOverridePaid,
} = require('./agencyOverrideReconMatch.cjs');
const { normalizeCarrier } = require('./matchingNormalize.cjs');

function isOverrideLikeRow(row) {
  const classification = String(row.classification || '').toLowerCase();
  const payee = String(row.payee || '').toUpperCase();
  const source = String(row.source || '').toUpperCase();
  return (
    classification.includes('agency override') ||
    classification.includes('override') ||
    classification.includes('chargeback') ||
    payee === 'BSI' ||
    payee === 'NHP' ||
    payee === 'THE' ||
    source === 'BSI' ||
    source === 'NHP'
  );
}

function sumBySign(rows) {
  let paid = 0;
  let chargeback = 0;
  let paidCount = 0;
  let chargebackCount = 0;
  for (const row of rows || []) {
    const amt = parseFloat(row.commission) || 0;
    if (amt > 0) {
      paid += amt;
      paidCount += 1;
    } else if (amt < 0) {
      chargeback += amt;
      chargebackCount += 1;
    }
  }
  return {
    paid: Math.round(paid * 100) / 100,
    chargeback: Math.round(chargeback * 100) / 100,
    paidCount,
    chargebackCount,
  };
}

/**
 * @param {Array} production agency_production rows
 * @param {Array} overrideRows commission rows (non-BSI statement preferred)
 * @returns {{ summary: object, gaps: Array }}
 */
function auditOverrideGaps(production, overrideRows) {
  const overrides = (overrideRows || []).filter(isOverrideLikeRow);
  const seen = new Set();
  const gaps = [];

  for (const prod of production || []) {
    const nameKey = clientNameKey(prod.client_name);
    const carrierKey = normalizeCarrier(prod.carrier);
    if (!nameKey || !carrierKey) continue;

    const dedupeKey = `${nameKey}|${carrierKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const match = findOverrideMatch(prod, overrides);
    const all = match?.allMatches || [];
    const sums = sumBySign(all);
    const net = match ? match.override_net : null;

    let gapType = null;
    let reason = null;

    if (!match) {
      gapType = 'never_paid';
      reason = 'In production; no BSI→THEI override or chargeback found';
    } else if (sums.paidCount > 0 && sums.chargebackCount > 0 && !isOverridePaid(match)) {
      gapType = 'returnee_clawback';
      reason =
        'Had override paid, then chargeback (left); still in production with no open override — like Milagros';
    } else if (sums.paidCount === 0 && sums.chargebackCount > 0) {
      gapType = 'chargeback_only';
      reason = 'In production but only chargebacks found (no positive override)';
    } else if (!isOverridePaid(match)) {
      gapType = 'net_zero';
      reason = 'Override rows net to $0 with no open paid balance';
    } else {
      continue; // currently paid — not a gap
    }

    gaps.push({
      gap_type: gapType,
      reason,
      client_name: prod.client_name,
      agent_name: prod.agent_name || null,
      carrier: prod.carrier || null,
      effective_date: prod.effective_date || null,
      status: prod.status || null,
      policy_number: prod.policy_number || null,
      production_id: prod.id || null,
      upload_batch: prod.upload_batch || null,
      override_net: net,
      paid_total: sums.paid,
      chargeback_total: sums.chargeback,
      paid_count: sums.paidCount,
      chargeback_count: sums.chargebackCount,
      match_count: all.length,
    });
  }

  const summary = {
    production_clients: seen.size,
    override_rows_scanned: overrides.length,
    gap_total: gaps.length,
    returnee_clawback: gaps.filter((g) => g.gap_type === 'returnee_clawback').length,
    never_paid: gaps.filter((g) => g.gap_type === 'never_paid').length,
    chargeback_only: gaps.filter((g) => g.gap_type === 'chargeback_only').length,
    net_zero: gaps.filter((g) => g.gap_type === 'net_zero').length,
  };

  const rank = {
    returnee_clawback: 0,
    chargeback_only: 1,
    net_zero: 2,
    never_paid: 3,
  };
  gaps.sort((a, b) => {
    const ra = rank[a.gap_type] ?? 9;
    const rb = rank[b.gap_type] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(a.client_name || '').localeCompare(String(b.client_name || ''));
  });

  return { summary, gaps };
}

module.exports = {
  auditOverrideGaps,
  isOverrideLikeRow,
  sumBySign,
};

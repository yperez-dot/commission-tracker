'use strict';

/**
 * THEI vs BSI Devoted classification rules (manual audit / overpay guard).
 *
 * - THEI Devoted principal statements (THEI_DEVOTED_…): carrier Transaction Type
 *   often says "Override" but the dollars are agent production → Agent Commission.
 * - Devoted/Humana BSI statement feeds (DEVOTED_BSI_…): those dollars are the
 *   house override pot split with BSI → Agency Override (never New Business).
 *   Mistagging them as New Business sets producer_payable and overpays agents.
 */

function classifyTHECarrierTransaction({ transactionType, commission, carrier } = {}) {
  const amount = parseFloat(commission) || 0;
  const typeLower = String(transactionType || '').toLowerCase();
  const carrierLower = String(carrier || '').toLowerCase();
  const isDevoted = carrierLower.includes('devoted');

  if (amount < 0) return 'Chargeback';
  if (typeLower.includes('new business')) return 'New Business';
  if (typeLower.includes('renewal')) return 'Renewal';
  if (typeLower.includes('override')) {
    return isDevoted ? 'Agent Commission' : 'Agency Override';
  }
  return 'Agent Commission';
}

/** Humana/Devoted carrier→BSI feeds: always Agency Override (except chargebacks). */
function classifyHumanaDevotedBSITransaction({ commission } = {}) {
  const amount = parseFloat(commission) || 0;
  if (amount < 0) return 'Chargeback';
  return 'Agency Override';
}

/**
 * THEI Devoted principal rows mistagged Agency Override → Agent Commission.
 * Skips BSI Devoted feeds.
 */
async function backfillDevotedAgentCommission(pool) {
  const result = await pool.query(`
    UPDATE commission_records cr
    SET classification = 'Agent Commission',
        producer_payable = COALESCE(cr.commission, 0),
        thei_share = 0,
        bsi_share = 0,
        gross_commission = COALESCE(cr.commission, 0)
    FROM uploads u
    WHERE cr.upload_id = u.id
      AND cr.classification = 'Agency Override'
      AND LOWER(COALESCE(cr.carrier, '')) LIKE '%devoted%'
      AND COALESCE(u.category, 'commission_statement') <> 'bsi_statement'
      AND UPPER(COALESCE(cr.source, '')) NOT IN ('BSI', 'BSI_PAYEE')
      AND LOWER(REPLACE(COALESCE(u.original_name, ''), ' ', '_')) NOT LIKE '%devoted_bsi%'
      AND LOWER(REPLACE(COALESCE(u.original_name, ''), ' ', '_')) NOT LIKE '%humana_bsi%'
  `);
  return result.rowCount || 0;
}

/**
 * BSI Devoted (and Humana BSI) rows mistagged New Business/Renewal/Agent Commission
 * → Agency Override with 50/50 THEI/BSI and zero producer pay (stops overpay).
 */
async function backfillDevotedBsiToOverride(pool) {
  const result = await pool.query(`
    UPDATE commission_records cr
    SET classification = 'Agency Override',
        gross_commission = COALESCE(cr.commission, 0),
        thei_share = ROUND(COALESCE(cr.commission, 0) * 0.5, 2),
        bsi_share = ROUND(COALESCE(cr.commission, 0) * 0.5, 2),
        producer_payable = 0
    FROM uploads u
    WHERE cr.upload_id = u.id
      AND cr.classification IN ('New Business', 'Renewal', 'Agent Commission')
      AND COALESCE(cr.commission, 0) >= 0
      AND (
        u.category = 'bsi_statement'
        OR UPPER(COALESCE(cr.source, '')) IN ('BSI', 'BSI_PAYEE')
        OR LOWER(REPLACE(COALESCE(u.original_name, ''), ' ', '_')) LIKE '%devoted_bsi%'
        OR LOWER(REPLACE(COALESCE(u.original_name, ''), ' ', '_')) LIKE '%humana_bsi%'
      )
      AND (
        LOWER(COALESCE(cr.carrier, '')) LIKE '%devoted%'
        OR LOWER(COALESCE(cr.carrier, '')) LIKE '%humana%'
        OR LOWER(REPLACE(COALESCE(u.original_name, ''), ' ', '_')) LIKE '%devoted_bsi%'
        OR LOWER(REPLACE(COALESCE(u.original_name, ''), ' ', '_')) LIKE '%humana_bsi%'
      )
  `);
  return result.rowCount || 0;
}

/** Run both Devoted overpay guards (safe to call on upload list / house preview). */
async function backfillDevotedCommissionGuards(pool) {
  const agentFixed = await backfillDevotedAgentCommission(pool);
  const bsiFixed = await backfillDevotedBsiToOverride(pool);
  return { agentFixed, bsiFixed, total: agentFixed + bsiFixed };
}

module.exports = {
  classifyTHECarrierTransaction,
  classifyHumanaDevotedBSITransaction,
  backfillDevotedAgentCommission,
  backfillDevotedBsiToOverride,
  backfillDevotedCommissionGuards,
};

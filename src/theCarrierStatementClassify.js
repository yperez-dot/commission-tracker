'use strict';

/**
 * Classification for THEI carrier statements (Humana / Devoted CSV title-block exports).
 *
 * Devoted Transaction Type often says "Override" for normal agent production
 * (e.g. CMS FMV initial). In OliComm that must be Agent Commission (producer
 * payable), not Agency Override (house / BSI split).
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

/**
 * Reclassify existing THEI Devoted principal rows mistagged as Agency Override.
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
  `);
  return result.rowCount || 0;
}

module.exports = {
  classifyTHECarrierTransaction,
  backfillDevotedAgentCommission,
};

'use strict';

/**
 * Persist THEI/BSI shares on Agency Override rows that already landed with
 * commission dollars and zero shares (BSI Humana/Devoted statement uploads).
 *
 * House Statements can resolve the same math at read time; this writes it so
 * All Data / exports / later previews stay consistent without a re-upload.
 */

const { computeBsiOverrideShareUpdates } = require('./overrideSplitMath');

async function backfillBsiOverrideMissingShares(pool, period) {
  const params = [];
  let periodClause = '';
  if (period && period !== 'all') {
    params.push(period);
    periodClause = `AND cr.payment_period = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT cr.id, cr.agent_name, cr.payment_period, cr.policy_number, cr.commission
     FROM commission_records cr
     WHERE cr.classification ILIKE '%override%'
       AND UPPER(COALESCE(cr.source, '')) IN ('BSI', 'BSI_PAYEE')
       AND COALESCE(cr.thei_share, 0) = 0
       AND COALESCE(cr.bsi_share, 0) = 0
       AND COALESCE(cr.commission, 0) <> 0
       ${periodClause}
     ORDER BY cr.payment_period, cr.id`,
    params
  );
  if (!result.rows.length) return 0;

  const already = await pool.query(`
    SELECT DISTINCT policy_number
    FROM commission_records
    WHERE classification ILIKE '%override%'
      AND COALESCE(sub_agent_override, 0) <> 0
  `);
  const deducted = new Set(already.rows.map((r) => r.policy_number));
  const updates = computeBsiOverrideShareUpdates(result.rows, deducted);

  let n = 0;
  for (const u of updates) {
    const q = await pool.query(
      `UPDATE commission_records
       SET gross_commission = COALESCE(NULLIF(gross_commission, 0), $2),
           thei_share = $3,
           bsi_share = $4,
           producer_payable = CASE
             WHEN COALESCE(producer_payable, 0) <> 0 THEN producer_payable
             ELSE $5
           END,
           sub_agent_override = CASE
             WHEN COALESCE(sub_agent_override, 0) <> 0 THEN sub_agent_override
             ELSE $6
           END,
           split_applies = $7
       WHERE id = $1
         AND COALESCE(thei_share, 0) = 0
         AND COALESCE(bsi_share, 0) = 0`,
      [
        u.id,
        u.grossCommission,
        u.theiShare,
        u.bsiShare,
        u.producerPayable,
        u.subAgentOverride,
        u.splitApplies,
      ]
    );
    n += q.rowCount || 0;
  }
  return n;
}

module.exports = {
  backfillBsiOverrideMissingShares,
};

'use strict';

/**
 * Idempotent correction for one UHC split new-sale (Comp Type R part + Comp Type I part)
 * that was peeled as two separate Lina lines.
 *
 * Targeted at a single policy. Yahoska approved correcting the 05.2026 installment so it
 * is not a separate Renewal peel; the June Comp Type I part then holds the rest of Lina's
 * $694 with the $150 house override taken once.
 *
 * Run on deploy (see scripts/correct-uhc-split-sale-policy.js). Touch no other rows.
 */

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const close = (a, b) => Math.abs(round2(a) - round2(b)) < 0.015;

const TARGET_POLICY = '951906631';

const PARTS = Object.freeze([
  {
    period: '202605',
    commission: 294.59,
    from: { producer: 219.59, thei: 37.5, bsi: 37.5 },
    to: { producer: 144.59, thei: 75, bsi: 75 },
    note: 'UHC split new-sale part 1 — Initial override $150 taken on this installment',
  },
  {
    period: '202606',
    commission: 549.41,
    from: { producer: 399.41, thei: 75, bsi: 75 },
    to: { producer: 549.41, thei: 0, bsi: 0 },
    note: 'UHC split new-sale part 2 — remaining house override $0 (taken on the earlier installment)',
  },
]);

function numField(row, camel, snake) {
  const v = row[camel] != null ? row[camel] : row[snake];
  return round2(v);
}

function matchSplit(row, expected) {
  return (
    close(numField(row, 'producerPayable', 'producer_payable'), expected.producer) &&
    close(numField(row, 'theiShare', 'thei_share'), expected.thei) &&
    close(numField(row, 'bsiShare', 'bsi_share'), expected.bsi)
  );
}

function planUhcSplitSaleCorrection(rows, opts = {}) {
  const policy = String(opts.policyNumber || TARGET_POLICY).trim().toLowerCase();
  const updates = [];
  for (const spec of PARTS) {
    for (const row of rows || []) {
      const pol = String(row.policy_number || row.policyNumber || '').trim().toLowerCase();
      if (pol !== policy) continue;
      if (String(row.payment_period || row.period || '') !== spec.period) continue;
      if (!close(row.commission, spec.commission)) continue;
      if (matchSplit(row, spec.to)) continue;
      // Apply `to` whenever this policy+period+commission row is not already there.
      // Requiring the exact historical `from` split skipped the June installment in
      // production (found=2 planned=1) when that row was unsplit or house-split.
      updates.push({
        id: row.id,
        policy,
        period: spec.period,
        commission: spec.commission,
        before: {
          producer: numField(row, 'producerPayable', 'producer_payable'),
          thei: numField(row, 'theiShare', 'thei_share'),
          bsi: numField(row, 'bsiShare', 'bsi_share'),
        },
        after: spec.to,
        kind: 'uhc_split_sale_part',
        mga: spec.note,
      });
    }
  }
  return { policy, updates };
}

async function applyUhcSplitSaleCorrection(pool, opts = {}) {
  const policy = String(opts.policyNumber || TARGET_POLICY).trim();
  const r = await pool.query(
    `SELECT id, policy_number, payment_period, commission, producer_payable, thei_share, bsi_share, mga
     FROM commission_records
     WHERE LOWER(TRIM(COALESCE(policy_number, ''))) = LOWER($1)
       AND payment_period = ANY($2::text[])`,
    [policy, PARTS.map((p) => p.period)]
  );
  const { updates } = planUhcSplitSaleCorrection(r.rows, { policyNumber: policy });
  let applied = 0;
  for (const u of updates) {
    await pool.query(
      `UPDATE commission_records
       SET producer_payable = $1, thei_share = $2, bsi_share = $3,
           mga = CASE
             WHEN mga IS NULL OR TRIM(mga) = '' THEN $4
             WHEN mga ILIKE '%' || $4 || '%' THEN mga
             ELSE mga || ' | ' || $4
           END
       WHERE id = $5
         AND LOWER(TRIM(COALESCE(policy_number, ''))) = LOWER($6)`,
      [u.after.producer, u.after.thei, u.after.bsi, u.mga, u.id, policy]
    );
    applied += 1;
  }
  return { policy, found: r.rows.length, planned: updates.length, applied };
}

module.exports = {
  TARGET_POLICY,
  PARTS,
  planUhcSplitSaleCorrection,
  applyUhcSplitSaleCorrection,
};

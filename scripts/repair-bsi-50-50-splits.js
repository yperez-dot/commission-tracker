#!/usr/bin/env node
'use strict';

/**
 * Repair BSI Agency Override rows that were mis-split as 100% THEI / 0% BSI.
 *
 * Root cause: determinePayee() did not normalize spaces in filenames, so
 * "Statement-health experts.pdf" was treated as direct_carrier instead of BSI.
 *
 * Default: dry-run. Pass --apply to write.
 *
 * Usage:
 *   node scripts/repair-bsi-50-50-splits.js
 *   node scripts/repair-bsi-50-50-splits.js --apply
 *   node scripts/repair-bsi-50-50-splits.js --apply --period=202601
 */

const { Pool } = require('pg');
const { splitFullOverridePot } = require('../src/overrideSplitMath');

const APPLY = process.argv.includes('--apply');
const periodArg = process.argv.find((a) => a.startsWith('--period='));
const PERIOD = periodArg ? periodArg.split('=')[1] : null;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://postgres:HzFAKESECRET_a3b4c5d6e7f8g9h0i1j2@caboose.proxy.rlwy.net:21534/railway',
  ssl: process.env.DATABASE_URL ? undefined : { rejectUnauthorized: false },
});

async function main() {
  const params = [];
  let where = `
    WHERE LOWER(TRIM(COALESCE(classification,''))) LIKE '%override%'
      AND UPPER(TRIM(COALESCE(payee,''))) = 'BSI'
      AND (
        (COALESCE(source,'') IN ('direct_carrier','manual','') AND COALESCE(bsi_share,0) = 0 AND ABS(COALESCE(thei_share,0) - COALESCE(commission,0)) < 0.02)
        OR (COALESCE(source,'') = 'direct_carrier' AND COALESCE(bsi_share,0) = 0 AND COALESCE(thei_share,0) <> 0)
      )
  `;
  if (PERIOD) {
    params.push(PERIOD);
    where += ` AND payment_period = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    SELECT id, agent_name, policy_number, payment_period, commission, thei_share, bsi_share,
           producer_payable, sub_agent_override, gross_commission, source, payee, carrier
    FROM commission_records
    ${where}
    ORDER BY payment_period ASC NULLS LAST, policy_number, id
    `,
    params
  );

  console.log(`Found ${rows.length} candidate rows${PERIOD ? ` for period ${PERIOD}` : ''}.`);
  console.log(APPLY ? 'APPLY mode — writing updates.' : 'DRY-RUN — no writes.');

  const deducted = new Set();
  // Prefer policies already carrying a Marco $10 so we don't double-deduct.
  const existingMarco = await pool.query(`
    SELECT DISTINCT policy_number FROM commission_records
    WHERE classification = 'Agency Override' AND COALESCE(sub_agent_override,0) <> 0
  `);
  for (const r of existingMarco.rows) deducted.add(r.policy_number);

  let updated = 0;
  let sumTheiBefore = 0;
  let sumBsiBefore = 0;
  let sumTheiAfter = 0;
  let sumBsiAfter = 0;
  let sumMarcoAfter = 0;

  for (const row of rows) {
    sumTheiBefore += parseFloat(row.thei_share) || 0;
    sumBsiBefore += parseFloat(row.bsi_share) || 0;

    const already = deducted.has(row.policy_number);
    const split = splitFullOverridePot(row.commission, {
      agentName: row.agent_name,
      paymentPeriod: row.payment_period,
      alreadyDeducted: already,
    });
    if (split.subAgentOverride) deducted.add(row.policy_number);

    sumTheiAfter += split.theiShare;
    sumBsiAfter += split.bsiShare;
    sumMarcoAfter += split.subAgentOverride;

    if (APPLY) {
      await pool.query(
        `UPDATE commission_records
            SET source = 'BSI',
                gross_commission = $1,
                thei_share = $2,
                bsi_share = $3,
                producer_payable = $4,
                sub_agent_override = $5,
                split_applies = $6
          WHERE id = $7`,
        [
          split.grossCommission,
          split.theiShare,
          split.bsiShare,
          split.producerPayable,
          split.subAgentOverride,
          split.splitApplies,
          row.id,
        ]
      );
    }
    updated++;
  }

  console.log(
    JSON.stringify(
      {
        candidates: rows.length,
        updated,
        applied: APPLY,
        before: {
          thei: Math.round(sumTheiBefore * 100) / 100,
          bsi: Math.round(sumBsiBefore * 100) / 100,
        },
        after: {
          thei: Math.round(sumTheiAfter * 100) / 100,
          bsi: Math.round(sumBsiAfter * 100) / 100,
          marco: Math.round(sumMarcoAfter * 100) / 100,
        },
      },
      null,
      2
    )
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

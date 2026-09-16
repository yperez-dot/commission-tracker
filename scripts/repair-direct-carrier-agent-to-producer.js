#!/usr/bin/env node
'use strict';
/**
 * Move misbooked agent production off Agency THEI Share onto producer_payable.
 *
 * Target rows (default):
 *   source = 'direct_carrier'
 *   classification IN (Renewal, New Business, Chargeback, Agent Comp, Agent Commission, ...)
 *   NOT Agency Override
 *   thei_share <> 0
 *
 * Action:
 *   producer_payable = thei_share + producer_payable (usually producer was 0)
 *   thei_share = 0
 *   bsi_share = 0
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   node scripts/repair-direct-carrier-agent-to-producer.js
 *   node scripts/repair-direct-carrier-agent-to-producer.js --apply
 *   node scripts/repair-direct-carrier-agent-to-producer.js --apply --period=202601
 */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const periodArg = process.argv.find((a) => a.startsWith('--period='));
const PERIOD = periodArg ? periodArg.split('=')[1] : null;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const AGENT_CLASS_SQL = `
  (
    LOWER(TRIM(COALESCE(classification,''))) IN (
      'renewal', 'new business', 'chargeback', 'agent commission', 'agent comp', 'commission'
    )
    OR LOWER(TRIM(COALESCE(classification,''))) LIKE '%agent commission%'
  )
  AND LOWER(TRIM(COALESCE(classification,''))) NOT LIKE '%override%'
`;

async function main() {
  const params = [];
  let where = `
    WHERE LOWER(TRIM(COALESCE(source,''))) = 'direct_carrier'
      AND ${AGENT_CLASS_SQL}
      AND COALESCE(thei_share, 0) <> 0
  `;
  if (PERIOD) {
    params.push(PERIOD);
    where += ` AND payment_period = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    SELECT id, agent_name, carrier, classification, payment_period, policy_number,
           commission, thei_share, bsi_share, producer_payable, source, payee
    FROM commission_records
    ${where}
    ORDER BY payment_period NULLS LAST, carrier, id
    `,
    params
  );

  let sumThei = 0;
  let sumProducerBefore = 0;
  for (const r of rows) {
    sumThei += parseFloat(r.thei_share) || 0;
    sumProducerBefore += parseFloat(r.producer_payable) || 0;
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        period: PERIOD || 'all',
        row_count: rows.length,
        thei_share_moving_to_producer: Math.round(sumThei * 100) / 100,
        producer_payable_before: Math.round(sumProducerBefore * 100) / 100,
        sample: rows.slice(0, 15).map((r) => ({
          id: r.id,
          agent: r.agent_name,
          carrier: r.carrier,
          classification: r.classification,
          period: r.payment_period,
          thei_share: r.thei_share,
          producer_payable: r.producer_payable,
        })),
      },
      null,
      2
    )
  );

  if (!APPLY) {
    console.log('Dry-run only. Re-run with --apply to write.');
    await pool.end();
    return;
  }

  const upd = await pool.query(
    `
    UPDATE commission_records
       SET producer_payable = ROUND(COALESCE(producer_payable, 0) + COALESCE(thei_share, 0), 2),
           thei_share = 0,
           bsi_share = 0
     WHERE id IN (
       SELECT id FROM commission_records
       ${where}
     )
    RETURNING id
    `,
    params
  );

  console.log(JSON.stringify({ updated: upd.rowCount }, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * BOB Commission Recalculation Script
 *
 * Updates last_commission_amount and last_commission_date for all BOB clients
 * using format-tolerant matching (clientNameKey + normalizeCarrier) — same as
 * Missing Renewals / All Data Client File.
 *
 * Stores last_commission_date as YYYYMM text (not a Date), so normPeriod works.
 *
 * Usage:
 *   node scripts/recalc-bob-commissions.js                    # All clients
 *   node scripts/recalc-bob-commissions.js --carrier=Humana   # Specific carrier
 *   node scripts/recalc-bob-commissions.js --zero-only        # Only clients with $0
 */

const { Pool } = require('pg');
const {
  buildLastPaidLookup,
  clientCarrierKey,
  normPeriod,
  normalizeCarrier,
} = require('../src/missingRenewalsLogic');

const CARRIER_FILTER = process.argv.find((arg) => arg.startsWith('--carrier='))?.split('=')[1];
const ZERO_ONLY = process.argv.includes('--zero-only');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('💰 BOB Commission Recalculation Script\n');

  if (CARRIER_FILTER) console.log(`Carrier filter: ${CARRIER_FILTER}`);
  if (ZERO_ONLY) console.log('Mode: Only recalculating clients with $0 / null last paid');
  console.log('');

  try {
    const hist = await pool.query(
      `SELECT client_full_name, carrier, payment_period, commission, classification
       FROM commission_records
       WHERE commission IS NOT NULL AND commission > 0`
    );
    const lastPaidByKey = buildLastPaidLookup(hist.rows);
    console.log(`History keys with positive renewals: ${lastPaidByKey.size}`);

    let bobSql = `SELECT id, client_full_name, carrier, agent_name, last_commission_amount, last_commission_date
                  FROM book_of_business WHERE status = 'active'`;
    const params = [];
    if (CARRIER_FILTER) {
      params.push(CARRIER_FILTER);
      bobSql += ` AND LOWER(carrier) = LOWER($1)`;
    }
    const bob = await pool.query(bobSql, params);

    let updated = 0;
    const samples = [];

    for (const row of bob.rows) {
      if (ZERO_ONLY) {
        const amt = parseFloat(row.last_commission_amount) || 0;
        const hasDate = !!normPeriod(row.last_commission_date);
        if (amt > 0 && hasDate) continue;
      }

      const key = clientCarrierKey(row.client_full_name, row.carrier);
      if (!key) continue;
      const live = lastPaidByKey.get(key);
      if (!live) continue;

      // Optional carrier filter already applied on BOB; still guard family if needed
      if (CARRIER_FILTER && normalizeCarrier(row.carrier) !== normalizeCarrier(CARRIER_FILTER)) {
        continue;
      }

      await pool.query(
        `UPDATE book_of_business
         SET last_commission_amount = $1,
             last_commission_date = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [live.amount, live.period, row.id]
      );
      updated += 1;
      if (samples.length < 20) {
        samples.push({
          client: row.client_full_name,
          carrier: row.carrier,
          amount: live.amount,
          period: live.period,
        });
      }
    }

    console.log('='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log(`BOB active rows scanned: ${bob.rowCount}`);
    console.log(`Total clients updated: ${updated}\n`);

    samples.forEach((row, i) => {
      console.log(`${i + 1}. ${row.client} (${row.carrier})`);
      console.log(`   Amount: $${row.amount}`);
      console.log(`   Period: ${row.period}`);
    });
    if (updated > samples.length) console.log(`\n... and ${updated - samples.length} more`);

    console.log('\n✅ Recalculation complete!');
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

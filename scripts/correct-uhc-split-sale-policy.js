#!/usr/bin/env node
'use strict';

/**
 * Deploy-time / admin: correct the one UHC split new-sale policy (see src/uhcSplitSalePolicyCorrection.js).
 * Idempotent. Touches no other stored data.
 *
 *   node scripts/correct-uhc-split-sale-policy.js
 *
 * Also invoked from server.js on startup when DATABASE_URL is set (opt out with
 * RUN_UHC_SPLIT_SALE_CORRECTION=0).
 */

const { applyUhcSplitSaleCorrection, TARGET_POLICY } = require('../src/uhcSplitSalePolicyCorrection');
const { cleanupOrphanCommissionRecords } = require('../src/orphanCommissionCleanup');
const { runBsiHouseSplitBackfill } = require('../src/bsiHouseSplitBackfill');
const { applyLinaRemainingOverrideCorrection } = require('../src/linaRemainingOverrideCorrection');
const { applyLinaChargebackCapCorrection } = require('../src/linaChargebackCapCorrection');

async function main() {
  if (process.env.RUN_UHC_SPLIT_SALE_CORRECTION === '0') {
    console.log('[uhc-split-sale] skipped (RUN_UHC_SPLIT_SALE_CORRECTION=0)');
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.log('[uhc-split-sale] skipped (no DATABASE_URL)');
    return;
  }
  const { getPool } = require('../db/database');
  const pool = getPool();

  const orphans = await cleanupOrphanCommissionRecords(pool);
  console.log(`[orphan-records] deleted=${orphans.deleted}`);

  const result = await applyUhcSplitSaleCorrection(pool);
  console.log(`[uhc-split-sale] policy ${TARGET_POLICY}: found=${result.found} planned=${result.planned} applied=${result.applied}`);

  try {
    const peel = await applyLinaRemainingOverrideCorrection(pool, { period: '202610' });
    console.log(`[lina-remaining-override] period=${peel.period} found=${peel.found} planned=${peel.planned} applied=${peel.applied}`);
  } catch (err) {
    console.warn('[lina-remaining-override] skipped:', err.message);
  }

  // Re-split stored 10.2026 Lina chargebacks now that originals (and orphans) are clean.
  try {
    const prorate = await runBsiHouseSplitBackfill(pool, {
      period: '202610',
      apply: true,
      kinds: ['lina_cb_prorate'],
    });
    const planned = (prorate.updates && prorate.updates.length) || 0;
    const applied = prorate.applied != null ? prorate.applied : planned;
    console.log(`[lina-cb-prorate] period=202610 planned=${planned} applied=${applied}`);
  } catch (err) {
    console.warn('[lina-cb-prorate] skipped:', err.message);
  }

  // #111 cap is a no-op when lina_cb_prorate finds no original (unsplit skipped).
  // Recompute stored 10.2026 Lina chargebacks under the paid cap.
  try {
    const cap = await applyLinaChargebackCapCorrection(pool, { period: '202610' });
    console.log(`[lina-cb-cap] period=${cap.period} found=${cap.found} planned=${cap.planned} applied=${cap.applied}`);
  } catch (err) {
    console.warn('[lina-cb-cap] skipped:', err.message);
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[uhc-split-sale] failed:', err.message);
    process.exit(1);
  });
}

module.exports = { main };

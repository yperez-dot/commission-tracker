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
  const result = await applyUhcSplitSaleCorrection(getPool());
  console.log(`[uhc-split-sale] policy ${TARGET_POLICY}: found=${result.found} planned=${result.planned} applied=${result.applied}`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[uhc-split-sale] failed:', err.message);
    process.exit(1);
  });
}

module.exports = { main };

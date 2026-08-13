'use strict';

/**
 * recon-observe.js — OliComm Reconciliation Observer v0.2.0
 *
 * Observe-only Humana + BSI reconciliation for Alba Hernandez commissions.
 * Reads commission_records joined through policy_mbi_xwalk_cr_map to
 * agency_production, then assigns reconciliation observation states.
 *
 * ============================================================
 * FINANCIAL COLUMNS ARE READ-ONLY IN THIS SCRIPT.
 * This script NEVER writes to:
 *   thei_share, bsi_share, producer_payable, gross_commission,
 *   or any other financial/payout column.
 * It ONLY writes to the reconciliation observation columns:
 *   reconciliation_status, enrollment_report_match_id,
 *   enrollment_report_new_p2p, reconciled_at,
 *   recon_group, recon_source_version
 * ============================================================
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/recon-observe.js --dry-run
 *   DATABASE_URL=postgres://... node scripts/recon-observe.js --apply
 *
 *   --dry-run      Mandatory observation mode: print counts/samples, write nothing.
 *                  This is the DEFAULT when neither flag is supplied.
 *   --apply        Write observation metadata only. Refused unless --i-reviewed-dry-run
 *                  is also passed (forces an explicit dry-run review gate).
 *   --i-reviewed-dry-run
 *                  Required companion to --apply after reviewing dry-run output.
 *   --batch-size N Process N rows at a time (default: 500).
 *
 * Scope (hard-coded): carrier = Humana AND payee = BSI only.
 * Exact deterministic crosswalk joins only — no fuzzy matching.
 *
 * SEMANTIC_MISMATCH is NOT stored in reconciliation_status.
 * It is a reporting/grouping label only (recon_group).
 * EXCEPTION and FINAL are manual locks — this script never overwrites them.
 */

const { Pool } = require('pg');
const path = require('path');

const {
  STATUS,
  GROUP,
  MANUAL_LOCK_STATUSES,
  classifyRow,
  buildObservationUpdate,
  parseRawJson,
  canonicalizeProductFamily,
} = require(path.join(__dirname, '..', 'src', 'reconHelpers'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECON_VERSION = '0.2.0';

const SCOPE = {
  carrier: 'Humana',
  payee: 'BSI',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRunFlag = args.includes('--dry-run');
  const reviewed = args.includes('--i-reviewed-dry-run');
  const batchIdx = args.indexOf('--batch-size');
  const batchSize =
    batchIdx !== -1 && args[batchIdx + 1]
      ? parseInt(args[batchIdx + 1], 10)
      : 500;
  // Optional: reassess specific non-lock statuses already written (comma-separated).
  // Supports: --reassess=P2P_NEEDS_HISTORY  OR  --reassess P2P_NEEDS_HISTORY
  let reassessRaw = '';
  const reassEq = args.find((a) => a.startsWith('--reassess='));
  if (reassEq) {
    reassessRaw = reassEq.slice('--reassess='.length);
  } else {
    const reassIdx = args.indexOf('--reassess');
    if (reassIdx !== -1 && args[reassIdx + 1] && !args[reassIdx + 1].startsWith('--')) {
      reassessRaw = args[reassIdx + 1];
    }
  }
  const reassess = reassessRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Default is dry-run. Writes require --apply + review acknowledgement.
  const dryRun = !apply || dryRunFlag;
  return { dryRun, apply, reviewed, batchSize, reassess };
}

function scopeClause(alias = 'cr') {
  // Explicit Humana + BSI/payee scope only.
  return `
    LOWER(${alias}.carrier) = LOWER($carrier::text)
    AND LOWER(${alias}.payee) = LOWER($payee::text)
  `
    .replace(/\$carrier/g, `'${SCOPE.carrier}'`)
    .replace(/\$payee/g, `'${SCOPE.payee}'`);
}

function eligibleStatusClause(alias = 'cr', reassess = []) {
  // Assess NULL (not yet assessed) and PROVISIONAL only.
  // EXCEPTION / FINAL are never selected for write.
  // --reassess=STATUS allows rewriting specific observe states (not locks).
  const allowedReassess = reassess
    .filter((s) => s && s !== 'EXCEPTION' && s !== 'FINAL')
    .map((s) => `'${s.replace(/'/g, "''")}'`);
  const reassessSql = allowedReassess.length
    ? ` OR ${alias}.reconciliation_status IN (${allowedReassess.join(', ')})`
    : '';
  return `
    (
      ${alias}.reconciliation_status IS NULL
      OR ${alias}.reconciliation_status = '${STATUS.PROVISIONAL}'
      ${reassessSql}
    )
    AND COALESCE(${alias}.reconciliation_status, '') NOT IN ('${STATUS.EXCEPTION}', '${STATUS.FINAL}')
  `;
}

// ---------------------------------------------------------------------------
// Database queries — exact crosswalk joins only
// ---------------------------------------------------------------------------

/**
 * Fetch a batch of in-scope commission records eligible for observation.
 * FINANCIAL COLUMNS ARE READ-ONLY — commission/classification are selected
 * only for chargeback detection; they are never UPDATEd.
 */
async function fetchCandidateBatch(client, { limit, offset, reassess = [] }) {
  // Exact deterministic crosswalk joins only.
  // policy_mbi_xwalk_cr_map stores production_record_id + new_p2p from the
  // Humana BSI composite-key match (carrier+NPN+eff+state+normalized name).
  const sql = `
    SELECT
      cr.id                                    AS cr_id,
      cr.classification                        AS commission_type,
      cr.commission,
      cr.classification                        AS cr_classification,
      cr.effective_date,
      cr.raw_data,
      cr.reconciliation_status,
      cr.recon_group,
      xwalk.id                                 AS xwalk_id,
      ap.id                                    AS ap_id,
      COALESCE(
        NULLIF(xwalk.new_p2p, ''),
        NULLIF(ap.raw_data->>'New_P2P', ''),
        NULLIF(ap.raw_data->>'new_p2p', ''),
        NULLIF(ap.enrollment_type, '')
      )                                        AS prod_new_p2p,
      ap.status                                AS prod_status,
      COALESCE(
        NULLIF(ap.plan_name, ''),
        NULLIF(ap.policy_type, ''),
        NULLIF(ap.raw_data->>'Product', ''),
        NULLIF(ap.raw_data->>'PRODUCT_DESCRIPTION', '')
      )                                        AS prod_product,
      ap.policy_type                           AS prod_policy_type,
      ap.raw_data                              AS prod_raw_data,
      xwalk.mbi                                AS xwalk_mbi,
      (
        SELECT COUNT(*)::int
        FROM agency_production ap2
        WHERE ap2.mbi = COALESCE(ap.mbi, xwalk.mbi)
          AND COALESCE(ap.mbi, xwalk.mbi) IS NOT NULL
          AND (ap.id IS NULL OR ap2.id <> ap.id)
          AND ap2.effective_date IS NOT NULL
          AND COALESCE(ap.effective_date::text, cr.effective_date::text) IS NOT NULL
          AND ap2.effective_date::text < COALESCE(ap.effective_date::text, cr.effective_date::text)
      )                                        AS prior_enrollment_count,
      (
        SELECT COALESCE(
          NULLIF(ap3.plan_name, ''),
          NULLIF(ap3.policy_type, ''),
          NULLIF(ap3.raw_data->>'Product', '')
        )
        FROM agency_production ap3
        WHERE ap3.mbi = COALESCE(ap.mbi, xwalk.mbi)
          AND COALESCE(ap.mbi, xwalk.mbi) IS NOT NULL
          AND (ap.id IS NULL OR ap3.id <> ap.id)
          AND ap3.effective_date IS NOT NULL
          AND COALESCE(ap.effective_date::text, cr.effective_date::text) IS NOT NULL
          AND ap3.effective_date::text < COALESCE(ap.effective_date::text, cr.effective_date::text)
        ORDER BY ap3.effective_date DESC NULLS LAST
        LIMIT 1
      )                                        AS prior_product
    FROM commission_records cr
    LEFT JOIN policy_mbi_xwalk_cr_map xwalk
           ON xwalk.commission_record_id = cr.id
    LEFT JOIN agency_production ap
           ON ap.id = xwalk.production_record_id
    WHERE ${scopeClause('cr')}
      AND ${eligibleStatusClause('cr', reassess)}
    ORDER BY cr.id
    LIMIT  $1
    OFFSET $2
  `;
  const result = await client.query(sql, [limit, offset]);
  return result.rows.map(enrichRow);
}

function enrichRow(row) {
  const prodRaw = parseRawJson(row.prod_raw_data);
  const prodProductType =
    row.prod_policy_type ||
    prodRaw.product_type ||
    prodRaw['Product Type'] ||
    prodRaw.ProductType ||
    prodRaw.PRODUCT_DESCRIPTION ||
    null;
  return {
    ...row,
    prod_product_type: prodProductType,
    prior_product_type: null,
    current_product: row.prod_product,
    current_product_type: prodProductType,
    has_crosswalk_match: row.xwalk_id != null && row.ap_id != null,
  };
}

async function countEligible(client, reassess = []) {
  const result = await client.query(`
    SELECT COUNT(*) AS n
    FROM commission_records cr
    WHERE ${scopeClause('cr')}
      AND ${eligibleStatusClause('cr', reassess)}
  `);
  return parseInt(result.rows[0].n, 10);
}

async function countMatchedEligible(client, reassess = []) {
  const result = await client.query(`
    SELECT COUNT(*) AS n
    FROM commission_records cr
    INNER JOIN policy_mbi_xwalk_cr_map xwalk
           ON xwalk.commission_record_id = cr.id
    WHERE ${scopeClause('cr')}
      AND ${eligibleStatusClause('cr', reassess)}
  `);
  return parseInt(result.rows[0].n, 10);
}

async function countUnmatchedEligible(client, reassess = []) {
  const result = await client.query(`
    SELECT COUNT(*) AS n
    FROM commission_records cr
    LEFT JOIN policy_mbi_xwalk_cr_map xwalk
           ON xwalk.commission_record_id = cr.id
    WHERE ${scopeClause('cr')}
      AND ${eligibleStatusClause('cr', reassess)}
      AND xwalk.id IS NULL
  `);
  return parseInt(result.rows[0].n, 10);
}

async function countManualLocksInScope(client) {
  const result = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE reconciliation_status = 'EXCEPTION') AS exception_n,
      COUNT(*) FILTER (WHERE reconciliation_status = 'FINAL') AS final_n
    FROM commission_records cr
    WHERE ${scopeClause('cr')}
  `);
  return {
    exception: parseInt(result.rows[0].exception_n, 10),
    final: parseInt(result.rows[0].final_n, 10),
  };
}

/**
 * Write reconciliation observations only.
 * WHERE clause preserves EXCEPTION and FINAL and never touches financial columns.
 */
async function writeUpdates(client, updates, now, reassess = []) {
  if (updates.length === 0) return 0;

  const crIds = updates.map((u) => u.crId);
  const statuses = updates.map((u) => u.status);
  const groups = updates.map((u) => u.group);
  const matchIds = updates.map((u) => u.matchId);
  const newP2Ps = updates.map((u) => u.newP2P);

  const result = await client.query(
    `
    UPDATE commission_records AS cr
    SET
      reconciliation_status      = v.status,
      enrollment_report_match_id = v.match_id,
      enrollment_report_new_p2p  = v.new_p2p,
      reconciled_at              = $1::timestamptz,
      recon_group                = v.grp,
      recon_source_version       = $2
    FROM (
      SELECT
        UNNEST($3::text[]) AS cr_id,
        UNNEST($4::text[]) AS status,
        UNNEST($5::text[]) AS grp,
        UNNEST($6::text[]) AS match_id,
        UNNEST($7::text[]) AS new_p2p
    ) AS v
    WHERE cr.id::text = v.cr_id
      AND ${scopeClause('cr')}
      AND ${eligibleStatusClause('cr', reassess)}
  `,
    [now, RECON_VERSION, crIds, statuses, groups, matchIds, newP2Ps]
  );
  return result.rowCount || 0;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function makeSummary() {
  return {
    totalEligible: 0,
    totalMatched: 0,
    totalUnmatched: 0,
    manualLocks: { exception: 0, final: 0 },
    written: 0,
    skipped: 0,
    preservedLocks: 0,
    byStatus: {
      [STATUS.PROVISIONAL]: 0,
      [STATUS.SOURCE_NEW]: 0,
      [STATUS.SOURCE_P2P]: 0,
      [STATUS.LIKE_P2P_CANDIDATE]: 0,
      [STATUS.UNLIKE_P2P_CANDIDATE]: 0,
      [STATUS.P2P_NEEDS_HISTORY]: 0,
      [STATUS.RENEWAL_DATE_MISMATCH]: 0,
      [STATUS.RENEWAL_VS_NEW_PROD]: 0,
      [STATUS.NEEDS_CMS_PAYMENT_TYPE]: 0,
      [STATUS.CHARGEBACK_DEFER]: 0,
      [STATUS.SOURCE_CANCELLED]: 0,
      [STATUS.PENDING_NO_MATCH]: 0,
    },
    byGroup: {},
    samples: [],
  };
}

function recordResult(summary, row, classification) {
  const { status, group, write } = classification;

  if (MANUAL_LOCK_STATUSES.has(status) && write === false) {
    summary.preservedLocks += 1;
    return null;
  }

  summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
  if (group) summary.byGroup[group] = (summary.byGroup[group] || 0) + 1;

  if (summary.samples.length < 10) {
    summary.samples.push({
      cr_id: row.cr_id,
      status,
      group: group || '',
      prod_np: row.prod_new_p2p,
      prod_st: row.prod_status,
      comm_ty: row.commission_type,
      family: canonicalizeProductFamily(row.prod_product, row.prod_product_type),
    });
  }

  if (!write) {
    summary.skipped += 1;
    return null;
  }

  // Observation write (metadata only). PROVISIONAL from NULL marks "assessed".
  summary.written += 1;
  return buildObservationUpdate(row, classification);
}

function printReport(summary, dryRun, elapsed) {
  const tag = dryRun ? '[DRY RUN] ' : '';
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  OliComm Reconciliation Observer ${RECON_VERSION}  ${tag}`);
  console.log(`  Scope: carrier=${SCOPE.carrier} payee=${SCOPE.payee}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Elapsed            : ${elapsed}ms`);
  console.log(`  Eligible in scope  : ${summary.totalEligible}`);
  console.log(`  Crosswalk-matched  : ${summary.totalMatched}`);
  console.log(`  No crosswalk match : ${summary.totalUnmatched}`);
  console.log(
    `  Manual locks held  : EXCEPTION=${summary.manualLocks.exception} FINAL=${summary.manualLocks.final}`
  );
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  Assignments (observation only — no financial writes):');
  const ordered = [
    STATUS.SOURCE_NEW,
    STATUS.SOURCE_P2P,
    STATUS.LIKE_P2P_CANDIDATE,
    STATUS.UNLIKE_P2P_CANDIDATE,
    STATUS.P2P_NEEDS_HISTORY,
    STATUS.RENEWAL_DATE_MISMATCH,
    STATUS.RENEWAL_VS_NEW_PROD,
    STATUS.NEEDS_CMS_PAYMENT_TYPE,
    STATUS.CHARGEBACK_DEFER,
    STATUS.SOURCE_CANCELLED,
    STATUS.PENDING_NO_MATCH,
    STATUS.PROVISIONAL,
  ];
  for (const s of ordered) {
    const n = summary.byStatus[s] || 0;
    if (n > 0) console.log(`    ${s.padEnd(26)}: ${n}`);
  }
  console.log(`    Skipped (unrecognised)    : ${summary.skipped}`);
  console.log(`    TOTAL observation writes : ${summary.written}`);
  if (Object.keys(summary.byGroup).length > 0) {
    console.log('  Reporting groups (recon_group only — never reconciliation_status):');
    for (const [g, n] of Object.entries(summary.byGroup)) {
      console.log(`    ${g.padEnd(28)}: ${n}`);
      if (g === GROUP.SEMANTIC_MISMATCH) {
        console.log('      (SEMANTIC_MISMATCH is grouping-only; not stored as status)');
      }
    }
  }
  console.log('───────────────────────────────────────────────────────────────');
  if (summary.samples.length > 0) {
    console.log('  Samples (up to 10):');
    for (const s of summary.samples) {
      console.log(
        `    cr_id=${s.cr_id}  status=${s.status}  group=${s.group || '—'}` +
          `  prod_np2p=${s.prod_np}  prod_st=${s.prod_st}  comm_type=${s.comm_ty}`
      );
    }
  }
  console.log('═══════════════════════════════════════════════════════════════');
  if (dryRun) {
    console.log('  *** DRY RUN — no rows were written to the database ***');
    console.log('  To write observation metadata after review:');
    console.log('    node scripts/recon-observe.js --apply --i-reviewed-dry-run');
    console.log('═══════════════════════════════════════════════════════════════');
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { dryRun, apply, reviewed, batchSize, reassess } = parseArgs();

  if (apply && !reviewed) {
    console.error(
      'ERROR: --apply requires --i-reviewed-dry-run after reviewing dry-run output.'
    );
    console.error('Run first:  node scripts/recon-observe.js --dry-run');
    process.exit(1);
  }

  if (apply && reviewed) {
    // Explicit write mode.
  } else if (!dryRun) {
    console.error('ERROR: refusing to write without dry-run gate.');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const startMs = Date.now();
  const summary = makeSummary();
  const writeMode = apply && reviewed;

  console.log(
    `OliComm recon-observe.js ${RECON_VERSION} starting${writeMode ? ' (APPLY)' : ' (DRY RUN)'} …`
  );
  console.log(`Scope: carrier=${SCOPE.carrier} AND payee=${SCOPE.payee}`);
  if (reassess.length) console.log(`Reassess statuses: ${reassess.join(', ')}`);
  console.log('FINANCIAL COLUMNS ARE READ-ONLY IN THIS SCRIPT.');
  console.log('EXCEPTION and FINAL rows are never overwritten.');
  console.log('P2P with no in-book prior → SOURCE_P2P (BSI book starts ~Jul 2025; no prior years).');

  const client = await pool.connect();
  try {
    summary.totalEligible = await countEligible(client, reassess);
    summary.totalMatched = await countMatchedEligible(client, reassess);
    summary.totalUnmatched = await countUnmatchedEligible(client, reassess);
    summary.manualLocks = await countManualLocksInScope(client);

    console.log(`  ${summary.totalEligible} eligible Humana/BSI rows.`);
    console.log(`  ${summary.totalMatched} with crosswalk match.`);
    console.log(`  ${summary.totalUnmatched} with no crosswalk match → PENDING_NO_MATCH.`);
    console.log(
      `  Preserving ${summary.manualLocks.exception} EXCEPTION + ${summary.manualLocks.final} FINAL locks.`
    );

    if (summary.totalEligible === 0) {
      console.log('  Nothing to do.');
    } else {
      // When writing, never advance OFFSET — updated rows leave the eligible set,
      // so OFFSET would skip remaining NULL/PROVISIONAL rows. Always fetch next page from 0.
      // Dry-run may use OFFSET because rows are not mutated.
      let processed = 0;
      let offset = 0;
      while (processed < summary.totalEligible) {
        const rows = await fetchCandidateBatch(client, {
          limit: batchSize,
          offset: writeMode ? 0 : offset,
          reassess,
        });
        if (rows.length === 0) break;

        const updates = [];
        for (const row of rows) {
          const classification = classifyRow(row);
          const update = recordResult(summary, row, classification);
          if (update) updates.push(update);
        }

        if (writeMode && updates.length > 0) {
          await writeUpdates(client, updates, new Date().toISOString(), reassess);
        }

        processed += rows.length;
        if (!writeMode) offset += rows.length;
        process.stdout.write(
          `\r  Processed ${Math.min(processed, summary.totalEligible)} / ${summary.totalEligible} …`
        );
      }
      process.stdout.write('\n');
    }
  } finally {
    client.release();
    await pool.end();
  }

  printReport(summary, !writeMode, Date.now() - startMs);
}

// Export pure pieces for unit tests without opening a DB connection.
module.exports = {
  RECON_VERSION,
  SCOPE,
  parseArgs,
  classifyRow,
  enrichRow,
  recordResult,
  makeSummary,
  writeUpdates,
  GROUP,
  STATUS,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}

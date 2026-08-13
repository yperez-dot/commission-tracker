'use strict';

/**
 * recon-observe.js — OliComm Reconciliation Observer v0.1.0
 *
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
 *   recon_semantic_sub, recon_source_version
 * ============================================================
 *
 * Usage:
 *   DATABASE_URL=postgres://... node recon-observe.js [--dry-run] [--batch-size N]
 *
 *   --dry-run      Print counts and samples without writing anything to DB.
 *   --batch-size N Process N rows at a time (default: 500).
 *
 * Reconciliation status state machine (first-class actionable values):
 *   PROVISIONAL            → default; not yet reconciled
 *   SOURCE_NEW             → crosswalk-matched; prod New, Active
 *   SOURCE_P2P             → crosswalk-matched; prod P2P, Active (generic; no prior history)
 *   LIKE_P2P_CANDIDATE     → matched; P2P + prior MA/MAPD enrollment confirmed
 *   UNLIKE_P2P_CANDIDATE   → matched; P2P + prior plan different product family
 *   P2P_NEEDS_HISTORY      → matched; prod P2P but no prior enrollment found
 *   RENEWAL_DATE_MISMATCH  → matched; Renewal commission but prod shows New (ambiguous)
 *   CHARGEBACK_DEFER       → chargeback row; must be origin-matched manually
 *   SOURCE_CANCELLED       → crosswalk-matched; prod Cancelled/Termed
 *   PENDING_NO_MATCH       → no crosswalk match (NOT written; row stays PROVISIONAL)
 *   EXCEPTION              → manually flagged; engine NEVER overwrites
 *   FINAL                  → manually locked; engine NEVER overwrites
 *
 * SEMANTIC_MISMATCH is NOT stored. It is a reporting/grouping label only,
 * stored in recon_group for dashboard queries across the mismatch family.
 */

const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECON_VERSION = '0.1.0';

const STATUS = {
  PROVISIONAL:           'PROVISIONAL',
  SOURCE_NEW:            'SOURCE_NEW',
  SOURCE_P2P:            'SOURCE_P2P',
  LIKE_P2P_CANDIDATE:    'LIKE_P2P_CANDIDATE',
  UNLIKE_P2P_CANDIDATE:  'UNLIKE_P2P_CANDIDATE',
  P2P_NEEDS_HISTORY:     'P2P_NEEDS_HISTORY',
  RENEWAL_DATE_MISMATCH: 'RENEWAL_DATE_MISMATCH',
  CHARGEBACK_DEFER:      'CHARGEBACK_DEFER',
  SOURCE_CANCELLED:      'SOURCE_CANCELLED',
  PENDING_NO_MATCH:      'PENDING_NO_MATCH',  // informational; not written
  EXCEPTION:             'EXCEPTION',          // engine never touches
  FINAL:                 'FINAL',              // engine never touches
};

// Reporting/grouping labels — stored in recon_group, NOT in reconciliation_status
const GROUP = {
  SOURCE_BACKED:     'SOURCE_BACKED',
  SEMANTIC_MISMATCH: 'SEMANTIC_MISMATCH',
  CHARGEBACK:        'CHARGEBACK',
};

// Production statuses considered "Active"
const PROD_ACTIVE_STATUSES = new Set(['active', 'enrolled', 'effective']);
// Production statuses considered "Cancelled/Termed"
const PROD_CANCELLED_STATUSES = new Set(['cancelled', 'termed', 'terminated', 'disenrolled', 'lapsed']);

// Commission type keywords for FirstYear vs Renewal detection (case-insensitive)
const FIRST_YEAR_PATTERNS = [/first.?year/i, /\bfy\b/i, /\bnew\b/i];
const RENEWAL_PATTERNS    = [/renewal/i, /\bren\b/i, /\bry\b/i];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun:    args.includes('--dry-run'),
    batchSize: (() => {
      const idx = args.indexOf('--batch-size');
      return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : 500;
    })(),
  };
}

function matchesAny(str, patterns) {
  if (!str) return false;
  return patterns.some((p) => p.test(str));
}

function normStatus(s) {
  return (s || '').toLowerCase().trim();
}

function normNewP2P(s) {
  return (s || '').toLowerCase().trim();
}

/**
 * Classify a matched row into a reconciliation state + optional sub-type.
 *
 * @param {object} row - Joined row from the candidate query.
 * @returns {{ status: string, sub: string|null }}
 */
function classifyRow(row) {
  const prodNewP2P   = normNewP2P(row.prod_new_p2p);
  const prodStatus   = normStatus(row.prod_status);
  const commType     = row.commission_type || '';
  const commission   = parseFloat(row.commission) || 0;
  const crClass      = (row.cr_classification || '').toLowerCase();

  const isActive     = PROD_ACTIVE_STATUSES.has(prodStatus) || prodStatus === 'paid';
  const isCancelled  = PROD_CANCELLED_STATUSES.has(prodStatus);
  const isNew        = prodNewP2P === 'new';
  const isP2P        = prodNewP2P === 'p2p';
  const isFirstYear  = matchesAny(commType, FIRST_YEAR_PATTERNS);
  const isRenewal    = matchesAny(commType, RENEWAL_PATTERNS);
  const isChargeback = commission < 0 || crClass === 'chargeback';

  // --- Chargebacks: always defer to manual origin-match ---
  if (isChargeback) {
    return { status: STATUS.CHARGEBACK_DEFER, group: GROUP.CHARGEBACK };
  }

  // --- Cancelled/Termed (takes precedence over type mismatch) ---
  if (isCancelled) {
    return { status: STATUS.SOURCE_CANCELLED, group: GROUP.SOURCE_BACKED };
  }

  // --- Mismatch checks (only meaningful when prod is Active/Paid) ---
  if (isActive) {
    // Commission FirstYear but production P2P → first-class P2P state
    if (isFirstYear && isP2P) {
      const status = deriveP2PState(row);
      return { status, group: GROUP.SEMANTIC_MISMATCH };
    }

    // Commission Renewal but production New → RENEWAL_DATE_MISMATCH
    if (isRenewal && isNew) {
      return { status: STATUS.RENEWAL_DATE_MISMATCH, group: GROUP.SEMANTIC_MISMATCH };
    }

    // Clean matches
    if (isNew) return { status: STATUS.SOURCE_NEW, group: GROUP.SOURCE_BACKED };
    if (isP2P) return { status: STATUS.SOURCE_P2P, group: GROUP.SOURCE_BACKED };
  }

  // Unrecognised prod status — leave PROVISIONAL for human review
  return { status: STATUS.PROVISIONAL, group: null };
}

/**
 * Determine the P2P sub-type when commission is FirstYear but prod says P2P.
 * Uses prior_enrollment_count from the joined query to differentiate.
 *
 * @param {object} row
 * @returns {string} SUB constant
 */
// Returns first-class STATUS value directly (not a sub-type string)
function deriveP2PState(row) {
  const priorCount = parseInt(row.prior_enrollment_count, 10);
  if (isNaN(priorCount)) return STATUS.P2P_NEEDS_HISTORY;
  if (priorCount > 0)    return STATUS.LIKE_P2P_CANDIDATE;
  return STATUS.UNLIKE_P2P_CANDIDATE;
}

// ---------------------------------------------------------------------------
// Database queries
// ---------------------------------------------------------------------------

/**
 * Fetch a batch of PROVISIONAL commission records that have a crosswalk entry.
 *
 * Returns only the columns needed for classification + the primary key.
 * FINANCIAL COLUMNS ARE READ-ONLY IN THIS SCRIPT — they are not selected here
 * and must not appear in any UPDATE.
 */
async function fetchMatchedBatch(client, { limit, offset }) {
  const sql = `
    SELECT
      cr.id                                    AS cr_id,
      cr.commission_type,
      cr.commission,
      cr.classification                        AS cr_classification,
      xwalk.id                                 AS xwalk_id,
      ap.id                                    AS ap_id,
      ap.new_p2p                               AS prod_new_p2p,
      ap.status                                AS prod_status,
      (
        SELECT COUNT(*)
        FROM agency_production ap2
        WHERE ap2.mbi = cr.mbi
          AND ap2.plan_year < ap.plan_year
      )                                        AS prior_enrollment_count
    FROM commission_records cr
    INNER JOIN policy_mbi_xwalk_cr_map xwalk
           ON xwalk.commission_record_id = cr.id
    INNER JOIN agency_production ap
           ON ap.id = xwalk.agency_production_id
    WHERE cr.reconciliation_status = $1
    ORDER BY cr.id
    LIMIT  $2
    OFFSET $3
  `;
  const result = await client.query(sql, [STATUS.PROVISIONAL, limit, offset]);
  return result.rows;
}

/** Count total PROVISIONAL rows that have a crosswalk match. */
async function countMatchedProvisional(client) {
  const result = await client.query(`
    SELECT COUNT(*) AS n
    FROM commission_records cr
    INNER JOIN policy_mbi_xwalk_cr_map xwalk
           ON xwalk.commission_record_id = cr.id
    WHERE cr.reconciliation_status = $1
  `, [STATUS.PROVISIONAL]);
  return parseInt(result.rows[0].n, 10);
}

/** Count PROVISIONAL rows with NO crosswalk match (informational only). */
async function countUnmatchedProvisional(client) {
  const result = await client.query(`
    SELECT COUNT(*) AS n
    FROM commission_records cr
    LEFT JOIN policy_mbi_xwalk_cr_map xwalk
           ON xwalk.commission_record_id = cr.id
    WHERE cr.reconciliation_status = $1
      AND xwalk.id IS NULL
  `, [STATUS.PROVISIONAL]);
  return parseInt(result.rows[0].n, 10);
}

/**
 * Write reconciliation observations back to commission_records.
 *
 * ============================================================
 * FINANCIAL COLUMNS ARE READ-ONLY IN THIS SCRIPT.
 * Only the six reconciliation observation columns are updated.
 * The WHERE clause restricts writes to PROVISIONAL rows only —
 * EXCEPTION and FINAL rows are never touched.
 * ============================================================
 *
 * @param {object} client   - pg PoolClient
 * @param {Array}  updates  - Array of { crId, status, sub, matchId, newP2P }
 * @param {string} now      - ISO timestamp string for reconciled_at
 */
async function writeUpdates(client, updates, now) {
  if (updates.length === 0) return;

  // Batch into a single multi-row update using unnest for efficiency.
  const crIds    = updates.map((u) => u.crId);
  const statuses = updates.map((u) => u.status);
  const groups   = updates.map((u) => u.group);
  const matchIds = updates.map((u) => u.matchId);
  const newP2Ps  = updates.map((u) => u.newP2P);

  await client.query(`
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
    WHERE cr.id::text            = v.cr_id
      AND cr.reconciliation_status = 'PROVISIONAL'
  `, [now, RECON_VERSION, crIds, statuses, groups, matchIds, newP2Ps]);
}

// ---------------------------------------------------------------------------
// Summary accumulator
// ---------------------------------------------------------------------------

function makeSummary() {
  return {
    totalMatched:    0,
    totalUnmatched:  0,   // PENDING_NO_MATCH — left as PROVISIONAL, not written
    written:         0,
    skipped:         0,   // rows that resolved back to PROVISIONAL (unrecognised prod status)
    byStatus: {
      [STATUS.SOURCE_NEW]:            0,
      [STATUS.SOURCE_P2P]:            0,
      [STATUS.LIKE_P2P_CANDIDATE]:    0,
      [STATUS.UNLIKE_P2P_CANDIDATE]:  0,
      [STATUS.P2P_NEEDS_HISTORY]:     0,
      [STATUS.RENEWAL_DATE_MISMATCH]: 0,
      [STATUS.CHARGEBACK_DEFER]:      0,
      [STATUS.SOURCE_CANCELLED]:      0,
    },
    byGroup: {},
    samples: [],          // up to 10 representative rows for --dry-run output
  };
}

function recordResult(summary, row, classification) {
  const { status, group } = classification;

  if (status === STATUS.PROVISIONAL) {
    summary.skipped += 1;
    return;
  }

  summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
  if (group) summary.byGroup[group] = (summary.byGroup[group] || 0) + 1;
  summary.written += 1;

  if (summary.samples.length < 10) {
    summary.samples.push({
      cr_id:   row.cr_id,
      status,
      group:   group || '',
      prod_np: row.prod_new_p2p,
      prod_st: row.prod_status,
      comm_ty: row.commission_type,
    });
  }
}

// ---------------------------------------------------------------------------
// Report printer (matches recon v2 output format)
// ---------------------------------------------------------------------------

function printReport(summary, dryRun, elapsed) {
  const tag = dryRun ? '[DRY RUN] ' : '';
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  OliComm Reconciliation Observer ${RECON_VERSION}  ${tag}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Elapsed            : ${elapsed}ms`);
  console.log(`  Crosswalk-matched  : ${summary.totalMatched}`);
  console.log(`  No crosswalk match : ${summary.totalUnmatched}  (left PROVISIONAL — not written)`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  Assignments written:');
  const ordered = [
    STATUS.SOURCE_NEW, STATUS.SOURCE_P2P,
    STATUS.LIKE_P2P_CANDIDATE, STATUS.UNLIKE_P2P_CANDIDATE, STATUS.P2P_NEEDS_HISTORY,
    STATUS.RENEWAL_DATE_MISMATCH, STATUS.CHARGEBACK_DEFER, STATUS.SOURCE_CANCELLED,
  ];
  for (const s of ordered) {
    const n = summary.byStatus[s] || 0;
    if (n > 0) console.log(`    ${s.padEnd(26)}: ${n}`);
  }
  console.log(`    Skipped (unrecognised)    : ${summary.skipped}`);
  console.log(`    TOTAL written             : ${summary.written}`);
  if (Object.keys(summary.byGroup).length > 0) {
    console.log('  Reporting groups (recon_group):');
    for (const [g, n] of Object.entries(summary.byGroup)) {
      console.log(`    ${g.padEnd(28)}: ${n}`);
    }
  }
  console.log('───────────────────────────────────────────────────────────────');
  if (summary.samples.length > 0) {
    console.log(`  Samples (up to 10):`);
    for (const s of summary.samples) {
      console.log(
        `    cr_id=${s.cr_id}  status=${s.status}  sub=${s.sub || '—'}` +
        `  prod_np2p=${s.prod_np}  prod_st=${s.prod_st}  comm_type=${s.comm_ty}`
      );
    }
  }
  console.log('═══════════════════════════════════════════════════════════════');
  if (dryRun) {
    console.log('  *** DRY RUN — no rows were written to the database ***');
    console.log('═══════════════════════════════════════════════════════════════');
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { dryRun, batchSize } = parseArgs();

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const startMs = Date.now();
  const summary = makeSummary();

  console.log(`OliComm recon-observe.js ${RECON_VERSION} starting${dryRun ? ' (DRY RUN)' : ''} …`);
  console.log('FINANCIAL COLUMNS ARE READ-ONLY IN THIS SCRIPT.');

  const client = await pool.connect();
  try {
    // --- Count universe ---
    summary.totalMatched   = await countMatchedProvisional(client);
    summary.totalUnmatched = await countUnmatchedProvisional(client);

    console.log(`  ${summary.totalMatched} PROVISIONAL rows with crosswalk match to process.`);
    console.log(`  ${summary.totalUnmatched} PROVISIONAL rows have no crosswalk match (will remain PROVISIONAL).`);

    if (summary.totalMatched === 0) {
      console.log('  Nothing to do.');
    } else {
      let offset = 0;

      while (offset < summary.totalMatched) {
        const rows = await fetchMatchedBatch(client, { limit: batchSize, offset });
        if (rows.length === 0) break;

        const updates = [];

        for (const row of rows) {
          const classification = classifyRow(row);
          recordResult(summary, row, classification);

          if (classification.status !== STATUS.PROVISIONAL) {
            updates.push({
              crId:    String(row.cr_id),
              status:  classification.status,
              group:   classification.group || null,
              matchId: String(row.ap_id),
              newP2P:  row.prod_new_p2p || null,
            });
          }
        }

        if (!dryRun && updates.length > 0) {
          await writeUpdates(client, updates, new Date().toISOString());
        }

        offset += rows.length;
        process.stdout.write(
          `\r  Processed ${Math.min(offset, summary.totalMatched)} / ${summary.totalMatched} …`
        );
      }
      process.stdout.write('\n');
    }
  } finally {
    client.release();
    await pool.end();
  }

  const elapsed = Date.now() - startMs;
  printReport(summary, dryRun, elapsed);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

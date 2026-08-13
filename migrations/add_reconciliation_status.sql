-- =============================================================================
-- Migration: add_reconciliation_status.sql
-- Purpose:   Add reconciliation observation columns to commission_records.
--
-- IMPORTANT:
--   Reconciliation status is observe-only. Never drives split/payout logic
--   directly. These columns record what the reconciliation engine *observed*
--   when comparing commission records against enrollment-report production data.
--   Financial columns (thei_share, bsi_share, producer_payable,
--   gross_commission, etc.) are NEVER touched by the reconciliation engine.
--   State in reconciliation_status is advisory and auditable only.
--
-- Safe to run multiple times (all statements are idempotent).
-- No UPDATE or INSERT statements — DDL only.
--
-- Design decisions:
--   - reconciliation_status is nullable with NO default.
--     Reason: ALTER TABLE ... ADD COLUMN with a constant DEFAULT in PostgreSQL
--     causes all existing rows to read as that default value. This would make
--     the entire existing table appear PROVISIONAL to the reconciliation script,
--     targeting it unexpectedly. NULL = "not yet assessed" — the script scopes
--     its own run explicitly (carrier + payee filter + dry-run approval).
--   - Allowed values are enforced by a CHECK constraint, not a comment.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Add reconciliation_status — nullable, no default.
-- ---------------------------------------------------------------------------
ALTER TABLE commission_records
    ADD COLUMN IF NOT EXISTS reconciliation_status TEXT;

-- ---------------------------------------------------------------------------
-- Step 2: Add CHECK constraint enforcing allowed values.
--   NULL is explicitly permitted (= not yet assessed).
--   Adding a new state requires a migration to update this constraint.
--
--   Allowed first-class actionable states:
--     NULL                   - Not yet assessed by the reconciliation engine
--     PROVISIONAL            - Assessed; awaiting crosswalk match or further data
--     SOURCE_NEW             - Matched; production New enrollment, Active
--     SOURCE_P2P             - Matched; production P2P, Active (generic; no prior history)
--     LIKE_P2P_CANDIDATE     - Matched; P2P + prior MA/MAPD enrollment confirmed
--     UNLIKE_P2P_CANDIDATE   - Matched; P2P + prior plan was different product family (MA↔PDP)
--     P2P_NEEDS_HISTORY      - Matched; production P2P but no prior enrollment found
--     RENEWAL_DATE_MISMATCH  - Matched; Renewal commission but production shows New (ambiguous)
--     NEEDS_CMS_PAYMENT_TYPE - Matched; cannot classify without CMS transaction-type field
--     CHARGEBACK_DEFER       - Chargeback; must be origin-matched manually, no formula
--     SOURCE_CANCELLED       - Matched; production shows Cancelled/Termed
--     PENDING_NO_MATCH       - Assessed; no crosswalk match found
--     EXCEPTION              - Manually flagged for human review; engine NEVER overwrites
--     FINAL                  - Manually locked; engine NEVER overwrites
--
--   SEMANTIC_MISMATCH is NOT a stored value — reporting/grouping only (see recon_group).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name   = 'commission_records'
          AND constraint_name = 'chk_recon_status'
    ) THEN
        ALTER TABLE commission_records
            ADD CONSTRAINT chk_recon_status CHECK (
                reconciliation_status IS NULL
                OR reconciliation_status IN (
                    'PROVISIONAL',
                    'SOURCE_NEW',
                    'SOURCE_P2P',
                    'LIKE_P2P_CANDIDATE',
                    'UNLIKE_P2P_CANDIDATE',
                    'P2P_NEEDS_HISTORY',
                    'RENEWAL_DATE_MISMATCH',
                    'NEEDS_CMS_PAYMENT_TYPE',
                    'CHARGEBACK_DEFER',
                    'SOURCE_CANCELLED',
                    'PENDING_NO_MATCH',
                    'EXCEPTION',
                    'FINAL'
                )
            );
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Step 3: Remaining observation columns — all nullable, all idempotent.
-- ---------------------------------------------------------------------------

-- References the matching record in the junction/production table.
-- NULL when not yet assessed or no match found.
ALTER TABLE commission_records
    ADD COLUMN IF NOT EXISTS enrollment_report_match_id TEXT;

-- 'New' or 'P2P' copied from the production report at reconciliation time.
ALTER TABLE commission_records
    ADD COLUMN IF NOT EXISTS enrollment_report_new_p2p TEXT;

-- Timestamp of the most recent reconciliation engine write to this row.
ALTER TABLE commission_records
    ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

-- Reporting/grouping label for dashboard queries (NOT an actionable status).
--   SEMANTIC_MISMATCH — groups LIKE_P2P_CANDIDATE, UNLIKE_P2P_CANDIDATE,
--                        P2P_NEEDS_HISTORY, RENEWAL_DATE_MISMATCH,
--                        NEEDS_CMS_PAYMENT_TYPE
--   CHARGEBACK        — groups CHARGEBACK_DEFER rows
--   UNMATCHED         — groups PENDING_NO_MATCH rows
--   SOURCE_BACKED     — groups SOURCE_NEW, SOURCE_P2P, SOURCE_CANCELLED
ALTER TABLE commission_records
    ADD COLUMN IF NOT EXISTS recon_group TEXT;

-- Version string of the reconciliation engine that last wrote to this row.
ALTER TABLE commission_records
    ADD COLUMN IF NOT EXISTS recon_source_version TEXT;

-- ---------------------------------------------------------------------------
-- Step 4: Partial index over assessed (non-NULL) rows for dashboard queries.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cr_recon_status
    ON commission_records (reconciliation_status)
    WHERE reconciliation_status IS NOT NULL;

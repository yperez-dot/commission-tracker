-- ============================================================================
-- CLEANUP: KR UHC Bad Records (Blank Periods + Fake Summary Clients)
-- ============================================================================
-- Created: 2026-06-19
-- Purpose: Fix existing KR UHC records with missing periods and remove fake clients
--
-- PROBLEM:
-- 1. New Business/Chargeback records imported with blank periods ($347 inflating totals)
-- 2. Summary rows imported as real clients ("Commission Earned & Paid", etc.)
-- 3. These fake clients created BOB entries (already deleted manually)
--
-- SOLUTION:
-- 1. Delete blank-period summary records (Commission Earned, Chargebacks, etc.)
-- 2. Assign correct periods to remaining blank-period records based on upload_id
--
-- Upload ID → Statement Period Mapping:
-- Upload 321 (KR Jan) → 202601
-- Upload 318 (KR Feb) → 202602
-- Upload 320 (KR Mar) → 202603
-- Upload 322 (KR Apr) → 202604
-- Upload 333 (KR May) → 202605
-- ============================================================================

BEGIN;

-- STEP 1: Delete fake summary client records (these created fake BOB entries)
-- These are the "Commission Earned & Paid", "Chargebacks", etc. rows

DELETE FROM commission_records
WHERE upload_id IN (318, 320, 321, 322, 333)
AND (
  LOWER(client_full_name) LIKE '%commission earned%'
  OR LOWER(client_full_name) LIKE '%chargebacks%'
  OR LOWER(client_full_name) LIKE '%applied to balance%'
  OR LOWER(client_full_name) LIKE '%total commission%'
  OR LOWER(client_full_name) LIKE '%payment received%'
  OR policy_number = 'SUMMARY'
);

-- Log how many summary records were deleted
SELECT 'Deleted fake summary records' AS action, 
       COUNT(*) AS deleted_count
FROM commission_records
WHERE upload_id IN (318, 320, 321, 322, 333)
AND (
  LOWER(client_full_name) LIKE '%commission earned%'
  OR LOWER(client_full_name) LIKE '%chargebacks%'
  OR LOWER(client_full_name) LIKE '%applied to balance%'
  OR policy_number = 'SUMMARY'
);

-- STEP 2: Assign correct periods to blank-period records

-- Upload 321 (KR January 2026) → 202601
UPDATE commission_records
SET payment_period = '202601'
WHERE upload_id = 321
AND (payment_period IS NULL OR payment_period = '' OR payment_period = 'Unknown');

-- Upload 318 (KR February 2026) → 202602
UPDATE commission_records
SET payment_period = '202602'
WHERE upload_id = 318
AND (payment_period IS NULL OR payment_period = '' OR payment_period = 'Unknown');

-- Upload 320 (KR March 2026) → 202603
UPDATE commission_records
SET payment_period = '202603'
WHERE upload_id = 320
AND (payment_period IS NULL OR payment_period = '' OR payment_period = 'Unknown');

-- Upload 322 (KR April 2026) → 202604
UPDATE commission_records
SET payment_period = '202604'
WHERE upload_id = 322
AND (payment_period IS NULL OR payment_period = '' OR payment_period = 'Unknown');

-- Upload 333 (KR May 2026) → 202605
UPDATE commission_records
SET payment_period = '202605'
WHERE upload_id = 333
AND (payment_period IS NULL OR payment_period = '' OR payment_period = 'Unknown');

-- VERIFICATION: Show records that were updated
SELECT 
  upload_id,
  payment_period,
  COUNT(*) as record_count,
  SUM(commission) as total_commission
FROM commission_records
WHERE upload_id IN (318, 320, 321, 322, 333)
GROUP BY upload_id, payment_period
ORDER BY upload_id, payment_period;

-- Show any remaining records with blank periods (should be 0)
SELECT 
  upload_id,
  client_full_name,
  carrier,
  commission,
  classification,
  payment_period
FROM commission_records
WHERE upload_id IN (318, 320, 321, 322, 333)
AND (payment_period IS NULL OR payment_period = '' OR payment_period = 'Unknown')
LIMIT 20;

COMMIT;

-- ============================================================================
-- EXPECTED RESULTS:
-- 1. Summary records deleted (Commission Earned, Chargebacks summary rows)
-- 2. All remaining KR UHC records now have correct payment_period
-- 3. No more blank-period records inflating totals
-- 4. BOB fake clients already manually deleted (won't recur with parser fix)
-- ============================================================================

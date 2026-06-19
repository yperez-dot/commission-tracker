-- ============================================================
-- Cleanup Upload 374 Duplicates
-- ============================================================
-- Removes duplicate records from upload 374 where same client,
-- carrier, period, and classification appear multiple times.
-- Keeps only the first occurrence (lowest ID).
-- ============================================================

-- ============================================================
-- STEP 1: PREVIEW DUPLICATES (DRY RUN)
-- ============================================================

WITH duplicates AS (
  SELECT 
    id,
    client_full_name,
    carrier,
    payment_period,
    classification,
    commission,
    ROW_NUMBER() OVER (
      PARTITION BY client_full_name, carrier, payment_period, classification
      ORDER BY id
    ) as rn
  FROM commission_records
  WHERE upload_id = 374
)
SELECT 
  id,
  client_full_name as "Client",
  carrier as "Carrier",
  payment_period as "Period",
  classification as "Type",
  commission as "Commission",
  rn as "Occurrence"
FROM duplicates
WHERE rn > 1
ORDER BY client_full_name, carrier, payment_period, classification, rn;

-- ============================================================
-- STEP 2: COUNT DUPLICATES
-- ============================================================

WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY client_full_name, carrier, payment_period, classification
    ORDER BY id
  ) as rn
  FROM commission_records
  WHERE upload_id = 374
)
SELECT COUNT(*) as "Duplicate Count"
FROM duplicates
WHERE rn > 1;

-- ============================================================
-- STEP 3: APPLY CLEANUP
-- ============================================================
-- ⚠️ ONLY RUN AFTER REVIEWING STEPS 1 & 2!

WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY client_full_name, carrier, payment_period, classification
    ORDER BY id
  ) as rn
  FROM commission_records
  WHERE upload_id = 374
)
DELETE FROM commission_records
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Returns count of deleted rows

-- ============================================================
-- STEP 4: VERIFY CLEANUP (Run after deletion)
-- ============================================================

-- Check for remaining duplicates (should be 0)
WITH duplicates AS (
  SELECT 
    client_full_name,
    carrier,
    payment_period,
    classification,
    COUNT(*) as count
  FROM commission_records
  WHERE upload_id = 374
  GROUP BY client_full_name, carrier, payment_period, classification
  HAVING COUNT(*) > 1
)
SELECT 
  COUNT(*) as "Remaining Duplicates",
  COALESCE(SUM(count), 0) as "Total Duplicate Records"
FROM duplicates;

-- Show upload 374 summary
SELECT 
  COUNT(*) as "Total Records",
  COUNT(DISTINCT client_full_name) as "Unique Clients",
  COUNT(DISTINCT carrier) as "Carriers",
  COUNT(DISTINCT payment_period) as "Periods",
  SUM(commission) as "Total Commission"
FROM commission_records
WHERE upload_id = 374;

-- ============================================================
-- NOTES
-- ============================================================
-- 
-- Partition Key: client_full_name + carrier + payment_period + classification
-- 
-- This ensures we only keep one record per unique combination of:
--   - Client name
--   - Carrier
--   - Payment period
--   - Classification (New Business, Renewal, etc.)
-- 
-- The record with the LOWEST ID is kept (first inserted).
-- 
-- Example:
--   Before: MARY RAMAGE | Solis | 202603 | Renewal (ID 1001, 1002, 1003)
--   After:  MARY RAMAGE | Solis | 202603 | Renewal (ID 1001 only)
-- 
-- ============================================================

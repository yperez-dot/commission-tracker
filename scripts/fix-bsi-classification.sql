-- ============================================================
-- Fix BSI/Humana Classification
-- ============================================================
-- Fixes classification for BSI records based on commission amount
-- 
-- Current: All showing "Agency Override"
-- Should be:
--   $300+ → New Business
--   $20-$300 → Renewal
--   <$20 → Agency Override
--   Negative → Chargeback
-- ============================================================

-- ============================================================
-- STEP 1: PREVIEW CHANGES (DRY RUN)
-- ============================================================
-- Shows what will be changed

SELECT 
  id,
  client_full_name as "Client",
  carrier as "Carrier",
  commission as "Commission",
  classification as "Current Classification",
  CASE
    WHEN commission < 0 THEN 'Chargeback'
    WHEN ABS(commission) >= 300 THEN 'New Business'
    WHEN ABS(commission) >= 20 THEN 'Renewal'
    ELSE 'Agency Override'
  END as "New Classification",
  payment_period as "Period"
FROM commission_records
WHERE payee = 'BSI'
  AND classification != CASE
    WHEN commission < 0 THEN 'Chargeback'
    WHEN ABS(commission) >= 300 THEN 'New Business'
    WHEN ABS(commission) >= 20 THEN 'Renewal'
    ELSE 'Agency Override'
  END
ORDER BY commission DESC
LIMIT 50;

-- ============================================================
-- STEP 2: COUNT AFFECTED RECORDS
-- ============================================================

SELECT 
  classification as "Current",
  CASE
    WHEN commission < 0 THEN 'Chargeback'
    WHEN ABS(commission) >= 300 THEN 'New Business'
    WHEN ABS(commission) >= 20 THEN 'Renewal'
    ELSE 'Agency Override'
  END as "Should Be",
  COUNT(*) as "Count",
  SUM(commission) as "Total Commission"
FROM commission_records
WHERE payee = 'BSI'
GROUP BY classification, CASE
    WHEN commission < 0 THEN 'Chargeback'
    WHEN ABS(commission) >= 300 THEN 'New Business'
    WHEN ABS(commission) >= 20 THEN 'Renewal'
    ELSE 'Agency Override'
  END
ORDER BY COUNT(*) DESC;

-- ============================================================
-- STEP 3: APPLY FIX
-- ============================================================
-- ⚠️ ONLY RUN AFTER REVIEWING STEP 1 & 2!

UPDATE commission_records
SET 
  classification = CASE
    WHEN commission < 0 THEN 'Chargeback'
    WHEN ABS(commission) >= 300 THEN 'New Business'
    WHEN ABS(commission) >= 20 THEN 'Renewal'
    ELSE 'Agency Override'
  END,
  updated_at = NOW()
WHERE payee = 'BSI'
  AND classification != CASE
    WHEN commission < 0 THEN 'Chargeback'
    WHEN ABS(commission) >= 300 THEN 'New Business'
    WHEN ABS(commission) >= 20 THEN 'Renewal'
    ELSE 'Agency Override'
  END;

-- Returns count of updated rows

-- ============================================================
-- STEP 4: VERIFY FIXES (Run after update)
-- ============================================================

-- Check distribution after fix
SELECT 
  classification,
  COUNT(*) as count,
  MIN(commission) as min_commission,
  MAX(commission) as max_commission,
  AVG(commission) as avg_commission
FROM commission_records
WHERE payee = 'BSI'
GROUP BY classification
ORDER BY classification;

-- ============================================================
-- STEP 5: SAMPLE RECORDS BY CLASSIFICATION
-- ============================================================

-- New Business samples
SELECT 
  client_full_name, carrier, commission, classification, payment_period
FROM commission_records
WHERE payee = 'BSI' AND classification = 'New Business'
LIMIT 5;

-- Renewal samples  
SELECT 
  client_full_name, carrier, commission, classification, payment_period
FROM commission_records
WHERE payee = 'BSI' AND classification = 'Renewal'
LIMIT 5;

-- Agency Override samples
SELECT 
  client_full_name, carrier, commission, classification, payment_period
FROM commission_records
WHERE payee = 'BSI' AND classification = 'Agency Override'
LIMIT 5;

-- ============================================================
-- NOTES
-- ============================================================
-- 
-- Commission tiers (Humana/Medicare typical):
--   New Business: $300-$400+ (first year commission)
--   Renewal: $25-$100 (ongoing annual renewal)
--   Agency Override: $2-$10 (small override commission)
--   Chargeback: Negative (clawback)
-- 
-- This fix applies to:
--   - BSI PDF statements
--   - BSI Excel statements
--   - Any payee='BSI' records
-- 
-- Future uploads will use correct classification automatically
-- 
-- ============================================================

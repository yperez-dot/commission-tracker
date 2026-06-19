-- ============================================================
-- Fix Humana Direct Classifications (Uploads 254-266)
-- ============================================================
-- Fixes classification for Humana direct statement uploads 254-266
-- based on FrstYrRnwl column stored in raw_data
-- 
-- Parser now reads section headers (NEW BUSINESS, RENEWAL, CHARGEBACK)
-- but existing uploads need classification fixed retroactively
-- ============================================================

-- ============================================================
-- STEP 1: PREVIEW AFFECTED RECORDS
-- ============================================================

SELECT 
  cr.id,
  cr.upload_id,
  u.original_name as "Upload File",
  cr.client_full_name as "Client",
  cr.commission as "Commission",
  cr.classification as "Current Classification",
  cr.raw_data->>'FrstYrRnwl' as "FYR Column",
  CASE
    WHEN cr.commission < 0 THEN 'Chargeback'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'F' THEN 'New Business'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'R' THEN 'Renewal'
    ELSE 'Agent Commission'
  END as "Should Be"
FROM commission_records cr
JOIN uploads u ON u.id = cr.upload_id
WHERE cr.carrier = 'Humana'
  AND cr.payee = 'Humana'
  AND cr.upload_id BETWEEN 254 AND 266
  AND cr.classification != CASE
    WHEN cr.commission < 0 THEN 'Chargeback'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'F' THEN 'New Business'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'R' THEN 'Renewal'
    ELSE 'Agent Commission'
  END
ORDER BY cr.upload_id, cr.id
LIMIT 50;

-- ============================================================
-- STEP 2: COUNT BY CLASSIFICATION
-- ============================================================

SELECT 
  cr.classification as "Current",
  CASE
    WHEN cr.commission < 0 THEN 'Chargeback'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'F' THEN 'New Business'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'R' THEN 'Renewal'
    ELSE 'Agent Commission'
  END as "Should Be",
  COUNT(*) as "Count",
  SUM(cr.commission) as "Total Commission"
FROM commission_records cr
WHERE cr.carrier = 'Humana'
  AND cr.payee = 'Humana'
  AND cr.upload_id BETWEEN 254 AND 266
GROUP BY 
  cr.classification,
  CASE
    WHEN cr.commission < 0 THEN 'Chargeback'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'F' THEN 'New Business'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'R' THEN 'Renewal'
    ELSE 'Agent Commission'
  END
ORDER BY COUNT(*) DESC;

-- ============================================================
-- STEP 3: IDENTIFY AFFECTED UPLOADS
-- ============================================================

SELECT 
  u.id as "Upload ID",
  u.original_name as "Filename",
  u.created_at as "Uploaded",
  COUNT(cr.id) as "Total Records",
  COUNT(CASE WHEN cr.classification != CASE
    WHEN cr.commission < 0 THEN 'Chargeback'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'F' THEN 'New Business'
    WHEN cr.raw_data->>'FrstYrRnwl' = 'R' THEN 'Renewal'
    ELSE 'Agent Commission'
  END THEN 1 END) as "Needs Fix"
FROM uploads u
JOIN commission_records cr ON cr.upload_id = u.id
WHERE u.id BETWEEN 254 AND 266
  AND cr.carrier = 'Humana'
  AND cr.payee = 'Humana'
GROUP BY u.id, u.original_name, u.created_at
ORDER BY u.id;

-- ============================================================
-- STEP 4: APPLY FIX
-- ============================================================
-- ⚠️ ONLY RUN AFTER REVIEWING STEPS 1-3!

UPDATE commission_records
SET 
  classification = CASE
    WHEN commission < 0 THEN 'Chargeback'
    WHEN raw_data->>'FrstYrRnwl' = 'F' THEN 'New Business'
    WHEN raw_data->>'FrstYrRnwl' = 'R' THEN 'Renewal'
    ELSE 'Agent Commission'
  END,
  updated_at = NOW()
WHERE carrier = 'Humana'
  AND payee = 'Humana'
  AND upload_id BETWEEN 254 AND 266
  AND classification != CASE
    WHEN commission < 0 THEN 'Chargeback'
    WHEN raw_data->>'FrstYrRnwl' = 'F' THEN 'New Business'
    WHEN raw_data->>'FrstYrRnwl' = 'R' THEN 'Renewal'
    ELSE 'Agent Commission'
  END;

-- Returns count of updated rows

-- ============================================================
-- STEP 5: VERIFY FIXES (Run after update)
-- ============================================================

-- Check distribution by classification
SELECT 
  classification,
  COUNT(*) as "Count",
  MIN(commission) as "Min",
  MAX(commission) as "Max",
  AVG(commission) as "Avg"
FROM commission_records
WHERE carrier = 'Humana'
  AND payee = 'Humana'
  AND upload_id BETWEEN 254 AND 266
GROUP BY classification
ORDER BY classification;

-- Sample records by classification
SELECT 
  classification,
  client_full_name,
  commission,
  raw_data->>'FrstYrRnwl' as fyr,
  payment_period,
  upload_id
FROM commission_records
WHERE carrier = 'Humana'
  AND payee = 'Humana'
  AND upload_id BETWEEN 254 AND 266
ORDER BY classification, upload_id
LIMIT 20;

-- ============================================================
-- NOTES
-- ============================================================
-- 
-- Classification logic:
--   1. Negative commission → Chargeback
--   2. FrstYrRnwl = 'F' → New Business
--   3. FrstYrRnwl = 'R' → Renewal
--   4. Default → Agent Commission
-- 
-- This matches the parser's fallback logic when section headers
-- are not present in the Excel file.
-- 
-- Future Humana uploads will use section header tracking:
--   - Parser reads "NEW BUSINESS", "RENEWAL", "CHARGEBACK" rows
--   - Tracks currentSection and applies to subsequent data rows
--   - Falls back to FrstYrRnwl column if no section header found
-- 
-- ============================================================

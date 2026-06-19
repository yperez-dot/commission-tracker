-- ============================================================
-- Diagnose UHC PartD Mystery
-- ============================================================
-- WHY do 0 PartD records exist despite parser having detection?
-- Three possibilities:
-- 1. Parser detection failing silently
-- 2. Duplicate detection blocking them
-- 3. Records saved with wrong LOB/hiding
-- ============================================================

-- ============================================================
-- 1. CHECK RAW DATA IN UPLOADS
-- ============================================================
-- Look at raw_data from UHC uploads to see if PartD is in the data

SELECT 
  cr.id,
  cr.upload_id,
  cr.client_full_name,
  cr.plan_type,
  cr.lob,
  cr.commission,
  cr.raw_data::json->>'Plan Type' as raw_plan_type,
  cr.raw_data::json->>'Commission Action' as raw_comm_action
FROM commission_records cr
WHERE cr.upload_id IN (318, 319, 320, 321, 322, 323, 324, 325, 332, 333)
  AND (
    cr.raw_data::text ILIKE '%partd%'
    OR cr.raw_data::text ILIKE '%part d%'
    OR cr.raw_data::text ILIKE '%pdp%'
  )
LIMIT 20;

-- ============================================================
-- 2. CHECK ALL UHC RECORDS BY PLAN_TYPE
-- ============================================================
-- See what plan_type values exist for UHC

SELECT 
  plan_type as "Plan Type",
  lob as "LOB",
  COUNT(*) as "Count",
  SUM(commission) as "Total Commission"
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
GROUP BY plan_type, lob
ORDER BY COUNT(*) DESC;

-- ============================================================
-- 3. CHECK IF ANY PDP/PARTD IN PLAN_TYPE STRING
-- ============================================================
-- Case-insensitive search for PartD variants

SELECT 
  id,
  client_full_name as "Client",
  plan_type as "Plan Type",
  lob as "Current LOB",
  commission as "Commission",
  payment_period as "Period",
  upload_id as "Upload"
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
  AND (
    plan_type ILIKE '%partd%'
    OR plan_type ILIKE '%part d%'
    OR plan_type ILIKE '%pdp%'
  )
LIMIT 50;

-- ============================================================
-- 4. CHECK UPLOAD FILE CONTENTS (raw_data Plan Type values)
-- ============================================================
-- Extract distinct Plan Type values from raw_data

SELECT DISTINCT
  upload_id,
  raw_data::json->>'Plan Type' as plan_type_raw,
  COUNT(*) as count
FROM commission_records
WHERE upload_id IN (318, 319, 320, 321, 322, 323, 324, 325, 332, 333)
  AND raw_data IS NOT NULL
GROUP BY upload_id, raw_data::json->>'Plan Type'
ORDER BY upload_id, count DESC;

-- ============================================================
-- 5. CHECK MISSING/FILTERED RECORDS
-- ============================================================
-- Did any records get filtered out during upload?

SELECT 
  u.id,
  u.original_name,
  u.row_count as "Rows Uploaded",
  COUNT(cr.id) as "Records in DB",
  u.row_count - COUNT(cr.id) as "Missing Records"
FROM uploads u
LEFT JOIN commission_records cr ON cr.upload_id = u.id
WHERE u.id IN (318, 319, 320, 321, 322, 323, 324, 325, 332, 333)
GROUP BY u.id, u.original_name, u.row_count
ORDER BY u.id;

-- ============================================================
-- 6. CHECK IF THEY WERE MARKED AS DUPLICATES
-- ============================================================
-- Search for any UHC clients that might be PartD in BOB

SELECT 
  b.client_full_name,
  b.carrier,
  b.plan_type,
  b.effective_date,
  COUNT(cr.id) as commission_record_count
FROM book_of_business b
LEFT JOIN commission_records cr ON (
  LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(cr.client_full_name))
  AND LOWER(TRIM(b.carrier)) = LOWER(TRIM(cr.carrier))
)
WHERE b.carrier = 'UnitedHealthcare'
  AND (
    b.plan_type ILIKE '%partd%'
    OR b.plan_type ILIKE '%pdp%'
  )
GROUP BY b.client_full_name, b.carrier, b.plan_type, b.effective_date
ORDER BY b.client_full_name;

-- ============================================================
-- 7. CHECK CLASSIFICATION DISTRIBUTION
-- ============================================================
-- Are PartD records hiding under wrong classification?

SELECT 
  classification,
  lob,
  COUNT(*) as count
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
GROUP BY classification, lob
ORDER BY count DESC;

-- ============================================================
-- DIAGNOSTIC SUMMARY
-- ============================================================
-- Run all queries above and look for:
-- 
-- Query 1: Do PartD values exist in raw_data?
--   YES → Parser is skipping them (bug in parseUHCRows)
--   NO → PartD records don't exist in uploaded files
-- 
-- Query 2: What plan_type values exist?
--   Look for: "PARTD", "PartD", "Part D", "PDP"
-- 
-- Query 3: Any records with PartD in plan_type?
--   YES → They exist but have wrong LOB
--   NO → Records never made it to database
-- 
-- Query 4: What Plan Type values are in raw uploads?
--   Shows exactly what was in the Excel files
-- 
-- Query 5: Missing records count
--   Shows if records were filtered during upload
-- 
-- Query 6: PartD in BOB but not in commission_records?
--   Shows if duplicate detection blocked them
-- 
-- Query 7: Classification patterns
--   Shows if they're hiding under wrong classification
-- 
-- ============================================================

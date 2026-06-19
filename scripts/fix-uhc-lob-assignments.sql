-- ============================================================
-- Fix UHC LOB Assignments
-- ============================================================
-- Fixes LOB for UHC Supplement and PartD records
-- 
-- Problem:
-- 1. AARPMODMEDSUP records have LOB = MA (should be MedSupp)
-- 2. PartD records have LOB = MA or NULL (should be PDP)
-- 
-- This affects Missing Renewals accuracy - MA and Supplement
-- renewals work differently
-- ============================================================

-- ============================================================
-- STEP 1: IDENTIFY MISCLASSIFIED RECORDS (DRY RUN)
-- ============================================================

-- A. UHC Supplement records showing as MA
SELECT 
  id,
  client_full_name as "Client",
  plan_type as "Plan Type",
  lob as "Current LOB",
  'MedSupp' as "Should Be LOB",
  commission as "Commission",
  payment_period as "Period"
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
  AND (
    plan_type ILIKE '%Med Supp%'
    OR plan_type ILIKE '%MedSupp%'
    OR plan_type ILIKE '%Medigap%'
    OR plan_type ILIKE '%Supplement%'
    OR plan_type ILIKE '%MODMEDSUP%'
  )
  AND (lob != 'MedSupp' OR lob IS NULL)
ORDER BY payment_period DESC, client_full_name
LIMIT 50;

-- B. UHC PartD records showing as MA or NULL
SELECT 
  id,
  client_full_name as "Client",
  plan_type as "Plan Type",
  lob as "Current LOB",
  'PDP' as "Should Be LOB",
  commission as "Commission",
  payment_period as "Period"
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
  AND (
    plan_type ILIKE '%PDP%'
    OR plan_type ILIKE '%PartD%'
    OR plan_type ILIKE '%Part D%'
  )
  AND (lob != 'PDP' OR lob IS NULL)
ORDER BY payment_period DESC, client_full_name
LIMIT 50;

-- ============================================================
-- STEP 2: COUNT AFFECTED RECORDS
-- ============================================================

SELECT 
  'Supplement (wrong LOB)' as record_type,
  COUNT(*) as count,
  SUM(commission) as total_commission
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
  AND (
    plan_type ILIKE '%Med Supp%'
    OR plan_type ILIKE '%MedSupp%'
    OR plan_type ILIKE '%Medigap%'
    OR plan_type ILIKE '%Supplement%'
    OR plan_type ILIKE '%MODMEDSUP%'
  )
  AND (lob != 'MedSupp' OR lob IS NULL)

UNION ALL

SELECT 
  'PartD (wrong LOB)' as record_type,
  COUNT(*) as count,
  SUM(commission) as total_commission
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
  AND (
    plan_type ILIKE '%PDP%'
    OR plan_type ILIKE '%PartD%'
    OR plan_type ILIKE '%Part D%'
  )
  AND (lob != 'PDP' OR lob IS NULL);

-- ============================================================
-- STEP 3: FIX SUPPLEMENT RECORDS (APPLY)
-- ============================================================
-- ⚠️ ONLY RUN AFTER REVIEWING STEP 1 RESULTS!

UPDATE commission_records
SET lob = 'MedSupp',
    updated_at = NOW()
WHERE carrier = 'UnitedHealthcare'
  AND (
    plan_type ILIKE '%Med Supp%'
    OR plan_type ILIKE '%MedSupp%'
    OR plan_type ILIKE '%Medigap%'
    OR plan_type ILIKE '%Supplement%'
    OR plan_type ILIKE '%MODMEDSUP%'
  )
  AND (lob != 'MedSupp' OR lob IS NULL);

-- Returns count of updated rows

-- ============================================================
-- STEP 4: FIX PARTD RECORDS (APPLY)
-- ============================================================
-- ⚠️ ONLY RUN AFTER REVIEWING STEP 1 RESULTS!

UPDATE commission_records
SET lob = 'PDP',
    updated_at = NOW()
WHERE carrier = 'UnitedHealthcare'
  AND (
    plan_type ILIKE '%PDP%'
    OR plan_type ILIKE '%PartD%'
    OR plan_type ILIKE '%Part D%'
  )
  AND (lob != 'PDP' OR lob IS NULL);

-- Returns count of updated rows

-- ============================================================
-- STEP 5: VERIFY FIXES (Run after updates)
-- ============================================================

-- Should return 0 rows if all fixed
SELECT 
  'Supplement (still wrong)' as issue,
  COUNT(*) as count
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
  AND (plan_type ILIKE '%Med Supp%' OR plan_type ILIKE '%MODMEDSUP%' OR plan_type ILIKE '%Supplement%')
  AND (lob != 'MedSupp' OR lob IS NULL)

UNION ALL

SELECT 
  'PartD (still wrong)' as issue,
  COUNT(*) as count
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
  AND (plan_type ILIKE '%PDP%' OR plan_type ILIKE '%PartD%')
  AND (lob != 'PDP' OR lob IS NULL);

-- ============================================================
-- STEP 6: SUMMARY BY LOB (After fixes)
-- ============================================================

SELECT 
  lob as "LOB",
  COUNT(*) as "Record Count",
  COUNT(DISTINCT client_full_name) as "Unique Clients",
  SUM(commission) as "Total Commission"
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
GROUP BY lob
ORDER BY COUNT(*) DESC;

-- ============================================================
-- NOTES
-- ============================================================
-- 
-- Why this matters:
-- - Supplement clients (Medigap) are NOT Medicare Advantage
-- - They shouldn't appear in MA Missing Renewals checks
-- - Renewal patterns differ: MA = monthly, Supplement = varies
-- - PartD is prescription drug coverage, separate from MA
-- 
-- Affected clients:
-- - Castro-Smith, Kilgore, Pinter, Proenca, Shaw (Supplement)
-- - Multiple PartD clients (to be identified)
-- 
-- Plan types fixed:
-- - AARPMODMEDSUP → MedSupp
-- - UnitedHealthcare Med Supp → MedSupp
-- - PARTD / PartD → PDP
-- - UnitedHealthcare PDP → PDP
-- 
-- ============================================================

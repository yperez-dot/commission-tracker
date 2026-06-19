-- ============================================================
-- Fix 14 Humana BOB Name Mismatches
-- ============================================================
-- Updates BOB client names to match commission_records format
-- All are Yahoska Perez / Humana
-- Pattern: "FIRST LAST" in BOB → "LAST FIRST" in commission_records
-- ============================================================

-- ============================================================
-- STEP 1: FIND MATCHES (DRY RUN)
-- ============================================================
-- Shows what names will be updated

WITH bob_clients AS (
  SELECT 
    b.id,
    b.client_full_name as bob_name,
    b.carrier,
    b.agent_name
  FROM book_of_business b
  WHERE b.client_full_name IN (
    'ELIZABETH SCHWAB GAERTNER',
    'GLADYS MARCIANO',
    'GLORIA BUSTOS MENA',
    'HECTOR PROANO ALCIVAR',
    'JORGE CASTILLO',
    'KIMBERLY JANISZEWSKI',
    'MARIA DOMINGUEZ',
    'MARTHA MURAGLIA',
    'PATRICIA ECHENIQUE YUSTI',
    'RAMON GOMEZ',
    'ROGER MESSER',
    'SILVIA RIORDA',
    'TIM WOODCOCK',
    'VICTOR SANCHEZ'
  )
  AND b.carrier = 'Humana'
  AND LOWER(b.agent_name) LIKE '%yahoska%'
  AND b.status = 'active'
),
commission_matches AS (
  SELECT DISTINCT ON (bc.id)
    bc.id,
    bc.bob_name,
    cr.client_full_name as commission_name,
    cr.policy_number,
    cr.commission,
    cr.payment_period
  FROM bob_clients bc
  INNER JOIN commission_records cr ON (
    LOWER(TRIM(bc.carrier)) = LOWER(TRIM(cr.carrier))
    AND LOWER(TRIM(bc.agent_name)) = LOWER(TRIM(cr.agent_name))
    AND (
      -- Try reversed format: "FIRST LAST" → "LAST FIRST"
      LOWER(TRIM(
        SPLIT_PART(bc.bob_name, ' ', -1) || ' ' || 
        REGEXP_REPLACE(bc.bob_name, '\s+\S+$', '')
      )) = LOWER(TRIM(cr.client_full_name))
      OR
      -- Try simple two-part reverse: "FIRST LAST" → "LAST FIRST"
      (POSITION(' ' IN TRIM(bc.bob_name)) > 0 
       AND LOWER(TRIM(
         SPLIT_PART(bc.bob_name, ' ', 2) || ' ' || SPLIT_PART(bc.bob_name, ' ', 1)
       )) = LOWER(TRIM(cr.client_full_name)))
      OR
      -- Try three-part: "FIRST MIDDLE LAST" → "LAST FIRST MIDDLE"
      (LENGTH(bc.bob_name) - LENGTH(REPLACE(bc.bob_name, ' ', '')) >= 2
       AND LOWER(REPLACE(bc.bob_name, ' ', '')) = LOWER(REPLACE(cr.client_full_name, ' ', '')))
    )
    AND cr.commission > 0
  )
  ORDER BY bc.id, cr.created_at DESC
)
SELECT 
  id as "BOB ID",
  bob_name as "Current BOB Name",
  commission_name as "Commission Records Name",
  policy_number as "Policy #",
  '$' || commission as "Commission",
  payment_period as "Period"
FROM commission_matches
ORDER BY bob_name;

-- ============================================================
-- STEP 2: MANUAL SEARCH (if Step 1 doesn't find all matches)
-- ============================================================
-- Search commission_records for each name individually

-- ELIZABETH SCHWAB GAERTNER
SELECT 
  client_full_name,
  policy_number,
  commission,
  payment_period
FROM commission_records
WHERE carrier = 'Humana'
  AND LOWER(agent_name) LIKE '%yahoska%'
  AND (
    LOWER(client_full_name) LIKE '%schwab%'
    OR LOWER(client_full_name) LIKE '%gaertner%'
  )
  AND commission > 0
ORDER BY created_at DESC
LIMIT 5;

-- GLADYS MARCIANO
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%marciano%' AND commission > 0
LIMIT 5;

-- GLORIA BUSTOS MENA
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND (LOWER(client_full_name) LIKE '%bustos%' OR LOWER(client_full_name) LIKE '%mena%')
  AND commission > 0
LIMIT 5;

-- HECTOR PROANO ALCIVAR
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND (LOWER(client_full_name) LIKE '%proano%' OR LOWER(client_full_name) LIKE '%alcivar%')
  AND commission > 0
LIMIT 5;

-- JORGE CASTILLO
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%castillo%' AND commission > 0
LIMIT 5;

-- KIMBERLY JANISZEWSKI
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%janiszewski%' AND commission > 0
LIMIT 5;

-- MARIA DOMINGUEZ
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%dominguez%' AND commission > 0
LIMIT 5;

-- MARTHA MURAGLIA
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%muraglia%' AND commission > 0
LIMIT 5;

-- PATRICIA ECHENIQUE YUSTI
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND (LOWER(client_full_name) LIKE '%echenique%' OR LOWER(client_full_name) LIKE '%yusti%')
  AND commission > 0
LIMIT 5;

-- RAMON GOMEZ
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%gomez%' AND commission > 0
LIMIT 5;

-- ROGER MESSER
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%messer%' AND commission > 0
LIMIT 5;

-- SILVIA RIORDA
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%riorda%' AND commission > 0
LIMIT 5;

-- TIM WOODCOCK
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%woodcock%' AND commission > 0
LIMIT 5;

-- VICTOR SANCHEZ
SELECT client_full_name, policy_number, commission FROM commission_records
WHERE carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%'
  AND LOWER(client_full_name) LIKE '%sanchez%' AND commission > 0
LIMIT 5;

-- ============================================================
-- STEP 3: UPDATE BOB NAMES (APPLY)
-- ============================================================
-- ⚠️ ONLY RUN AFTER REVIEWING STEP 1 OR STEP 2 RESULTS!
-- Updates BOB client_full_name to match commission_records

-- Template for each update:
-- UPDATE book_of_business
-- SET client_full_name = '[CORRECT NAME FROM COMMISSION_RECORDS]',
--     updated_at = NOW()
-- WHERE client_full_name = '[CURRENT BOB NAME]'
--   AND carrier = 'Humana'
--   AND LOWER(agent_name) LIKE '%yahoska%'
--   AND status = 'active';

-- After finding matches in STEP 1 or STEP 2, manually build UPDATE statements
-- Example:
-- UPDATE book_of_business
-- SET client_full_name = 'MARCIANO GLADYS', updated_at = NOW()
-- WHERE client_full_name = 'GLADYS MARCIANO'
--   AND carrier = 'Humana' AND LOWER(agent_name) LIKE '%yahoska%' AND status = 'active';

-- ============================================================
-- STEP 4: RECALCULATE COMMISSIONS (Run after updates)
-- ============================================================
-- Updates last_commission_amount and last_commission_date

UPDATE book_of_business b
SET 
  last_commission_amount = subq.max_commission,
  last_commission_date = TO_DATE(subq.max_period, 'YYYYMM'),
  updated_at = NOW()
FROM (
  SELECT 
    cr.client_full_name, 
    cr.carrier,
    cr.agent_name,
    MAX(cr.commission) as max_commission,
    MAX(cr.payment_period) as max_period
  FROM commission_records cr
  WHERE cr.commission > 0
    AND cr.carrier = 'Humana'
    AND LOWER(cr.agent_name) LIKE '%yahoska%'
  GROUP BY cr.client_full_name, cr.carrier, cr.agent_name
) subq
WHERE LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(subq.client_full_name))
  AND LOWER(TRIM(b.carrier)) = LOWER(TRIM(subq.carrier))
  AND LOWER(TRIM(b.agent_name)) = LOWER(TRIM(subq.agent_name))
  AND b.status = 'active'
  AND b.client_full_name IN (
    'ELIZABETH SCHWAB GAERTNER',
    'GLADYS MARCIANO',
    'GLORIA BUSTOS MENA',
    'HECTOR PROANO ALCIVAR',
    'JORGE CASTILLO',
    'KIMBERLY JANISZEWSKI',
    'MARIA DOMINGUEZ',
    'MARTHA MURAGLIA',
    'PATRICIA ECHENIQUE YUSTI',
    'RAMON GOMEZ',
    'ROGER MESSER',
    'SILVIA RIORDA',
    'TIM WOODCOCK',
    'VICTOR SANCHEZ'
  );

-- ============================================================
-- NOTES
-- ============================================================
-- 
-- Process:
-- 1. Run STEP 1 to see automated matches
-- 2. If some don't match, run STEP 2 queries individually
-- 3. Build UPDATE statements for STEP 3 based on findings
-- 4. Run STEP 4 to recalculate commission amounts
-- 
-- Safety:
-- - Updates only by exact name + carrier + agent match
-- - Won't create new records
-- - Only affects the 14 specified clients
-- 
-- ============================================================

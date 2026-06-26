-- Bug #1 Verification: Compound Surname Fix Impact
-- Run this to see before/after on the 88 missing overrides

-- STEP 1: Check how many of the 88 have compound surnames (should match better now)
SELECT 
  'Compound surname clients in 88 missing' as check_type,
  COUNT(*) as count
FROM agency_production ap
LEFT JOIN commission_records cr ON (
  LOWER(TRIM(ap.client_name)) = LOWER(TRIM(cr.client_full_name)) AND
  LOWER(TRIM(ap.carrier)) = LOWER(TRIM(cr.carrier))
)
WHERE ap.upload_batch = (SELECT MAX(upload_batch) FROM agency_production)
  AND cr.id IS NULL  -- Missing (no match found)
  AND ap.client_name LIKE '% %'  -- Has space (potential compound surname)
  AND ap.client_name NOT LIKE '%,%';  -- Not already in LAST, FIRST format

-- STEP 2: List specific compound surname cases from Katy's audit
WITH compound_names AS (
  SELECT unnest(ARRAY[
    'VAZQUEZ VELEZ',
    'REYES DE GATON',
    'CONSUEGRA MADRAZO',
    'TRIVINO PIN',
    'HERNANDEZ OLARTE',
    'GUERRERO MORALES',
    'WILLS ROMERO',
    'CARDELLA CARTAYA',
    'CARMONA MAQUEIRA',
    'HIDALGO HIDALGO'
  ]) as surname_pattern
)
SELECT 
  'Katy audit compound surnames - matched now?' as check_type,
  ap.client_name,
  ap.carrier,
  ap.agent,
  CASE 
    WHEN cr.id IS NOT NULL THEN 'MATCHED ✅'
    ELSE 'STILL MISSING ❌'
  END as match_status,
  cr.commission as override_amount
FROM agency_production ap
CROSS JOIN compound_names
LEFT JOIN commission_records cr ON (
  (LOWER(TRIM(ap.client_name)) LIKE '%' || LOWER(compound_names.surname_pattern) || '%') AND
  LOWER(TRIM(ap.carrier)) = LOWER(TRIM(cr.carrier))
)
WHERE ap.upload_batch = (SELECT MAX(upload_batch) FROM agency_production)
ORDER BY match_status, ap.client_name;

-- STEP 3: Before/After count comparison
-- (Run this AFTER deploying Bug #1 fix to see improvement)
WITH recent_production AS (
  SELECT *
  FROM agency_production
  WHERE upload_batch = (SELECT MAX(upload_batch) FROM agency_production)
),
matched AS (
  SELECT 
    ap.*,
    cr.commission as override_paid
  FROM recent_production ap
  LEFT JOIN commission_records cr ON (
    -- Using NEW normName() logic (compound surname aware)
    -- This is a simulation - actual frontend/backend needs to run with new code
    CASE 
      WHEN ap.client_name LIKE '%,%' THEN
        -- LAST, FIRST format: extract properly
        CONCAT(
          TRIM(SUBSTRING(ap.client_name FROM POSITION(',' IN ap.client_name) + 1)),
          ' ',
          TRIM(SUBSTRING(ap.client_name FROM 1 FOR POSITION(',' IN ap.client_name) - 1))
        )
      ELSE
        ap.client_name
    END = 
    CASE 
      WHEN cr.client_full_name LIKE '%,%' THEN
        CONCAT(
          TRIM(SUBSTRING(cr.client_full_name FROM POSITION(',' IN cr.client_full_name) + 1)),
          ' ',
          TRIM(SUBSTRING(cr.client_full_name FROM 1 FOR POSITION(',' IN cr.client_full_name) - 1))
        )
      ELSE
        cr.client_full_name
    END
    AND LOWER(TRIM(ap.carrier)) = LOWER(TRIM(cr.carrier))
  )
)
SELECT 
  'Bug #1 Fix Impact Summary' as report,
  COUNT(*) FILTER (WHERE override_paid IS NOT NULL) as now_matched,
  COUNT(*) FILTER (WHERE override_paid IS NULL) as still_missing,
  COUNT(*) as total
FROM matched;

-- STEP 4: Show specific improvements (clients that NOW match after fix)
-- This requires comparing to a snapshot BEFORE the fix was deployed
-- Manual check: Look for names like "VAZQUEZ VELEZ, AIDA" in agency_production
SELECT 
  'Newly matched after Bug #1' as improvement,
  ap.client_name,
  ap.carrier,
  ap.agent,
  cr.commission as override_amount,
  cr.payment_period
FROM agency_production ap
INNER JOIN commission_records cr ON (
  -- Simulate compound surname matching
  LOWER(REPLACE(ap.client_name, ',', '')) = LOWER(REPLACE(cr.client_full_name, ',', ''))
  AND LOWER(TRIM(ap.carrier)) = LOWER(TRIM(cr.carrier))
)
WHERE ap.upload_batch = (SELECT MAX(upload_batch) FROM agency_production)
  AND (
    ap.client_name LIKE '%VAZQUEZ VELEZ%' OR
    ap.client_name LIKE '%REYES DE GATON%' OR
    ap.client_name LIKE '%CONSUEGRA MADRAZO%' OR
    ap.client_name LIKE '%TRIVINO PIN%' OR
    ap.client_name LIKE '%HERNANDEZ OLARTE%'
  )
LIMIT 20;

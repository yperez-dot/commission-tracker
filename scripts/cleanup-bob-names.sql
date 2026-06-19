-- ============================================================
-- BOB Name Cleanup - SQL Version
-- ============================================================
-- Fixes BOB client names that don't match commission_records format
-- Run DRY RUN first to preview changes, then run UPDATE to apply
-- ============================================================

-- ============================================================
-- STEP 1: DRY RUN - Preview what names would be updated
-- ============================================================
-- Shows BOB clients with $0 commission that have matches in commission_records
-- Reviews matches before applying updates

WITH potential_matches AS (
  SELECT DISTINCT ON (b.id, cr.client_full_name)
    b.id,
    b.client_full_name as bob_name,
    cr.client_full_name as commission_name,
    b.carrier,
    b.agent_name,
    cr.policy_number,
    cr.commission,
    CASE
      -- Exact match (shouldn't happen since bob has $0)
      WHEN LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(cr.client_full_name)) THEN 'exact'
      
      -- Reversed format: "John Smith" matches "Smith, John"
      WHEN LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(
        SPLIT_PART(cr.client_full_name, ',', 2) || ' ' || SPLIT_PART(cr.client_full_name, ',', 1)
      )) THEN 'reversed_comma'
      
      -- Reversed format: "John Smith" matches "Smith John" (no comma)
      WHEN POSITION(' ' IN TRIM(b.client_full_name)) > 0 
        AND POSITION(' ' IN TRIM(cr.client_full_name)) > 0
        AND LOWER(TRIM(
          SPLIT_PART(b.client_full_name, ' ', 2) || ' ' || SPLIT_PART(b.client_full_name, ' ', 1)
        )) = LOWER(TRIM(cr.client_full_name)) THEN 'reversed_space'
      
      -- Remove spaces and compare (handles middle initials, extra spaces)
      WHEN LOWER(REPLACE(b.client_full_name, ' ', '')) = LOWER(REPLACE(cr.client_full_name, ' ', '')) THEN 'no_spaces'
      
      ELSE 'no_match'
    END as match_type
  FROM book_of_business b
  INNER JOIN commission_records cr ON (
    LOWER(TRIM(b.carrier)) = LOWER(TRIM(cr.carrier))
    AND LOWER(TRIM(b.agent_name)) = LOWER(TRIM(cr.agent_name))
    AND cr.commission > 0
  )
  WHERE b.status = 'active'
    AND (b.last_commission_amount = 0 OR b.last_commission_amount IS NULL)
    AND b.carrier = 'Humana'  -- Change carrier filter here or remove line for all carriers
    AND b.client_full_name != cr.client_full_name  -- Only show different names
  ORDER BY b.id, cr.client_full_name, cr.created_at DESC
)
SELECT 
  id,
  bob_name as "Current BOB Name",
  commission_name as "Commission Records Name",
  carrier as "Carrier",
  agent_name as "Agent",
  policy_number as "Policy #",
  '$' || commission as "Commission",
  match_type as "Match Type"
FROM potential_matches
WHERE match_type != 'no_match'
ORDER BY carrier, agent_name, bob_name;

-- ============================================================
-- STEP 2: COUNT - How many records will be updated?
-- ============================================================

WITH potential_matches AS (
  SELECT DISTINCT ON (b.id)
    b.id,
    b.client_full_name as bob_name,
    cr.client_full_name as commission_name,
    CASE
      WHEN LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(cr.client_full_name)) THEN 'exact'
      WHEN LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(
        SPLIT_PART(cr.client_full_name, ',', 2) || ' ' || SPLIT_PART(cr.client_full_name, ',', 1)
      )) THEN 'reversed_comma'
      WHEN POSITION(' ' IN TRIM(b.client_full_name)) > 0 
        AND POSITION(' ' IN TRIM(cr.client_full_name)) > 0
        AND LOWER(TRIM(
          SPLIT_PART(b.client_full_name, ' ', 2) || ' ' || SPLIT_PART(b.client_full_name, ' ', 1)
        )) = LOWER(TRIM(cr.client_full_name)) THEN 'reversed_space'
      WHEN LOWER(REPLACE(b.client_full_name, ' ', '')) = LOWER(REPLACE(cr.client_full_name, ' ', '')) THEN 'no_spaces'
      ELSE 'no_match'
    END as match_type
  FROM book_of_business b
  INNER JOIN commission_records cr ON (
    LOWER(TRIM(b.carrier)) = LOWER(TRIM(cr.carrier))
    AND LOWER(TRIM(b.agent_name)) = LOWER(TRIM(cr.agent_name))
    AND cr.commission > 0
  )
  WHERE b.status = 'active'
    AND (b.last_commission_amount = 0 OR b.last_commission_amount IS NULL)
    AND b.carrier = 'Humana'  -- Change carrier filter here or remove line for all carriers
    AND b.client_full_name != cr.client_full_name
  ORDER BY b.id, cr.created_at DESC
)
SELECT 
  COUNT(*) as total_updates,
  COUNT(CASE WHEN match_type = 'reversed_comma' THEN 1 END) as reversed_comma_matches,
  COUNT(CASE WHEN match_type = 'reversed_space' THEN 1 END) as reversed_space_matches,
  COUNT(CASE WHEN match_type = 'no_spaces' THEN 1 END) as no_spaces_matches
FROM potential_matches
WHERE match_type != 'no_match';

-- ============================================================
-- STEP 3: UPDATE - Apply the name corrections
-- ============================================================
-- ⚠️ ONLY RUN THIS AFTER REVIEWING THE DRY RUN RESULTS ABOVE!
-- ⚠️ This will modify the book_of_business table

WITH potential_matches AS (
  SELECT DISTINCT ON (b.id)
    b.id,
    cr.client_full_name as new_name,
    CASE
      WHEN LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(cr.client_full_name)) THEN 'exact'
      WHEN LOWER(TRIM(b.client_full_name)) = LOWER(TRIM(
        SPLIT_PART(cr.client_full_name, ',', 2) || ' ' || SPLIT_PART(cr.client_full_name, ',', 1)
      )) THEN 'reversed_comma'
      WHEN POSITION(' ' IN TRIM(b.client_full_name)) > 0 
        AND POSITION(' ' IN TRIM(cr.client_full_name)) > 0
        AND LOWER(TRIM(
          SPLIT_PART(b.client_full_name, ' ', 2) || ' ' || SPLIT_PART(b.client_full_name, ' ', 1)
        )) = LOWER(TRIM(cr.client_full_name)) THEN 'reversed_space'
      WHEN LOWER(REPLACE(b.client_full_name, ' ', '')) = LOWER(REPLACE(cr.client_full_name, ' ', '')) THEN 'no_spaces'
      ELSE 'no_match'
    END as match_type
  FROM book_of_business b
  INNER JOIN commission_records cr ON (
    LOWER(TRIM(b.carrier)) = LOWER(TRIM(cr.carrier))
    AND LOWER(TRIM(b.agent_name)) = LOWER(TRIM(cr.agent_name))
    AND cr.commission > 0
  )
  WHERE b.status = 'active'
    AND (b.last_commission_amount = 0 OR b.last_commission_amount IS NULL)
    AND b.carrier = 'Humana'  -- Change carrier filter here or remove line for all carriers
    AND b.client_full_name != cr.client_full_name
  ORDER BY b.id, cr.created_at DESC
)
UPDATE book_of_business
SET 
  client_full_name = potential_matches.new_name,
  updated_at = NOW()
FROM potential_matches
WHERE book_of_business.id = potential_matches.id
  AND potential_matches.match_type != 'no_match';

-- Returns count of rows updated

-- ============================================================
-- STEP 4: VERIFY - Check that updates worked
-- ============================================================
-- Run this after the UPDATE to confirm changes

SELECT 
  client_full_name,
  carrier,
  agent_name,
  last_commission_amount,
  last_commission_date,
  updated_at
FROM book_of_business
WHERE carrier = 'Humana'
  AND status = 'active'
  AND updated_at > NOW() - INTERVAL '5 minutes'
ORDER BY updated_at DESC;

-- ============================================================
-- NOTES
-- ============================================================
-- 
-- To use for different carriers, change this line in each query:
--   AND b.carrier = 'Humana'
-- 
-- To run for ALL carriers, remove the carrier filter line entirely
-- 
-- Match types explained:
--   - reversed_comma: "John Smith" → "Smith, John"
--   - reversed_space: "John Smith" → "Smith John"
--   - no_spaces: "John A Smith" → "JohnASmith" (handles middle initials)
--   - exact: Perfect match (rare since BOB has $0)
-- 
-- Safety features:
--   - Only updates active clients
--   - Only updates clients with $0 or NULL commission
--   - Matches by carrier + agent for accuracy
--   - Won't update if commission_records name is same as BOB name
-- 
-- ============================================================

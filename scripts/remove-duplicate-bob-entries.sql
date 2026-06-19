-- ============================================================
-- Remove Duplicate BOB Entries
-- ============================================================
-- Fixes duplicate BOB records created by the buggy cleanup script
-- Keeps the OLDEST record (original), deletes newer duplicates
-- ============================================================

-- ============================================================
-- STEP 1: IDENTIFY DUPLICATES (DRY RUN)
-- ============================================================
-- Shows which records would be deleted

WITH duplicates AS (
  SELECT 
    id,
    client_full_name,
    carrier,
    agent_name,
    created_at,
    last_commission_amount,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(client_full_name)), LOWER(TRIM(carrier)), LOWER(TRIM(agent_name))
      ORDER BY created_at ASC  -- Keep oldest record
    ) as row_num
  FROM book_of_business
  WHERE status = 'active'
)
SELECT 
  id,
  client_full_name as "Client Name",
  carrier as "Carrier",
  agent_name as "Agent",
  created_at as "Created",
  last_commission_amount as "Commission",
  CASE 
    WHEN row_num = 1 THEN 'KEEP (original)'
    ELSE 'DELETE (duplicate #' || (row_num - 1)::text || ')'
  END as "Action"
FROM duplicates
WHERE row_num > 1  -- Only show duplicates
ORDER BY client_full_name, created_at;

-- ============================================================
-- STEP 2: COUNT DUPLICATES
-- ============================================================

WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(client_full_name)), LOWER(TRIM(carrier)), LOWER(TRIM(agent_name))
      ORDER BY created_at ASC
    ) as row_num
  FROM book_of_business
  WHERE status = 'active'
)
SELECT 
  COUNT(*) as total_duplicate_records,
  COUNT(DISTINCT CONCAT(LOWER(TRIM(client_full_name)), '|', LOWER(TRIM(carrier)))) as clients_with_duplicates
FROM duplicates
WHERE row_num > 1;

-- ============================================================
-- STEP 3: DELETE DUPLICATES (APPLY)
-- ============================================================
-- ⚠️ ONLY RUN AFTER REVIEWING STEP 1 RESULTS!
-- Keeps the oldest record for each client+carrier+agent combination

WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(client_full_name)), LOWER(TRIM(carrier)), LOWER(TRIM(agent_name))
      ORDER BY created_at ASC  -- Keep oldest
    ) as row_num
  FROM book_of_business
  WHERE status = 'active'
)
DELETE FROM book_of_business
WHERE id IN (
  SELECT id FROM duplicates WHERE row_num > 1
);

-- Returns count of deleted rows

-- ============================================================
-- STEP 4: VERIFY (Run after DELETE)
-- ============================================================
-- Should return 0 rows if all duplicates removed

WITH duplicates AS (
  SELECT 
    client_full_name,
    carrier,
    agent_name,
    COUNT(*) as count
  FROM book_of_business
  WHERE status = 'active'
  GROUP BY LOWER(TRIM(client_full_name)), LOWER(TRIM(carrier)), LOWER(TRIM(agent_name)), client_full_name, carrier, agent_name
  HAVING COUNT(*) > 1
)
SELECT * FROM duplicates;

-- ============================================================
-- NOTES
-- ============================================================
-- 
-- Logic:
--   - Groups by client_full_name + carrier + agent_name (case-insensitive)
--   - Keeps the OLDEST record (earliest created_at)
--   - Deletes all newer duplicates
-- 
-- Why keep oldest?
--   - Original BOB record has correct effective_date
--   - Newer duplicates were created by bug, not real data
--   - Preserves user notes/resolution if any
-- 
-- Safety:
--   - Only affects active records
--   - Won't delete if names are slightly different
--   - Run STEP 1 first to preview what will be deleted
-- 
-- ============================================================

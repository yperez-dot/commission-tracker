-- Clean up BOB duplicate entries caused by name format variations
-- Run this ONCE after deploying the improved normalization logic

-- Examples of duplicates to fix:
-- "CORP, JOYCE I." + "JOYCE CORP" → keep one
-- "CANZINO, GUILLERMO C." + "GUILLERMO CANZINO" → keep one
-- "VAN SPLUNTEREN C,FRANKLIN" + "FRANKLIN VAN SPLUNTEREN" → keep one

-- Step 1: Identify duplicates using normalized name matching
WITH normalized_names AS (
  SELECT 
    id,
    client_full_name,
    carrier,
    agent_name,
    effective_date,
    last_commission_date,
    created_at,
    LOWER(TRIM(
      CASE 
        WHEN client_full_name ~ ',' THEN
          -- "LAST, FIRST MIDDLE" format
          CONCAT(
            TRIM(SPLIT_PART(SPLIT_PART(client_full_name, ',', 2), ' ', 1)),
            ' ',
            TRIM(regexp_replace(SPLIT_PART(client_full_name, ',', 1), '\s+[A-Z]\.?\s*$', '', 'i'))
          )
        ELSE
          -- "FIRST MIDDLE LAST" format
          regexp_replace(TRIM(client_full_name), '\s+[A-Z]\.?\s+', ' ', 'gi')
      END
    )) as normalized_name
  FROM book_of_business
),
duplicates AS (
  SELECT 
    normalized_name,
    carrier,
    COUNT(*) as dup_count,
    ARRAY_AGG(id ORDER BY 
      CASE WHEN effective_date IS NOT NULL AND effective_date != '' THEN 0 ELSE 1 END,
      CASE WHEN last_commission_date IS NOT NULL THEN 0 ELSE 1 END,
      created_at DESC
    ) as ids
  FROM normalized_names
  GROUP BY normalized_name, carrier
  HAVING COUNT(*) > 1
)
SELECT 
  'Found ' || COUNT(*) || ' sets of duplicates affecting ' || SUM(dup_count) || ' total records' as summary
FROM duplicates;

-- Step 2: Show details of duplicates (for review)
WITH normalized_names AS (
  SELECT 
    id,
    client_full_name,
    carrier,
    agent_name,
    effective_date,
    LOWER(TRIM(
      CASE 
        WHEN client_full_name ~ ',' THEN
          CONCAT(
            TRIM(SPLIT_PART(SPLIT_PART(client_full_name, ',', 2), ' ', 1)),
            ' ',
            TRIM(regexp_replace(SPLIT_PART(client_full_name, ',', 1), '\s+[A-Z]\.?\s*$', '', 'i'))
          )
        ELSE
          regexp_replace(TRIM(client_full_name), '\s+[A-Z]\.?\s+', ' ', 'gi')
      END
    )) as normalized_name
  FROM book_of_business
)
SELECT 
  normalized_name,
  carrier,
  ARRAY_AGG(DISTINCT client_full_name ORDER BY client_full_name) as name_variations,
  COUNT(*) as duplicate_count
FROM normalized_names
GROUP BY normalized_name, carrier
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, normalized_name;

-- Step 3: DELETE duplicates (keeps the "best" record per normalized name+carrier)
-- "Best" = has effective_date > has last_commission_date > most recent created_at
WITH normalized_names AS (
  SELECT 
    id,
    client_full_name,
    carrier,
    ROW_NUMBER() OVER (
      PARTITION BY 
        LOWER(TRIM(
          CASE 
            WHEN client_full_name ~ ',' THEN
              CONCAT(
                TRIM(SPLIT_PART(SPLIT_PART(client_full_name, ',', 2), ' ', 1)),
                ' ',
                TRIM(regexp_replace(SPLIT_PART(client_full_name, ',', 1), '\s+[A-Z]\.?\s*$', '', 'i'))
              )
            ELSE
              regexp_replace(TRIM(client_full_name), '\s+[A-Z]\.?\s+', ' ', 'gi')
          END
        )),
        carrier
      ORDER BY 
        CASE WHEN effective_date IS NOT NULL AND effective_date != '' THEN 0 ELSE 1 END,
        CASE WHEN last_commission_date IS NOT NULL THEN 0 ELSE 1 END,
        created_at DESC
    ) as row_num
  FROM book_of_business
)
DELETE FROM book_of_business
WHERE id IN (
  SELECT id FROM normalized_names WHERE row_num > 1
);

-- Step 4: Verify cleanup
SELECT 'Cleanup complete. Remaining duplicates:' as status;

WITH normalized_names AS (
  SELECT 
    LOWER(TRIM(
      CASE 
        WHEN client_full_name ~ ',' THEN
          CONCAT(
            TRIM(SPLIT_PART(SPLIT_PART(client_full_name, ',', 2), ' ', 1)),
            ' ',
            TRIM(regexp_replace(SPLIT_PART(client_full_name, ',', 1), '\s+[A-Z]\.?\s*$', '', 'i'))
          )
        ELSE
          regexp_replace(TRIM(client_full_name), '\s+[A-Z]\.?\s+', ' ', 'gi')
      END
    )) as normalized_name,
    carrier
  FROM book_of_business
)
SELECT COUNT(*) as remaining_duplicate_sets
FROM (
  SELECT normalized_name, carrier, COUNT(*)
  FROM normalized_names
  GROUP BY normalized_name, carrier
  HAVING COUNT(*) > 1
) sub;
-- Should return 0

-- =============================================================================
-- Expected output:
-- Step 1: "Found N sets of duplicates affecting M total records"
-- Step 2: List of duplicate name variations (e.g., "CORP, JOYCE I." + "JOYCE CORP")
-- Step 3: DELETE X (where X = number of duplicate records removed)
-- Step 4: remaining_duplicate_sets = 0
-- =============================================================================

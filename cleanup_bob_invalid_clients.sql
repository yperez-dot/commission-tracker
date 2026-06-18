-- Clean up invalid BOB entries (column headers imported as clients)
-- Run this once on Railway Postgres

-- Show what will be deleted (verification)
SELECT 
  'WILL DELETE:' as action,
  client_full_name, 
  carrier, 
  agent_name,
  effective_date,
  source
FROM book_of_business 
WHERE client_full_name IN (
  'Commission Earned (Applied to Balance)', 
  'Commission Earned & Paid'
);

-- Delete invalid entries
DELETE FROM book_of_business
WHERE client_full_name IN (
  'Commission Earned (Applied to Balance)',
  'Commission Earned & Paid'
);

-- Verify deletion
SELECT 
  COUNT(*) as remaining_invalid_entries
FROM book_of_business 
WHERE client_full_name IN (
  'Commission Earned (Applied to Balance)', 
  'Commission Earned & Paid'
);
-- Should return 0

-- Restore Alexandria Colindres - remove all termed flags
-- Run this in Railway dashboard NOW

-- 1. Remove from policy_status
DELETE FROM policy_status
WHERE LOWER(client_full_name) = LOWER('alexandria colindres');

-- 2. Restore in book_of_business
UPDATE book_of_business
SET status = 'active', termed_date = NULL
WHERE LOWER(client_full_name) = LOWER('alexandria colindres');

-- 3. Remove termed flag from commission_records
UPDATE commission_records
SET is_termed = false
WHERE LOWER(client_full_name) = LOWER('alexandria colindres');

-- 4. Verify restoration
SELECT 'policy_status' as table_name, * FROM policy_status 
WHERE LOWER(client_full_name) LIKE '%colindres%'
UNION ALL
SELECT 'book_of_business', client_full_name, agent_name, carrier, status::text, termed_date::text, NULL, NULL, NULL, NULL, NULL
FROM book_of_business 
WHERE LOWER(client_full_name) LIKE '%colindres%';

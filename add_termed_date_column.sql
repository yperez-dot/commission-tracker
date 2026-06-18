-- Add termed_date column to both policy_status and book_of_business
-- Run this in Railway dashboard BEFORE pushing the code

-- 1. Add to policy_status
ALTER TABLE policy_status 
ADD COLUMN IF NOT EXISTS termed_date DATE;

-- 2. Add to book_of_business
ALTER TABLE book_of_business 
ADD COLUMN IF NOT EXISTS termed_date DATE;

-- Verify columns were added
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE (table_name = 'policy_status' OR table_name = 'book_of_business') 
  AND column_name = 'termed_date'
ORDER BY table_name;

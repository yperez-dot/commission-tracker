-- Add termed_date column to book_of_business table
-- Run this in Railway dashboard BEFORE pushing the code

ALTER TABLE book_of_business 
ADD COLUMN IF NOT EXISTS termed_date TIMESTAMP;

-- Verify column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'book_of_business' AND column_name = 'termed_date';

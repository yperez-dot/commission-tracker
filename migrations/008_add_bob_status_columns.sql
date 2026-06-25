-- Migration 008: Add is_termed and deceased_date to book_of_business
-- Required for BOB status propagation (Deceased/Termed status)
-- Date: June 25, 2026

BEGIN;

-- Add is_termed column (boolean flag for terminated clients)
ALTER TABLE book_of_business 
ADD COLUMN IF NOT EXISTS is_termed BOOLEAN DEFAULT FALSE;

-- Add deceased_date column (date when client deceased)
ALTER TABLE book_of_business 
ADD COLUMN IF NOT EXISTS deceased_date DATE;

-- Update existing records: Mark as termed if status contains 'term'
UPDATE book_of_business 
SET is_termed = TRUE 
WHERE LOWER(status) LIKE '%term%';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bob_is_termed ON book_of_business(is_termed);
CREATE INDEX IF NOT EXISTS idx_bob_deceased_date ON book_of_business(deceased_date);

-- Add comment
COMMENT ON COLUMN book_of_business.is_termed IS 'Boolean flag: TRUE if client is terminated';
COMMENT ON COLUMN book_of_business.deceased_date IS 'Date when client deceased (NULL if alive)';

COMMIT;

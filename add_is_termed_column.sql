-- Add is_termed column to commission_records table
-- Run this in Railway dashboard BEFORE pushing the code

ALTER TABLE commission_records 
ADD COLUMN IF NOT EXISTS is_termed BOOLEAN DEFAULT false;

-- Verify column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'commission_records' AND column_name = 'is_termed';

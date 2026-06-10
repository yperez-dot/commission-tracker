-- Add statement_month column to track which NHP statement the commission came from
-- Example values: "Cigna - April 2026", "AETNA MA - MARCH 2026"

ALTER TABLE commission_records 
ADD COLUMN IF NOT EXISTS statement_month TEXT;

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_statement_month ON commission_records(statement_month);

-- Update existing records: extract from raw_data if available
UPDATE commission_records
SET statement_month = raw_data->>'statementMonth'
WHERE raw_data IS NOT NULL 
  AND raw_data->>'statementMonth' IS NOT NULL
  AND statement_month IS NULL;

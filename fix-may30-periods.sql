-- Fix periods on May 30th NHP upload
-- Extract period from statement_month column for records with period = 'Unknown'

UPDATE commission_records
SET payment_period = CASE
  -- April 2026
  WHEN LOWER(statement_month) LIKE '%april%2026%' OR LOWER(statement_month) LIKE '%apr%2026%' THEN '202604'
  -- March 2026
  WHEN LOWER(statement_month) LIKE '%march%2026%' OR LOWER(statement_month) LIKE '%mar%2026%' THEN '202603'
  -- February 2026
  WHEN LOWER(statement_month) LIKE '%february%2026%' OR LOWER(statement_month) LIKE '%feb%2026%' THEN '202602'
  -- January 2026
  WHEN LOWER(statement_month) LIKE '%january%2026%' OR LOWER(statement_month) LIKE '%jan%2026%' THEN '202601'
  ELSE payment_period
END
WHERE payment_period = 'Unknown' 
  AND statement_month IS NOT NULL
  AND source = 'NHP';

-- Show what we fixed
SELECT 
  payment_period,
  COUNT(*) as record_count,
  SUM(CASE WHEN lob = 'ACA' AND producer_payable > 0 THEN producer_payable ELSE 0 END) as aca_agent_payable
FROM commission_records
WHERE source = 'NHP'
GROUP BY payment_period
ORDER BY payment_period DESC;

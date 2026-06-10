-- STEP 1: Check what's actually in the database for Jun 2026 ACA records
SELECT 
  agent_name, 
  policy_number, 
  producer_payable, 
  commission,
  statement_month, 
  members, 
  effective_date, 
  raw_data
FROM commission_records
WHERE payment_period = '202606' AND lob = 'ACA'
ORDER BY agent_name, created_at DESC;

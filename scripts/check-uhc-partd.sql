-- Check UHC PartD records

-- 1. Check existing UHC records by LOB
SELECT 
  lob,
  COUNT(*) as count,
  SUM(commission) as total_commission
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
GROUP BY lob
ORDER BY count DESC;

-- 2. Check existing UHC records by plan_type
SELECT 
  plan_type,
  COUNT(*) as count,
  SUM(commission) as total_commission
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
GROUP BY plan_type
ORDER BY count DESC;

-- 3. Check target uploads (318-325, 332-333)
SELECT 
  id,
  original_name,
  uploaded_at,
  row_count,
  commission_sum
FROM uploads
WHERE id IN (318, 319, 320, 321, 322, 323, 324, 325, 332, 333)
ORDER BY id;

-- 4. Check records from target uploads
SELECT 
  upload_id,
  plan_type,
  lob,
  COUNT(*) as count
FROM commission_records
WHERE upload_id IN (318, 319, 320, 321, 322, 323, 324, 325, 332, 333)
GROUP BY upload_id, plan_type, lob
ORDER BY upload_id, count DESC;

-- 5. Sample UHC PDP records (if any exist)
SELECT 
  id,
  upload_id,
  agent_name,
  client_full_name,
  plan_type,
  lob,
  commission,
  payment_period
FROM commission_records
WHERE carrier = 'UnitedHealthcare'
  AND (lob = 'PDP' OR plan_type LIKE '%PDP%' OR plan_type LIKE '%PartD%')
LIMIT 10;

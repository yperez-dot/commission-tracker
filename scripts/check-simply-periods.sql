-- Check Simply records to diagnose period issue

-- See all Simply records and their periods
SELECT 
  id,
  carrier,
  client_full_name,
  agent_name,
  payment_period,
  effective_date,
  commission,
  created_at
FROM commission_records
WHERE LOWER(carrier) LIKE '%simply%'
ORDER BY created_at DESC
LIMIT 20;

-- Count Simply records by period
SELECT 
  payment_period,
  COUNT(*) as count,
  SUM(commission) as total_commission
FROM commission_records
WHERE LOWER(carrier) LIKE '%simply%'
GROUP BY payment_period
ORDER BY count DESC;

-- Check the source file names for Simply uploads
SELECT DISTINCT
  u.original_name,
  COUNT(cr.id) as record_count,
  MIN(cr.payment_period) as periods
FROM uploads u
LEFT JOIN commission_records cr ON cr.upload_id = u.id
WHERE LOWER(u.original_name) LIKE '%simply%'
  OR LOWER(cr.carrier) LIKE '%simply%'
GROUP BY u.original_name
ORDER BY u.uploaded_at DESC
LIMIT 10;

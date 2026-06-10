-- STEP 3: Delete stale Jun 2026 ACA records before re-uploading
-- Run this in Railway SQL console AFTER checking database but BEFORE re-upload

DELETE FROM commission_records
WHERE payment_period = '202606' AND lob = 'ACA';

-- This will return number of deleted rows
-- Expected: 4-10 records (Patsy + Christian + maybe Eduardo)

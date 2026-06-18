-- Fix #1: Standardize agency_production status values
-- Note: Table is agency_production, not agency_override_recon (that table doesn't exist)

-- Normalize all status values to "Paid"
UPDATE agency_production
SET status = 'Paid'
WHERE LOWER(TRIM(status)) IN (
  'completed', 'active policy', 'enrolled',
  'accepted', 'in progress', 'in progress application',
  'override paid', 'paid', 'active'
);

-- Normalize all status values to "Cancelled"
UPDATE agency_production
SET status = 'Cancelled'
WHERE LOWER(TRIM(status)) IN (
  'cancelled application', 'canceled', 'cancelled',
  'disenrolled', 'inactive policy', 'denied',
  'denied/rejected', 'withdrawn', 'terminated'
);

-- Normalize all status values to "Plan Change"
UPDATE agency_production
SET status = 'Plan Change'
WHERE LOWER(TRIM(status)) IN ('plan_change', 'plan change');

-- Normalize all status values to "Missing"
UPDATE agency_production
SET status = 'Missing'
WHERE TRIM(status) IN ('—', '', '-') OR status IS NULL OR LOWER(status) IN ('missing override', 'missing', 'not found', 'pending');

-- Verify results
SELECT status, COUNT(*) as count
FROM agency_production
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'Missing' THEN 1
    WHEN 'Plan Change' THEN 2
    WHEN 'Cancelled' THEN 3
    WHEN 'Paid' THEN 4
    ELSE 5
  END;

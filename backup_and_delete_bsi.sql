-- Step 3 + Step 4: Backup and Delete BSI Records
-- Run this in Railway PostgreSQL Query tab

-- STEP 1: Create backup table (preserves everything including manual edits)
CREATE TABLE IF NOT EXISTS commission_records_bsi_backup AS
SELECT * FROM commission_records WHERE source = 'BSI';

-- STEP 2: Verify backup count
SELECT COUNT(*) as backup_count FROM commission_records_bsi_backup;

-- STEP 3: Check for manual edits (preserve these!)
SELECT id, client_full_name, commission, classification, 
       is_manually_edited, edit_notes, edited_by, edited_at
FROM commission_records
WHERE source = 'BSI' AND is_manually_edited = true;

-- STEP 4: Delete BSI records from main table
DELETE FROM commission_records WHERE source = 'BSI';

-- STEP 5: Verify deletion
SELECT COUNT(*) as remaining_bsi FROM commission_records WHERE source = 'BSI';
-- Expected: 0

-- STEP 6: Verify backup still exists
SELECT COUNT(*) as backup_still_exists FROM commission_records_bsi_backup;
-- Expected: same as Step 2

-- TO RESTORE (if needed):
-- INSERT INTO commission_records SELECT * FROM commission_records_bsi_backup;

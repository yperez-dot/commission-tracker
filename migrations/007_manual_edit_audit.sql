-- Migration 007: Manual Edit with Audit Trail
-- Add columns to commission_records for manual editing with full audit trail

-- Add manual edit flag and audit columns
ALTER TABLE commission_records
ADD COLUMN IF NOT EXISTS is_manually_edited BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS edited_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS edit_notes TEXT;

-- Add columns to preserve original parsed values
ALTER TABLE commission_records
ADD COLUMN IF NOT EXISTS original_commission DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS original_thei_share DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS original_bsi_share DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS original_classification VARCHAR(50);

-- Create audit log table for all commission record edits
CREATE TABLE IF NOT EXISTS commission_edit_audit (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES commission_records(id) ON DELETE CASCADE,
  edited_by VARCHAR(255) NOT NULL,
  edited_at TIMESTAMP NOT NULL DEFAULT NOW(),
  field_name VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast audit trail lookups
CREATE INDEX IF NOT EXISTS idx_commission_edit_audit_record_id ON commission_edit_audit(record_id);
CREATE INDEX IF NOT EXISTS idx_commission_edit_audit_edited_at ON commission_edit_audit(edited_at DESC);

-- Add comment for documentation
COMMENT ON TABLE commission_edit_audit IS 'Audit trail for all manual edits to commission records. Never delete rows - this is the permanent record.';
COMMENT ON COLUMN commission_records.is_manually_edited IS 'TRUE when record has been manually corrected. Prevents re-import from overwriting.';
COMMENT ON COLUMN commission_records.original_commission IS 'Original parsed commission value before manual edit (evidence retention).';
COMMENT ON COLUMN commission_records.original_thei_share IS 'Original parsed THEI/BSI override split before manual edit.';
COMMENT ON COLUMN commission_records.original_bsi_share IS 'Original parsed BSI override split before manual edit.';
COMMENT ON COLUMN commission_records.original_classification IS 'Original parsed classification (Override/Agent Comp/New Business/Chargeback) before manual edit.';

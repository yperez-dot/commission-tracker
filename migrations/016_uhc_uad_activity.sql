-- UHC unearned-advance recoup (UAD Activity).
-- Stored separately from commission so New/Renewal totals, splits, and agent
-- statements do not change. Default 0 for all existing rows.
ALTER TABLE commission_records
  ADD COLUMN IF NOT EXISTS uad_activity NUMERIC(12,2) DEFAULT 0;

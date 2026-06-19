-- ============================================================
-- Migration 005: Plan Change Detection
-- ============================================================
-- Adds plan_change_candidates table for auto-detection of
-- clients switching carriers based on fuzzy name matching
-- and effective date comparison.
-- ============================================================

-- Create plan_change_candidates table
CREATE TABLE IF NOT EXISTS plan_change_candidates (
  id SERIAL PRIMARY KEY,
  bob_id INT NOT NULL REFERENCES book_of_business(id) ON DELETE CASCADE,
  new_record_id INT NOT NULL REFERENCES commission_records(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  client_name TEXT NOT NULL,
  old_carrier TEXT NOT NULL,
  new_carrier TEXT NOT NULL,
  old_effective_date TEXT,
  new_effective_date TEXT,
  confidence_score DECIMAL(3,2) DEFAULT 1.0,  -- 1.0 = exact name match, 0.8 = fuzzy match
  status TEXT DEFAULT 'pending',  -- 'pending', 'confirmed', 'dismissed'
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_bob_new_record UNIQUE(bob_id, new_record_id),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'confirmed', 'dismissed'))
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_plan_change_candidates_status 
  ON plan_change_candidates(status);

CREATE INDEX IF NOT EXISTS idx_plan_change_candidates_bob_id 
  ON plan_change_candidates(bob_id);

CREATE INDEX IF NOT EXISTS idx_plan_change_candidates_agent 
  ON plan_change_candidates(agent_name);

CREATE INDEX IF NOT EXISTS idx_plan_change_candidates_created 
  ON plan_change_candidates(created_at DESC);

-- Add comment
COMMENT ON TABLE plan_change_candidates IS 
  'Tracks potential plan changes detected by comparing new commission records against Book of Business. Used for auto-flagging clients who may have switched carriers.';

COMMENT ON COLUMN plan_change_candidates.confidence_score IS 
  '1.0 = exact name match, 0.8 = fuzzy match (first 3 chars of first name)';

COMMENT ON COLUMN plan_change_candidates.status IS 
  'pending = awaiting review, confirmed = user confirmed plan change, dismissed = false positive';

-- Grant permissions (adjust role names as needed)
-- GRANT SELECT, INSERT, UPDATE ON plan_change_candidates TO your_app_user;
-- GRANT USAGE, SELECT ON SEQUENCE plan_change_candidates_id_seq TO your_app_user;

-- ============================================================
-- Rollback Script (run if needed to undo this migration)
-- ============================================================
-- DROP INDEX IF EXISTS idx_plan_change_candidates_created;
-- DROP INDEX IF EXISTS idx_plan_change_candidates_agent;
-- DROP INDEX IF EXISTS idx_plan_change_candidates_bob_id;
-- DROP INDEX IF EXISTS idx_plan_change_candidates_status;
-- DROP TABLE IF EXISTS plan_change_candidates CASCADE;

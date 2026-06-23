-- Migration 006: BSI Pass-Through Audit - Phase 1 Foundation
-- Adds MBI tracking and policy crosswalk for BSI audit feature
-- Goal: Link production reports (have MBI) to BSI statements (have policy#)

-- Phase 1a: Add MBI and carrier_member_id to agency_production (Hector's reports)
-- These columns capture the universal Medicare ID and carrier-specific member ID from production reports

ALTER TABLE agency_production 
ADD COLUMN IF NOT EXISTS mbi TEXT,
ADD COLUMN IF NOT EXISTS carrier_member_id TEXT;

COMMENT ON COLUMN agency_production.mbi IS 'Medicare Beneficiary Identifier - universal key across all carriers';
COMMENT ON COLUMN agency_production.carrier_member_id IS 'Carrier-specific member ID (UMID for Humana, HCID for Anthem, etc)';

-- Phase 1b: Add policy_number to agency_production if not exists
-- Some carriers (UHC Med Supp) have policy# in production; capture it
ALTER TABLE agency_production 
ADD COLUMN IF NOT EXISTS policy_number_production TEXT;

COMMENT ON COLUMN agency_production.policy_number_production IS 'Policy number from production report (UHC Med Supp only for now)';

-- Phase 1c: Add MBI and carrier_member_id to commission_records (BSI statements)
-- BSI statements don't have MBI today, but when they add it (or via crosswalk), store it here

ALTER TABLE commission_records 
ADD COLUMN IF NOT EXISTS mbi TEXT,
ADD COLUMN IF NOT EXISTS carrier_member_id TEXT;

COMMENT ON COLUMN commission_records.mbi IS 'Medicare Beneficiary Identifier - linked via crosswalk or future BSI enhancement';
COMMENT ON COLUMN commission_records.carrier_member_id IS 'Carrier-specific member ID - linked via crosswalk';

-- Phase 1d: Create the learning crosswalk table
-- Every time name-matching succeeds between production (has MBI) and statement (has policy#),
-- record the pair. Over time, this builds a lookup table that replaces name-matching with ID-matching.

CREATE TABLE IF NOT EXISTS policy_mbi_crosswalk (
  mbi TEXT NOT NULL,
  policy_number TEXT NOT NULL,
  carrier TEXT NOT NULL,
  first_seen TIMESTAMP DEFAULT now(),
  last_seen TIMESTAMP DEFAULT now(),
  match_count INTEGER DEFAULT 1,
  PRIMARY KEY (mbi, policy_number, carrier)
);

CREATE INDEX IF NOT EXISTS idx_crosswalk_mbi ON policy_mbi_crosswalk(mbi);
CREATE INDEX IF NOT EXISTS idx_crosswalk_policy ON policy_mbi_crosswalk(policy_number);
CREATE INDEX IF NOT EXISTS idx_crosswalk_carrier ON policy_mbi_crosswalk(carrier);

COMMENT ON TABLE policy_mbi_crosswalk IS 'Learns MBI ↔ policy# mappings from successful name matches. Enables ID-based matching even though BSI statements lack MBI.';
COMMENT ON COLUMN policy_mbi_crosswalk.match_count IS 'How many times this pairing was confirmed (confidence metric)';

-- Phase 1e: Add indexes for the new columns to speed up joins

CREATE INDEX IF NOT EXISTS idx_agency_production_mbi ON agency_production(mbi) WHERE mbi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agency_production_carrier_member_id ON agency_production(carrier_member_id) WHERE carrier_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agency_production_policy_number_production ON agency_production(policy_number_production) WHERE policy_number_production IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commission_records_mbi ON commission_records(mbi) WHERE mbi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commission_records_carrier_member_id ON commission_records(carrier_member_id) WHERE carrier_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commission_records_policy_number ON commission_records(policy_number) WHERE policy_number IS NOT NULL;

-- Phase 1f: Create a helper function to update the crosswalk
-- Call this whenever a production row and statement row are matched

CREATE OR REPLACE FUNCTION record_policy_mbi_match(
  p_mbi TEXT,
  p_policy_number TEXT,
  p_carrier TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO policy_mbi_crosswalk (mbi, policy_number, carrier, first_seen, last_seen, match_count)
  VALUES (p_mbi, p_policy_number, p_carrier, now(), now(), 1)
  ON CONFLICT (mbi, policy_number, carrier) 
  DO UPDATE SET 
    last_seen = now(),
    match_count = policy_mbi_crosswalk.match_count + 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_policy_mbi_match IS 'Records or updates a MBI ↔ policy# mapping in the crosswalk table';

-- Phase 1g: Create a helper function to look up MBI from policy# (or vice versa)

CREATE OR REPLACE FUNCTION lookup_mbi_from_policy(
  p_policy_number TEXT,
  p_carrier TEXT
) RETURNS TEXT AS $$
  SELECT mbi 
  FROM policy_mbi_crosswalk 
  WHERE policy_number = p_policy_number 
    AND carrier = p_carrier
  ORDER BY match_count DESC, last_seen DESC
  LIMIT 1;
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION lookup_policy_from_mbi(
  p_mbi TEXT,
  p_carrier TEXT
) RETURNS TEXT AS $$
  SELECT policy_number 
  FROM policy_mbi_crosswalk 
  WHERE mbi = p_mbi 
    AND carrier = p_carrier
  ORDER BY match_count DESC, last_seen DESC
  LIMIT 1;
$$ LANGUAGE SQL;

COMMENT ON FUNCTION lookup_mbi_from_policy IS 'Find MBI given a policy# and carrier (for statement → production linking)';
COMMENT ON FUNCTION lookup_policy_from_mbi IS 'Find policy# given an MBI and carrier (for production → statement linking)';

-- Phase 1h: Create BSI carrier statement uploads table
-- Stores metadata about each carrier statement upload (one per carrier per month)
-- The actual file is retained on disk; this tracks what we have

CREATE TABLE IF NOT EXISTS bsi_carrier_statement_uploads (
  id SERIAL PRIMARY KEY,
  carrier TEXT NOT NULL,
  statement_month TEXT NOT NULL, -- YYYY-MM format
  filename TEXT NOT NULL,
  file_path TEXT, -- Path to stored original file
  uploaded_at TIMESTAMP DEFAULT now(),
  uploaded_by TEXT,
  record_count INTEGER DEFAULT 0,
  balance_due_to_bsi NUMERIC(10,2), -- From statement summary box
  total_paid_to_bsi NUMERIC(10,2), -- From statement summary box
  nhp_amount NUMERIC(10,2), -- NHP line from summary box
  parse_errors TEXT[], -- Any parsing issues encountered
  UNIQUE(carrier, statement_month, filename)
);

CREATE INDEX IF NOT EXISTS idx_bsi_carrier_uploads_month ON bsi_carrier_statement_uploads(statement_month);
CREATE INDEX IF NOT EXISTS idx_bsi_carrier_uploads_carrier ON bsi_carrier_statement_uploads(carrier);

COMMENT ON TABLE bsi_carrier_statement_uploads IS 'Tracks BSI carrier statement uploads (ongoing monthly feed). One batch per carrier per month, accumulating over time.';
COMMENT ON COLUMN bsi_carrier_statement_uploads.file_path IS 'Path to original PDF/Excel file (evidence for disputes)';
COMMENT ON COLUMN bsi_carrier_statement_uploads.balance_due_to_bsi IS 'Balance due to BSI from Health Experts (from statement summary)';
COMMENT ON COLUMN bsi_carrier_statement_uploads.total_paid_to_bsi IS 'Total paid to BSI (from statement summary)';

-- Phase 1i: Create BSI carrier statement records table
-- Stores parsed rows from carrier statements (what carriers paid BSI)
-- Links back to upload batch via bsi_carrier_statement_upload_id

CREATE TABLE IF NOT EXISTS bsi_carrier_statement_records (
  id SERIAL PRIMARY KEY,
  upload_id INTEGER REFERENCES bsi_carrier_statement_uploads(id) ON DELETE CASCADE,
  carrier TEXT NOT NULL,
  statement_month TEXT NOT NULL,
  agent_name TEXT,
  client_name TEXT,
  policy_number TEXT,
  effective_date DATE,
  commission NUMERIC(10,2),
  mbi TEXT, -- Will be populated via crosswalk over time
  carrier_member_id TEXT, -- Will be populated via crosswalk
  raw_data JSONB, -- Original parsed row
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bsi_carrier_records_upload ON bsi_carrier_statement_records(upload_id);
CREATE INDEX IF NOT EXISTS idx_bsi_carrier_records_carrier ON bsi_carrier_statement_records(carrier);
CREATE INDEX IF NOT EXISTS idx_bsi_carrier_records_policy ON bsi_carrier_statement_records(policy_number) WHERE policy_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bsi_carrier_records_mbi ON bsi_carrier_statement_records(mbi) WHERE mbi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bsi_carrier_records_month ON bsi_carrier_statement_records(statement_month);

COMMENT ON TABLE bsi_carrier_statement_records IS 'Parsed rows from BSI carrier statements. Shows what carriers actually paid BSI (the audit referee).';
COMMENT ON COLUMN bsi_carrier_statement_records.upload_id IS 'Links to bsi_carrier_statement_uploads - the source file that produced this row';

-- Phase 1j: Create statement coverage view
-- Quick lookup: which carrier × month combinations do we have statements for?
-- Used to determine "Owed" vs "Unverified" verdict

CREATE OR REPLACE VIEW statement_coverage AS
SELECT DISTINCT
  carrier,
  statement_month,
  COUNT(*) as record_count,
  MAX(uploaded_at) as last_uploaded
FROM bsi_carrier_statement_uploads
GROUP BY carrier, statement_month
ORDER BY carrier, statement_month DESC;

COMMENT ON VIEW statement_coverage IS 'Shows which carrier × month combinations we have BSI carrier statements for. Used to distinguish "Owed" (have statement, person not on it) from "Unverified" (no statement for this carrier/month).';

-- Phase 1k: Helper function to check if we have coverage for a carrier × month

CREATE OR REPLACE FUNCTION has_statement_coverage(
  p_carrier TEXT,
  p_month TEXT
) RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM statement_coverage
    WHERE carrier = p_carrier AND statement_month = p_month
  );
$$ LANGUAGE SQL;

COMMENT ON FUNCTION has_statement_coverage IS 'Check if we have a BSI carrier statement for the given carrier and month (YYYY-MM format)';

-- Migration complete
-- Next steps: 
-- 1. Update agencyproduction.js parser to capture MBI from carrier production reports
-- 2. Create BSI carrier statement upload endpoint + parser (Phase 3)
-- 3. Build audit reconciliation logic (Phase 4)

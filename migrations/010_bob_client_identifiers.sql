-- Migration 010: Member ID and date of birth on Book of Business
-- Policy number already exists; keep it and add the other client identifiers.

BEGIN;

ALTER TABLE book_of_business
  ADD COLUMN IF NOT EXISTS member_id TEXT;

ALTER TABLE book_of_business
  ADD COLUMN IF NOT EXISTS date_of_birth TEXT;

CREATE INDEX IF NOT EXISTS idx_bob_member_id
  ON book_of_business(member_id)
  WHERE member_id IS NOT NULL AND member_id <> '';

CREATE INDEX IF NOT EXISTS idx_bob_policy_number
  ON book_of_business(policy_number)
  WHERE policy_number IS NOT NULL AND policy_number <> '';

COMMENT ON COLUMN book_of_business.member_id IS 'Carrier member ID or MBI when available';
COMMENT ON COLUMN book_of_business.date_of_birth IS 'Client date of birth (MM/DD/YYYY text, matching effective_date)';
COMMENT ON COLUMN book_of_business.policy_number IS 'Policy number when the carrier provides one (may be absent on MA books)';

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;

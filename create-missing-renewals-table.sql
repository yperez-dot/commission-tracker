-- Feature 1: Smart Missing Renewals Tracker
-- Run this in Railway SQL console

-- New table to track missing renewal investigations
CREATE TABLE missing_renewal_statuses (
  id SERIAL PRIMARY KEY,
  agent_name TEXT NOT NULL,
  carrier TEXT NOT NULL,
  client_full_name TEXT NOT NULL,
  effective_date TEXT,
  payment_period TEXT NOT NULL,
  expected_commission DECIMAL(10,2),
  status TEXT DEFAULT 'Missing',
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  resolution_method TEXT,
  resolving_upload_batch TEXT,
  UNIQUE(agent_name, carrier, client_full_name, payment_period)
);

-- Index for fast lookups during auto-resolution
CREATE INDEX idx_missing_renewal_active 
  ON missing_renewal_statuses(status, agent_name, carrier, client_full_name)
  WHERE status IN ('Missing', 'Investigating');

-- Verify table was created
SELECT 'missing_renewal_statuses table created successfully!' as result;
SELECT COUNT(*) as initial_count FROM missing_renewal_statuses;

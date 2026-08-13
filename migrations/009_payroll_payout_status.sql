-- Payroll Agent Payout status (shared paid/unpaid per period)
-- Used by Payroll → Agent Payouts (replaces browser localStorage)

CREATE TABLE IF NOT EXISTS payroll_payout_status (
  id SERIAL PRIMARY KEY,
  agency_key TEXT NOT NULL DEFAULT 'thei',
  payment_period TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  paid_date DATE,
  amount NUMERIC(12, 2),
  notes TEXT,
  updated_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (agency_key, payment_period, agent_name)
);

CREATE INDEX IF NOT EXISTS idx_payroll_payout_status_period
  ON payroll_payout_status (agency_key, payment_period);
CREATE INDEX IF NOT EXISTS idx_payroll_payout_status_paid
  ON payroll_payout_status (agency_key, is_paid, paid_date DESC);

COMMENT ON TABLE payroll_payout_status IS
  'Shared Agent Payouts paid/unpaid flags per agency + statement period';

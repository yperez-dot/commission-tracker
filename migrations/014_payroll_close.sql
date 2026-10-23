-- Payroll close: month locks, adjustments, payment records, month close, deposits, change log.
-- Reference only — every table below self-creates on first use from
-- routes/payrollCloseStore.js and routes/change-log.js (CREATE ... IF NOT EXISTS),
-- the same way 013 payee_statements does. Nothing needs to be run by hand.

CREATE TABLE IF NOT EXISTS payroll_locks (
  id SERIAL PRIMARY KEY, agency_key TEXT NOT NULL DEFAULT 'thei', agent_name TEXT NOT NULL, payee_key TEXT,
  payment_period TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'locked', source TEXT NOT NULL DEFAULT 'paid',
  data_total NUMERIC(12,2) NOT NULL DEFAULT 0, adjustments_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  period_total NUMERIC(12,2) NOT NULL DEFAULT 0, carry_in NUMERIC(12,2) NOT NULL DEFAULT 0,
  net NUMERIC(12,2) NOT NULL DEFAULT 0, payable NUMERIC(12,2) NOT NULL DEFAULT 0, carry_out NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2), statement_id INTEGER, statement_total NUMERIC(12,2), raw_agent_names JSONB, record_ids JSONB,
  locked_by TEXT, locked_at TIMESTAMPTZ DEFAULT NOW(), unlocked_by TEXT, unlocked_at TIMESTAMPTZ, unlock_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_locks_active ON payroll_locks (agency_key, agent_name, payment_period) WHERE status = 'locked';

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id SERIAL PRIMARY KEY, agency_key TEXT NOT NULL DEFAULT 'thei', agent_name TEXT NOT NULL, payee_key TEXT,
  payment_period TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL, category TEXT NOT NULL, reason TEXT NOT NULL,
  corrects_period TEXT, corrects_lock_id INTEGER, status TEXT NOT NULL DEFAULT 'active', entered_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), voided_by TEXT, voided_at TIMESTAMPTZ, void_reason TEXT
);

-- payroll_payments (create_payroll_payments_table.sql) gains:
ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS agency_key TEXT DEFAULT 'thei';
ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS payment_period TEXT;
ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS lock_id INTEGER;
ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS amount_payable NUMERIC(12,2);
ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS voided_by TEXT;
ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE TABLE IF NOT EXISTS payroll_month_close (
  id SERIAL PRIMARY KEY, agency_key TEXT NOT NULL DEFAULT 'thei', payment_period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'closed', closed_by TEXT, closed_at TIMESTAMPTZ DEFAULT NOW(), notes TEXT, checklist JSONB,
  reopened_by TEXT, reopened_at TIMESTAMPTZ, reopen_reason TEXT
);
CREATE TABLE IF NOT EXISTS payroll_close_carrier_none (
  id SERIAL PRIMARY KEY, agency_key TEXT NOT NULL DEFAULT 'thei', payment_period TEXT NOT NULL, carrier TEXT NOT NULL,
  reason TEXT NOT NULL, entered_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), removed_at TIMESTAMPTZ, removed_by TEXT
);
CREATE TABLE IF NOT EXISTS payroll_deposits (
  id SERIAL PRIMARY KEY, agency_key TEXT NOT NULL DEFAULT 'thei', deposit_date DATE NOT NULL, payer TEXT NOT NULL,
  payer_other TEXT, amount NUMERIC(12,2) NOT NULL, reference TEXT, memo TEXT, source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT, status TEXT NOT NULL DEFAULT 'active', entered_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT, updated_at TIMESTAMPTZ, deleted_by TEXT, deleted_at TIMESTAMPTZ, delete_reason TEXT
);
CREATE TABLE IF NOT EXISTS payroll_deposit_allocations (
  id SERIAL PRIMARY KEY, deposit_id INTEGER NOT NULL REFERENCES payroll_deposits(id) ON DELETE CASCADE,
  payment_period TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL
);
CREATE TABLE IF NOT EXISTS change_log (
  id SERIAL PRIMARY KEY, agency_key TEXT NOT NULL DEFAULT 'thei', event_type TEXT NOT NULL, entity_type TEXT,
  entity_id TEXT, payment_period TEXT, payee TEXT, actor TEXT, actor_role TEXT, summary TEXT, details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-payee payment holds for house override statements (THEI / BSI).
-- Reference only — the table self-creates on first use from
-- routes/paymentHoldStore.js (CREATE TABLE IF NOT EXISTS), same as
-- 013 payee_statements and 014 payroll_close. Nothing needs to be run by hand.

CREATE TABLE IF NOT EXISTS payment_holds (
  id SERIAL PRIMARY KEY,
  payee_key TEXT NOT NULL,
  effective_on_or_after DATE NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  released_by TEXT,
  released_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payment_holds_payee
  ON payment_holds (payee_key, released_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_holds_active
  ON payment_holds (payee_key) WHERE released_at IS NULL;

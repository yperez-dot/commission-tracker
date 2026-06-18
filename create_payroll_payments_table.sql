-- Payroll Payment History Table
-- Tracks when THEI paid producers for their commissions

CREATE TABLE IF NOT EXISTS payroll_payments (
  id SERIAL PRIMARY KEY,
  payment_date DATE NOT NULL,
  agent_name TEXT NOT NULL,
  payment_amount NUMERIC(10, 2) NOT NULL,
  payment_method TEXT, -- check, ACH, Zelle, cash, etc.
  check_number TEXT,
  period_start DATE, -- Optional: payroll period start
  period_end DATE,   -- Optional: payroll period end
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_payments_agent ON payroll_payments(agent_name);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_date ON payroll_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_period ON payroll_payments(period_start, period_end);

COMMENT ON TABLE payroll_payments IS 'Tracks producer payments made by THEI';
COMMENT ON COLUMN payroll_payments.payment_date IS 'Date payment was issued';
COMMENT ON COLUMN payroll_payments.agent_name IS 'Producer/agent who received payment';
COMMENT ON COLUMN payroll_payments.payment_amount IS 'Amount paid';
COMMENT ON COLUMN payroll_payments.payment_method IS 'How payment was made (check, ACH, Zelle, etc.)';
COMMENT ON COLUMN payroll_payments.check_number IS 'Check number if payment_method = check';
COMMENT ON COLUMN payroll_payments.period_start IS 'Start of commission period covered by this payment';
COMMENT ON COLUMN payroll_payments.period_end IS 'End of commission period covered by this payment';

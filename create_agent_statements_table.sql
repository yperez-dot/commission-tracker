-- Agent Statements Table
-- Tracks commission statement generation history for each agent

CREATE TABLE IF NOT EXISTS agent_statements (
  id SERIAL PRIMARY KEY,
  agent_name TEXT NOT NULL,
  statement_period TEXT NOT NULL, -- YYYYMM format (e.g., "202606")
  statement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_commission NUMERIC(10, 2) NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT DEFAULT 'pending', -- pending, paid, void
  payment_date DATE,
  payment_amount NUMERIC(10, 2),
  payment_method TEXT, -- check, ACH, Zelle, cash, etc.
  check_number TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_statements_agent ON agent_statements(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_statements_period ON agent_statements(statement_period);
CREATE INDEX IF NOT EXISTS idx_agent_statements_status ON agent_statements(payment_status);
CREATE INDEX IF NOT EXISTS idx_agent_statements_date ON agent_statements(statement_date);

COMMENT ON TABLE agent_statements IS 'Commission statement generation history for agents';
COMMENT ON COLUMN agent_statements.statement_period IS 'Payment period in YYYYMM format';
COMMENT ON COLUMN agent_statements.statement_date IS 'Date statement was generated';
COMMENT ON COLUMN agent_statements.total_commission IS 'Total commissions on this statement';
COMMENT ON COLUMN agent_statements.record_count IS 'Number of commission records included';
COMMENT ON COLUMN agent_statements.payment_status IS 'Payment status: pending, paid, void';
COMMENT ON COLUMN agent_statements.payment_date IS 'Date payment was issued';
COMMENT ON COLUMN agent_statements.payment_amount IS 'Amount actually paid (may differ from total_commission)';

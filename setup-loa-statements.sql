-- Database tables for LOA (Loan Out Agreement) statements

CREATE TABLE IF NOT EXISTS loa_statements (
  id SERIAL PRIMARY KEY,
  agent_name VARCHAR(255) NOT NULL,
  payment_date DATE NOT NULL,
  period_start DATE,
  period_end DATE,
  period_label VARCHAR(100),
  total_amount DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'draft',
  commission_structure JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  paid_date DATE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS loa_statement_items (
  id SERIAL PRIMARY KEY,
  statement_id INTEGER REFERENCES loa_statements(id) ON DELETE CASCADE,
  client_name VARCHAR(255),
  carrier VARCHAR(255),
  transaction_type VARCHAR(100),
  amount DECIMAL(10,2),
  note TEXT,
  sort_order INTEGER DEFAULT 0
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_loa_statements_agent ON loa_statements(agent_name);
CREATE INDEX IF NOT EXISTS idx_loa_statements_status ON loa_statements(status);
CREATE INDEX IF NOT EXISTS idx_loa_statement_items_statement ON loa_statement_items(statement_id);

COMMENT ON TABLE loa_statements IS 'Producer payment statements for LOA (Loan Out Agreement) agents like Carolina Robles';
COMMENT ON TABLE loa_statement_items IS 'Individual line items (sales/transactions) within an LOA statement';

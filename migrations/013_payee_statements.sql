-- Stored payee statements (issued by OliComm, or received from BSI as reference)
CREATE TABLE IF NOT EXISTS payee_statements (
  id SERIAL PRIMARY KEY,
  agency_key TEXT NOT NULL DEFAULT 'thei',
  payee_key TEXT NOT NULL,
  payee_name TEXT NOT NULL,
  payment_period TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'olicomm',      -- 'olicomm' | 'bsi_received'
  status TEXT NOT NULL DEFAULT 'issued',       -- 'issued' | 'superseded' | 'void'
  version INTEGER NOT NULL DEFAULT 1,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  line_count INTEGER NOT NULL DEFAULT 0,
  lines JSONB,
  file_name TEXT,
  file_type TEXT,
  file_data BYTEA,
  notes TEXT,
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payee_statements_lookup
  ON payee_statements (agency_key, payee_key, payment_period, source);

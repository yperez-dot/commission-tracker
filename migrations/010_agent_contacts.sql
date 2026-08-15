-- Agent contact emails for payroll statement delivery
CREATE TABLE IF NOT EXISTS agent_contacts (
  id SERIAL PRIMARY KEY,
  agent_name TEXT UNIQUE NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_contacts_name_lower
  ON agent_contacts (LOWER(TRIM(agent_name)));

-- Machine API keys for Igor and other automations.
-- Store only SHA-256 hex of the secret. Never store the plaintext key.

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id),
  email TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;

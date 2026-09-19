const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    pool.on('error', (err) => console.error('Database pool error:', err));
  }
  return pool;
}

async function initSchema() {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'agent',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

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

      CREATE TABLE IF NOT EXISTS uploads (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        carrier TEXT,
        row_count INTEGER DEFAULT 0,
        commission_sum REAL DEFAULT 0,
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS commission_records (
        id SERIAL PRIMARY KEY,
        upload_id INTEGER REFERENCES uploads(id) ON DELETE CASCADE,
        agent_name TEXT,
        carrier TEXT,
        plan_type TEXT,
        client_full_name TEXT,
        effective_date TEXT,
        premium REAL DEFAULT 0,
        commission REAL DEFAULT 0,
        classification TEXT,
        payment_period TEXT,
        policy_number TEXT,
        payee TEXT DEFAULT '',
        raw_data TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS book_of_business (
        id SERIAL PRIMARY KEY,
        agent_name TEXT,
        carrier TEXT NOT NULL,
        client_full_name TEXT NOT NULL,
        policy_number TEXT,
        member_id TEXT,
        date_of_birth TEXT,
        effective_date TEXT,
        plan_type TEXT,
        status TEXT DEFAULT 'active',
        last_commission_date TEXT,
        last_commission_amount REAL DEFAULT 0,
        months_missing INTEGER DEFAULT 0,
        resolution TEXT,
        source TEXT DEFAULT 'statement',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bob_uploads (
        id SERIAL PRIMARY KEY,
        original_name TEXT NOT NULL,
        carrier TEXT,
        row_count INTEGER DEFAULT 0,
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS medicarepro_sales (
        id SERIAL PRIMARY KEY,
        client_name VARCHAR(255),
        agent_name VARCHAR(100),
        carrier VARCHAR(100),
        policy_type VARCHAR(50),
        effective_date DATE,
        status VARCHAR(50),
        policy_number VARCHAR(100),
        plan_name VARCHAR(255),
        upload_batch VARCHAR(7),
        raw_data JSONB,
        uploaded_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE medicarepro_sales ADD COLUMN IF NOT EXISTS agent_name VARCHAR(100);

      CREATE TABLE IF NOT EXISTS medicarepro_uploads (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255),
        upload_batch VARCHAR(7),
        uploaded_at TIMESTAMP DEFAULT NOW(),
        uploaded_by VARCHAR(100),
        record_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'success'
      );

      CREATE TABLE IF NOT EXISTS agency_production (
        id SERIAL PRIMARY KEY,
        agent_name VARCHAR(255),
        client_name VARCHAR(255),
        carrier VARCHAR(100),
        plan_name VARCHAR(255),
        policy_number VARCHAR(100),
        effective_date DATE,
        transaction_date DATE,
        status VARCHAR(50),
        policy_type VARCHAR(50),
        enrollment_type VARCHAR(50),
        state VARCHAR(2),
        county VARCHAR(100),
        upload_batch VARCHAR(7),
        uploaded_at TIMESTAMP DEFAULT NOW(),
        raw_data JSONB
      );

      CREATE TABLE IF NOT EXISTS agency_production_uploads (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255),
        carrier VARCHAR(100),
        upload_batch VARCHAR(7),
        uploaded_at TIMESTAMP DEFAULT NOW(),
        uploaded_by VARCHAR(100),
        record_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'success'
      );

      CREATE INDEX IF NOT EXISTS idx_records_agent ON commission_records(agent_name);
      CREATE INDEX IF NOT EXISTS idx_records_carrier ON commission_records(carrier);
      CREATE INDEX IF NOT EXISTS idx_records_plan_type ON commission_records(plan_type);
      CREATE INDEX IF NOT EXISTS idx_records_payee ON commission_records(payee);
      CREATE INDEX IF NOT EXISTS idx_records_period ON commission_records(payment_period);
      CREATE INDEX IF NOT EXISTS idx_records_client ON commission_records(client_full_name);
      CREATE INDEX IF NOT EXISTS idx_bob_carrier ON book_of_business(carrier);
      CREATE INDEX IF NOT EXISTS idx_bob_client ON book_of_business(client_full_name);
      CREATE INDEX IF NOT EXISTS idx_bob_status ON book_of_business(status);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;

      ALTER TABLE book_of_business ADD COLUMN IF NOT EXISTS member_id TEXT;
      ALTER TABLE book_of_business ADD COLUMN IF NOT EXISTS date_of_birth TEXT;
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_medicarepro_client ON medicarepro_sales(client_name);
      CREATE INDEX IF NOT EXISTS idx_medicarepro_agent ON medicarepro_sales(agent_name);
      CREATE INDEX IF NOT EXISTS idx_medicarepro_carrier ON medicarepro_sales(carrier);
      CREATE INDEX IF NOT EXISTS idx_medicarepro_status ON medicarepro_sales(status);
      CREATE INDEX IF NOT EXISTS idx_medicarepro_batch ON medicarepro_sales(upload_batch);
      CREATE INDEX IF NOT EXISTS idx_medicarepro_uploads_batch ON medicarepro_uploads(upload_batch);
      CREATE INDEX IF NOT EXISTS idx_agency_production_agent ON agency_production(agent_name);
      CREATE INDEX IF NOT EXISTS idx_agency_production_client ON agency_production(client_name);
      CREATE INDEX IF NOT EXISTS idx_agency_production_carrier ON agency_production(carrier);
      CREATE INDEX IF NOT EXISTS idx_agency_production_batch ON agency_production(upload_batch);
      CREATE INDEX IF NOT EXISTS idx_agency_production_eff_date ON agency_production(effective_date);

      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS plan_type TEXT;
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS payee TEXT DEFAULT '';

      -- Migration 2026-05-12 — OliComm business rules columns
      -- See projects/olicomm/business-rules.md for the full reasoning

      -- Where did this row come from?
      -- 'BSI'           = parsed from BSI monthly PDF
      -- 'NHP'           = parsed from NHP semi-monthly Excel
      -- 'direct_carrier'= pulled directly from a carrier portal (UHC, Humana, etc.)
      -- 'manual'        = entered by hand via the UI
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS source TEXT;

      -- Date the underlying policy was originally written.
      -- Used to determine BSI 50/50 split eligibility:
      --   policy_written_date < 2025-07-01 → no BSI split (legacy)
      --   policy_written_date >= 2025-07-01 → BSI split applies
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS policy_written_date DATE;

      -- Full gross commission $$ before any split (the carrier/upline paid us this)
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS gross_commission NUMERIC(12,2);

      -- Net $$ that THEI actually keeps after the BSI split (= gross if no split)
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS thei_share NUMERIC(12,2);

      -- $$ that BSI gets (= 0 if no split applies)
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS bsi_share NUMERIC(12,2);

      -- $$ THEI owes the writing producer (pass-through via ADP).
      -- Only > 0 for ACA agency-only carriers (Molina, Cigna, Ambetter, Florida Blue)
      -- where the producer is a known ACA pass-through agent.
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS producer_payable NUMERIC(12,2);

      -- Boolean: did the 50/50 BSI split apply to this row?
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS split_applies BOOLEAN;

      -- Line of business: MA, MAPD, ACA, Dental, Vision, etc.
      -- Extracted from the statement when possible; derived from carrier+plan otherwise.
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS lob TEXT;

      -- Indexes for the new columns we'll filter/group by in reports
      CREATE INDEX IF NOT EXISTS idx_records_source ON commission_records(source);
      CREATE INDEX IF NOT EXISTS idx_records_lob ON commission_records(lob);
      CREATE INDEX IF NOT EXISTS idx_records_split ON commission_records(split_applies);
      CREATE INDEX IF NOT EXISTS idx_records_policy_date ON commission_records(policy_written_date);

      -- Writer pass-through: downline agents on Yahoska's UHC number (Alan, Sabri, …)
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS liable_agent TEXT;
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS pass_through_collected BOOLEAN DEFAULT FALSE;
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS pass_through_collected_at TIMESTAMPTZ;
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS pass_through_notes TEXT;
      CREATE INDEX IF NOT EXISTS idx_records_liable_agent
        ON commission_records (liable_agent)
        WHERE liable_agent IS NOT NULL;

      -- Migration 2026-07-01: Manual override status for Agency Override Recon
      -- Allows Yahoska to manually pin a row's status (paid/chase_bsi/request_audit/pending)
      -- when the system-matched status is wrong or needs annotation.
      ALTER TABLE agency_production ADD COLUMN IF NOT EXISTS manual_override_status VARCHAR(20);
      ALTER TABLE agency_production ADD COLUMN IF NOT EXISTS manual_override_by VARCHAR(100);
      ALTER TABLE agency_production ADD COLUMN IF NOT EXISTS manual_override_at TIMESTAMP;
      CREATE INDEX IF NOT EXISTS idx_agency_production_manual_override ON agency_production(manual_override_status) WHERE manual_override_status IS NOT NULL;
    `);

    await seedDefaultAdmin(client);

    try {
      const flag = await client.query(`SELECT value FROM schema_meta WHERE key = 'bob_identifiers_backfill_v5'`);
      if (!flag.rows.length || flag.rows[0].value !== 'done') {
        const { backfillBobIdentifiers } = require('../src/bobIdentifierBackfill');
        console.log('Backfilling Book of Business identifiers from production reports...');
        const result = await backfillBobIdentifiers(client);
        await client.query(
          `INSERT INTO schema_meta (key, value, updated_at)
           VALUES ('bob_identifiers_backfill_v5', 'done', NOW())
           ON CONFLICT (key) DO UPDATE SET value = 'done', updated_at = NOW()`
        );
        console.log('BOB identifier backfill complete:', result);
      }
    } catch (err) {
      console.error('BOB identifier backfill skipped:', err.message);
    }

    console.log('Database schema initialized');
  } finally {
    client.release();
  }
}

async function seedDefaultAdmin(client) {
  // Seed: Yahoska + Katy only (both admins). Everyone else can be added via the
  // User Accounts page once they're invited. Passwords were generated 2026-05-12
  // and shared out of band — do NOT commit them as plain text again.
  const seeds = [
    {
      name: 'Yahoska Perez',
      email: 'yahoska@healthexps.com',
      password: process.env.SEED_PASSWORD_YAHOSKA,
      role: 'admin',
    },
    {
      name: 'Katy Robles',
      email: 'katy@healthexps.com',
      password: process.env.SEED_PASSWORD_KATY,
      role: 'admin',
    },
  ];

  for (const seed of seeds) {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [seed.email]);
    if (existing.rows.length === 0) {
      if (!seed.password) {
        console.warn(`Skipping seed for ${seed.email} — no SEED_PASSWORD env var provided.`);
        continue;
      }
      const hash = bcrypt.hashSync(seed.password, 10);
      await client.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        [seed.name, seed.email, hash, seed.role]
      );
      console.log(`Seeded user: ${seed.email}`);
    }
  }
}

module.exports = { getPool, initSchema };

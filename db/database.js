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

      CREATE INDEX IF NOT EXISTS idx_records_agent ON commission_records(agent_name);
      CREATE INDEX IF NOT EXISTS idx_records_carrier ON commission_records(carrier);
      CREATE INDEX IF NOT EXISTS idx_records_plan_type ON commission_records(plan_type);
      CREATE INDEX IF NOT EXISTS idx_records_payee ON commission_records(payee);
      CREATE INDEX IF NOT EXISTS idx_records_period ON commission_records(payment_period);
      CREATE INDEX IF NOT EXISTS idx_records_client ON commission_records(client_full_name);
      CREATE INDEX IF NOT EXISTS idx_bob_carrier ON book_of_business(carrier);
      CREATE INDEX IF NOT EXISTS idx_bob_client ON book_of_business(client_full_name);
      CREATE INDEX IF NOT EXISTS idx_bob_status ON book_of_business(status);

      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS plan_type TEXT;
      ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS payee TEXT DEFAULT '';
    `);

    await seedDefaultAdmin(client);
    console.log('Database schema initialized');
  } finally {
    client.release();
  }
}

async function seedDefaultAdmin(client) {
  const existing = await client.query('SELECT id FROM users WHERE email = $1', ['yahoska@healthexps.com']);
  if (existing.rows.length === 0) {
    const hash = bcrypt.hashSync('HealthExperts2024!', 10);
    await client.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      ['Yahoska Perez', 'yahoska@healthexps.com', hash, 'admin']
    );
    const agents = [
      { name: 'Jill Taylor', email: 'jill@healthexps.com' },
      { name: 'Katy Robles', email: 'katy@healthexps.com' },
      { name: 'Gina Berenguer', email: 'gina@healthexps.com' },
      { name: 'Osmary Orozco', email: 'osmary@healthexps.com' },
      { name: 'Sabri Perez', email: 'sabri@healthexps.com' },
    ];
    const agentHash = bcrypt.hashSync('Agent2024!', 10);
    for (const a of agents) {
      await client.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING',
        [a.name, a.email, agentHash, 'agent']
      );
    }
    console.log('Default users seeded');
  }
}

module.exports = { getPool, initSchema };

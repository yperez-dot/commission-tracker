const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'tracker.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'agent',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      carrier TEXT,
      row_count INTEGER DEFAULT 0,
      commission_sum REAL DEFAULT 0,
      uploaded_by INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS commission_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upload_id INTEGER,
      agent_name TEXT,
      carrier TEXT,
      client_full_name TEXT,
      effective_date TEXT,
      premium REAL DEFAULT 0,
      commission REAL DEFAULT 0,
      classification TEXT,
      payment_period TEXT,
      policy_number TEXT,
      raw_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_records_agent ON commission_records(agent_name);
    CREATE INDEX IF NOT EXISTS idx_records_carrier ON commission_records(carrier);
    CREATE INDEX IF NOT EXISTS idx_records_period ON commission_records(payment_period);
    CREATE INDEX IF NOT EXISTS idx_records_client ON commission_records(client_full_name);
  `);

  seedDefaultAdmin();
}

function seedDefaultAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('yahoska@healthexps.com');
  if (!existing) {
    const hash = bcrypt.hashSync('HealthExperts2024!', 10);
    db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`).run(
      'Yahoska Perez', 'yahoska@healthexps.com', hash, 'admin'
    );

    const agents = [
      { name: 'Jill Taylor', email: 'jill@healthexps.com' },
      { name: 'Katy Robles', email: 'katy@healthexps.com' },
      { name: 'Gina Berenguer', email: 'gina@healthexps.com' },
      { name: 'Osmary Orozco', email: 'osmary@healthexps.com' },
      { name: 'Sabri Perez', email: 'sabri@healthexps.com' },
    ];
    const agentHash = bcrypt.hashSync('Agent2024!', 10);
    const stmt = db.prepare(`INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`);
    agents.forEach(a => stmt.run(a.name, a.email, agentHash, 'agent'));

    console.log('✅ Default users seeded');
    console.log('   Admin: yahoska@healthexps.com / HealthExperts2024!');
    console.log('   Agents: [name]@healthexps.com / Agent2024!');
  }
}

module.exports = { getDb };

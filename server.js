require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['https://melodic-cendol-e1dc49.netlify.app', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-agency-override']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const { initSchema } = require('./db/database');
initSchema().then(() => {
  console.log('✅ Database ready');
}).catch(err => {
  console.error('❌ Database init failed:', err.message);
});

// ONE-TIME AGENT NAME NORMALIZATION (runs once on startup)
const normalizeOnStartup = async () => {
  try {
    const { getPool } = require('./db/database');
    const { normalizeAgentName } = require('./routes/normalize');
    const pool = getPool();
    
    const records = await pool.query('SELECT id, agent_name FROM commission_records');
    let updated = 0;
    
    for (const rec of records.rows) {
      const normalized = normalizeAgentName(rec.agent_name);
      if (normalized !== rec.agent_name) {
        await pool.query('UPDATE commission_records SET agent_name = $1 WHERE id = $2', [normalized, rec.id]);
        updated++;
      }
    }
    
    if (updated > 0) {
      console.log(`✅ Normalized ${updated} agent names`);
    }
  } catch (err) {
    console.error('⚠️  Normalization error:', err.message);
  }
};

normalizeOnStartup();

app.use('/api/auth', require('./routes/auth'));
app.use('/api/files', require('./routes/files'));
app.use('/api/records', require('./routes/records'));
app.use('/api/bob', require('./routes/bob'));
const { router: planChangesRouter } = require('./routes/planChanges');
app.use('/api/plan-changes', planChangesRouter);
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/agent-statements', require('./routes/agent_statements'));
app.use('/api/sales-tracker', require('./routes/sales-tracker'));
app.use('/api/medicarepro', require('./routes/medicarepro'));
app.use('/api/agency-production', require('./routes/agencyproduction'));
app.use('/api/ghl', require('./routes/ghl'));
app.use('/api/loa-statements', require('./routes/loa-statements'));
app.use('/api/admin-fixes', require('./routes/admin-fixes'));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Health Experts Commission Tracker API`);
  console.log(`   Running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

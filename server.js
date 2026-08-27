require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['https://melodic-cendol-e1dc49.netlify.app', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-agency-override', 'x-api-key', 'x-olicomm-api-key']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const { initSchema } = require('./db/database');
initSchema().then(() => {
  console.log('✅ Database ready');
}).catch(err => {
  console.error('❌ Database init failed:', err.message);
});

// ONE-TIME AGENT NAME NORMALIZATION (opt-in — full-table rewrite races with uploads)
const normalizeOnStartup = async () => {
  if (process.env.RUN_STARTUP_NORMALIZE !== 'true') {
    console.log('⏭️  Startup agent-name normalize skipped (set RUN_STARTUP_NORMALIZE=true to enable)');
    return;
  }
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
app.use('/api/pass-through', require('./routes/pass-through').router);
app.use('/api/agent-statements', require('./routes/agent_statements'));
app.use('/api/sales-tracker', require('./routes/sales-tracker'));
app.use('/api/medicarepro', require('./routes/medicarepro'));
app.use('/api/agency-production', require('./routes/agencyproduction'));
app.use('/api/ghl', require('./routes/ghl'));
app.use('/api/loa-statements', require('./routes/loa-statements'));
app.use('/api/override-statements', require('./routes/override-statements'));
app.use('/api/lina-statements', require('./routes/lina-statements'));
app.use('/api/manual-payments', require('./routes/manual-payments'));
app.use('/api/admin-fixes', require('./routes/admin-fixes'));
app.use('/api', require('./routes/edit-commission')); // Manual edit with audit trail
app.use('/api/manual-payments', require('./routes/manual-payments'));

app.get('/api/health', async (req, res) => {
  try {
    const { getPool } = require('./db/database');
    await getPool().query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'error', timestamp: new Date().toISOString() });
  }
});


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Server error', message: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`\n🚀 Health Experts Commission Tracker API`);
  console.log(`   Running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

// Set timeout to 5 minutes for large file uploads (Aetna 2.8MB takes ~30 seconds)
server.timeout = 300000; // 5 minutes
server.keepAliveTimeout = 300000;
server.headersTimeout = 310000; // Slightly higher than keepAliveTimeout

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

// ─── TEMPORARY: Upload 374 Duplicate Cleanup ────────────────────────────────
// Remove after running once
const { getPool } = require('./db/database');
const { requireAuth } = require('./routes/auth');
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

app.delete('/api/admin/cleanup-upload-374', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    console.log('[CLEANUP-374] Starting duplicate cleanup for upload 374...');
    
    // First, count duplicates
    const countResult = await pool.query(`
      WITH duplicates AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY client_full_name, carrier, payment_period, classification
          ORDER BY id
        ) as rn
        FROM commission_records
        WHERE upload_id = 374
      )
      SELECT COUNT(*) as duplicate_count
      FROM duplicates
      WHERE rn > 1
    `);
    
    const duplicateCount = parseInt(countResult.rows[0].duplicate_count);
    console.log(`[CLEANUP-374] Found ${duplicateCount} duplicate records`);
    
    if (duplicateCount === 0) {
      return res.json({ message: 'No duplicates found', deleted: 0 });
    }
    
    // Delete duplicates (keep first occurrence)
    const deleteResult = await pool.query(`
      WITH duplicates AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY client_full_name, carrier, payment_period, classification
          ORDER BY id
        ) as rn
        FROM commission_records
        WHERE upload_id = 374
      )
      DELETE FROM commission_records
      WHERE id IN (
        SELECT id FROM duplicates WHERE rn > 1
      )
    `);
    
    console.log(`[CLEANUP-374] Deleted ${deleteResult.rowCount} duplicate records`);
    
    res.json({ 
      success: true,
      deleted: deleteResult.rowCount,
      message: `Cleaned up ${deleteResult.rowCount} duplicate records from upload 374`
    });
  } catch (error) {
    console.error('[CLEANUP-374] Error:', error);
    res.status(500).json({ error: error.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

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

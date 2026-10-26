'use strict';

/**
 * Stored payee statements.
 *  - POST /issue          snapshot + store an OliComm statement (Lina, Munoz, Mendieta)
 *  - POST /received       store a statement BSI sent us (reference copy + total)
 *  - GET  /               list (no file bytes)      ?payee=&period=
 *  - GET  /compare        OliComm vs BSI total      ?payee=&period=
 *  - GET  /:id            full snapshot incl. lines
 *  - GET  /:id/download   original file
 *  - POST /:id/void       void a statement
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth, requireAdmin } = require('./auth');
const {
  buildLinaCompensationStatement,
  buildLinaCompensationWorkbook,
  filenameForLinaStatement,
} = require('../src/linaCompensationStatement');
const {
  INTEGRITY_PAYEES,
  buildIntegrityStatement,
  buildIntegrityWorkbook,
  filenameForIntegrityStatement,
} = require('../src/integrityStatement');
const { compareStatementTotals } = require('../src/payeeStatementCompare');
const { totalsByPeriodFromLines, DEFAULT_CARRY_START } = require('../src/payeeCarryForward');
const { computeCarryWithLocks } = require('../src/payrollLock');
const { attachAdjustments, statementNet } = require('../src/payrollStatementExtras');
const { bottomLine } = require('../src/payrollLock');
const store = require('./payrollCloseStore');
const { logChange } = require('./change-log');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PAYEES = {
  lina: { key: 'lina', name: 'Alba Hernandez (Lina)' },
  'christian-munoz': { key: 'christian-munoz', name: INTEGRITY_PAYEES['christian-munoz'].displayName },
  'horacio-mendieta': { key: 'horacio-mendieta', name: INTEGRITY_PAYEES['horacio-mendieta'].displayName },
};

function agencyKey(req) {
  const raw = req.query.agency || (req.body && req.body.agency) ||
    req.headers['x-agency-override'] || (req.user && req.user.agency) || 'thei';
  const s = String(raw || 'thei').toLowerCase();
  return s.includes('broker society') || s === 'bsi' ? 'bsi' : 'thei';
}

let tableReady = false;
async function ensureTable(pool) {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payee_statements (
      id SERIAL PRIMARY KEY,
      agency_key TEXT NOT NULL DEFAULT 'thei',
      payee_key TEXT NOT NULL,
      payee_name TEXT NOT NULL,
      payment_period TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'olicomm',
      status TEXT NOT NULL DEFAULT 'issued',
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
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payee_statements_lookup
    ON payee_statements (agency_key, payee_key, payment_period, source)`);
  tableReady = true;
}

const COLS = `id, agency_key, payee_key, payee_name, payment_period, source, status, version,
  total, line_count, file_name, file_type, notes, issued_date, created_by, created_at`;

const ROW_COLS = `id, agent_name, client_full_name, policy_number, carrier, effective_date,
  payment_period, classification, producer_payable, commission, source`;

async function fetchRows(pool, payeeKey, period) {
  const params = [period];
  let agentSql;
  if (payeeKey === 'lina') {
    agentSql = `(agent_name ILIKE '%alba%hernandez%' OR agent_name ILIKE '%lina%hernandez%' OR agent_name ILIKE '%alba%ritela%')`;
  } else if (payeeKey === 'christian-munoz') {
    // Wide pre-filter (middle initial, "Last, First"); buildIntegrityStatement narrows it.
    agentSql = `(agent_name ILIKE '%christian%munoz%' OR agent_name ILIKE '%munoz%christian%'
      OR agent_name ILIKE '%cam insurance solutions corp%')`;
  } else {
    agentSql = `(agent_name ILIKE '%horacio%mendieta%' OR agent_name ILIKE '%mendieta%horacio%')`;
  }
  const r = await pool.query(
    `SELECT ${ROW_COLS} FROM commission_records
      WHERE ${agentSql} AND COALESCE(producer_payable,0) <> 0
        AND ($1 = 'all' OR payment_period = $1)
      ORDER BY carrier, policy_number, id`,
    params
  );
  return r.rows;
}

/** Per-period balances for a payee (all periods), used for carry-forward. */
async function periodTotals(pool, payeeKey) {
  const rows = await fetchRows(pool, payeeKey, 'all');
  const st = payeeKey === 'lina'
    ? buildLinaCompensationStatement(rows, { period: 'all' })
    : buildIntegrityStatement(rows, payeeKey, { period: 'all' });
  return totalsByPeriodFromLines(st.lines);
}

/**
 * Carry-forward for a statement payee, honoring month locks (frozen snapshots)
 * and manual adjustment lines. See src/payrollLock.js.
 */
async function carryFor(pool, payeeKey, period, ak = 'thei') {
  const name = store.STATEMENT_PAYEE_NAMES[payeeKey];
  return computeCarryWithLocks(
    await periodTotals(pool, payeeKey),
    await store.adjustmentTotals(pool, ak, name),
    await store.loadLocks(pool, ak, name),
    period,
    DEFAULT_CARRY_START
  );
}

async function buildFor(pool, payeeKey, period, ak = 'thei') {
  const rows = await fetchRows(pool, payeeKey, period);
  const monthly = /^\d{6}$/.test(period);
  const carry = monthly ? await carryFor(pool, payeeKey, period, ak) : null;
  const adjustments = monthly
    ? await store.loadAdjustments(pool, ak, store.STATEMENT_PAYEE_NAMES[payeeKey], period)
    : [];
  if (payeeKey === 'lina') {
    const statement = buildLinaCompensationStatement(rows, { period });
    attachAdjustments(statement, adjustments);
    statement.carry = carry;
    statement.bottomLine = bottomLine(statementNet(statement));
    const wb = await buildLinaCompensationWorkbook(statement);
    return {
      statement, total: statement.balanceAfterAdjustments, lines: statement.lines, carry,
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
      filename: filenameForLinaStatement(statement),
    };
  }
  const statement = buildIntegrityStatement(rows, payeeKey, { period });
  attachAdjustments(statement, adjustments);
  statement.carry = carry;
  statement.bottomLine = bottomLine(statementNet(statement));
  const wb = await buildIntegrityWorkbook(statement);
  return {
    statement, total: statement.balanceAfterAdjustments, lines: statement.lines, carry,
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: filenameForIntegrityStatement(statement),
  };
}

/** GET /carry?period=YYYYMM — carry-forward and amount payable for every payee */
router.get('/carry', requireAuth, async (req, res) => {
  try {
    const period = String(req.query.period || '');
    if (!/^\d{6}$/.test(period)) return res.status(400).json({ error: 'period must be YYYYMM' });
    const pool = getPool();
    const ak = agencyKey(req);
    const out = {};
    for (const key of Object.keys(PAYEES)) {
      out[store.STATEMENT_PAYEE_NAMES[key]] = await carryFor(pool, key, period, ak);
    }
    res.json(out);
  } catch (err) {
    console.error('[payee-statements] carry', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /preview?payee=&period= — live (unstored) statement, any signed-in user */
router.get('/preview', requireAuth, async (req, res) => {
  try {
    const { payee, period } = req.query;
    if (!PAYEES[payee]) return res.status(400).json({ error: 'unknown payee' });
    if (!period) return res.status(400).json({ error: 'period is required' });
    const pool = getPool();
    const built = await buildFor(pool, payee, String(period), agencyKey(req));
    res.json(built.statement);
  } catch (err) {
    console.error('[payee-statements] preview', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /preview-download?payee=&period= — live Excel download */
router.get('/preview-download', requireAuth, async (req, res) => {
  try {
    const { payee, period } = req.query;
    if (!PAYEES[payee]) return res.status(400).json({ error: 'unknown payee' });
    if (!period) return res.status(400).json({ error: 'period is required' });
    const pool = getPool();
    // Locked (paid / closed) month: hand back the frozen statement, not a rebuild.
    if (/^\d{6}$/.test(String(period))) {
      const lock = await store.activeLock(pool, agencyKey(req), store.STATEMENT_PAYEE_NAMES[payee], String(period));
      if (lock && lock.statement_id) {
        await ensureTable(pool);
        const f = await pool.query(`SELECT file_name, file_data FROM payee_statements WHERE id=$1`, [lock.statement_id]);
        if (f.rows.length && f.rows[0].file_data) {
          res.setHeader('Content-Type', XLSX);
          res.setHeader('Content-Disposition', `attachment; filename="${String(f.rows[0].file_name || 'statement.xlsx').replace(/"/g, '')}"`);
          return res.send(f.rows[0].file_data);
        }
      }
    }
    const built = await buildFor(pool, payee, String(period), agencyKey(req));
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${built.filename}"`);
    res.send(built.buffer);
  } catch (err) {
    console.error('[payee-statements] preview-download', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /issue { payee, period, notes } */
router.post('/issue', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { payee, period, notes } = req.body || {};
    if (!PAYEES[payee]) return res.status(400).json({ error: 'unknown payee' });
    if (!/^\d{6}$/.test(String(period || ''))) {
      return res.status(400).json({ error: 'period must be YYYYMM' });
    }
    const pool = getPool();
    const ak = agencyKey(req);
    if (await store.activeLock(pool, ak, store.STATEMENT_PAYEE_NAMES[payee], String(period))) {
      return res.status(409).json({ error: 'That month is locked (sent or closed). Unlock it first, or post a prior-period correction in an open month.' });
    }
    const row = await issueStatement(pool, req, payee, String(period), notes);
    if (!row) return res.status(400).json({ error: 'No lines for that payee/period — nothing to issue' });
    res.json(row);
  } catch (err) {
    console.error('[payee-statements] issue', err);
    res.status(500).json({ error: err.message });
  }
});

/** Snapshot + store a statement version. Returns the stored row (no bytes) or null if empty. */
async function issueStatement(pool, req, payee, period, notes, prebuilt) {
    await ensureTable(pool);
    const ak = agencyKey(req);
    const built = prebuilt || await buildFor(pool, payee, String(period), ak);
    if (!built.lines.length && !(built.statement.adjustments || []).length) return null;
    const prev = await pool.query(
      `SELECT COALESCE(MAX(version),0) AS v FROM payee_statements
        WHERE agency_key=$1 AND payee_key=$2 AND payment_period=$3 AND source='olicomm'`,
      [ak, payee, period]
    );
    const version = Number(prev.rows[0].v) + 1;
    await pool.query(
      `UPDATE payee_statements SET status='superseded'
        WHERE agency_key=$1 AND payee_key=$2 AND payment_period=$3
          AND source='olicomm' AND status='issued'`,
      [ak, payee, period]
    );
    const ins = await pool.query(
      `INSERT INTO payee_statements
         (agency_key, payee_key, payee_name, payment_period, source, status, version,
          total, line_count, lines, file_name, file_type, file_data, notes, created_by)
       VALUES ($1,$2,$3,$4,'olicomm','issued',$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${COLS}`,
      [ak, payee, PAYEES[payee].name, period, version, built.total, built.lines.length,
        JSON.stringify(built.lines), built.filename, XLSX, built.buffer, notes || null,
        (req.user && (req.user.email || req.user.username)) || null]
    );
    await logChange(pool, req, {
      type: 'statement.issued', entityType: 'payee_statement', entityId: ins.rows[0].id,
      period, payee: store.STATEMENT_PAYEE_NAMES[payee],
      summary: `Issued ${store.STATEMENT_PAYEE_NAMES[payee]} statement v${version} for ${period}: ${Number(built.total).toFixed(2)}`,
      details: { version, total: built.total, lineCount: built.lines.length },
    });
    return ins.rows[0];
}

/** POST /received (multipart: file, payee, period, total, notes) — BSI's copy */
router.post('/received', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const { payee, period, notes } = req.body || {};
    const total = parseFloat(req.body && req.body.total);
    if (!PAYEES[payee]) return res.status(400).json({ error: 'unknown payee' });
    if (!/^\d{6}$/.test(String(period || ''))) return res.status(400).json({ error: 'period must be YYYYMM' });
    if (!Number.isFinite(total)) return res.status(400).json({ error: 'total (balance on the BSI statement) is required' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const pool = getPool();
    await ensureTable(pool);
    const ak = agencyKey(req);
    const ins = await pool.query(
      `INSERT INTO payee_statements
         (agency_key, payee_key, payee_name, payment_period, source, status, version,
          total, line_count, file_name, file_type, file_data, notes, created_by)
       VALUES ($1,$2,$3,$4,'bsi_received','issued',1,$5,0,$6,$7,$8,$9,$10)
       RETURNING ${COLS}`,
      [ak, payee, PAYEES[payee].name, period, Math.round(total * 100) / 100,
        req.file.originalname, req.file.mimetype, req.file.buffer, notes || null,
        (req.user && (req.user.email || req.user.username)) || null]
    );
    res.json(ins.rows[0]);
  } catch (err) {
    console.error('[payee-statements] received', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET / ?payee=&period= */
router.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const params = [agencyKey(req)];
    let where = 'WHERE agency_key = $1';
    if (req.query.payee) { params.push(req.query.payee); where += ` AND payee_key = $${params.length}`; }
    if (req.query.period) { params.push(req.query.period); where += ` AND payment_period = $${params.length}`; }
    const r = await pool.query(
      `SELECT ${COLS} FROM payee_statements ${where} ORDER BY payment_period DESC, payee_key, created_at DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[payee-statements] list', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /compare?payee=&period= — current OliComm total vs issued vs BSI-received */
router.get('/compare', requireAuth, async (req, res) => {
  try {
    const { payee, period } = req.query;
    if (!PAYEES[payee] || !period) return res.status(400).json({ error: 'payee and period are required' });
    const pool = getPool();
    await ensureTable(pool);
    const ak = agencyKey(req);
    const live = await buildFor(pool, payee, String(period), ak);
    const stored = await pool.query(
      `SELECT ${COLS} FROM payee_statements
        WHERE agency_key=$1 AND payee_key=$2 AND payment_period=$3 AND status='issued'
        ORDER BY created_at DESC`,
      [ak, payee, period]
    );
    const issued = stored.rows.find((s) => s.source === 'olicomm') || null;
    const received = stored.rows.find((s) => s.source === 'bsi_received') || null;
    res.json(compareStatementTotals({
      liveTotal: live.total,
      issuedTotal: issued ? Number(issued.total) : null,
      receivedTotal: received ? Number(received.total) : null,
      issued, received,
    }));
  } catch (err) {
    console.error('[payee-statements] compare', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const r = await pool.query(
      `SELECT ${COLS}, lines FROM payee_statements WHERE id=$1 AND agency_key=$2`,
      [req.params.id, agencyKey(req)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id(\\d+)/download', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const r = await pool.query(
      `SELECT file_name, file_type, file_data FROM payee_statements WHERE id=$1 AND agency_key=$2`,
      [req.params.id, agencyKey(req)]
    );
    if (!r.rows.length || !r.rows[0].file_data) return res.status(404).json({ error: 'no file stored' });
    const row = r.rows[0];
    res.setHeader('Content-Type', row.file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(row.file_name || 'statement').replace(/"/g, '')}"`);
    res.send(row.file_data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id(\\d+)/void', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = getPool();
    await ensureTable(pool);
    const r = await pool.query(
      `UPDATE payee_statements SET status='void' WHERE id=$1 AND agency_key=$2 RETURNING ${COLS}`,
      [req.params.id, agencyKey(req)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    await logChange(pool, req, {
      type: 'statement.voided', entityType: 'payee_statement', entityId: r.rows[0].id,
      period: r.rows[0].payment_period, payee: r.rows[0].payee_name,
      summary: `Voided ${r.rows[0].payee_name} statement v${r.rows[0].version} for ${r.rows[0].payment_period}`,
      details: { reason: (req.body && req.body.reason) || null },
    });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.PAYEES = PAYEES;
module.exports.buildFor = buildFor;
module.exports.carryFor = carryFor;
module.exports.periodTotals = periodTotals;
module.exports.issueStatement = issueStatement;
module.exports.ensureStatementTable = ensureTable;

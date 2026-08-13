'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const {
  STATEMENT_TYPES,
  buildOverrideStatements,
  statementToCsv,
  summaryToCsv,
  filenameFor,
} = require('../src/overrideStatementBuilder');

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

const SELECT_COLS = `
  id, agent_name, client_full_name, policy_number, carrier, effective_date,
  payment_period, classification, commission, gross_commission, thei_share, bsi_share,
  producer_payable, sub_agent_override, payee, source
`;

async function fetchOverrideRows(pool, period, type) {
  const params = [];
  // Override Statements are for THEI/BSI/Marco/Integrity only.
  // Lina Hernandez is paid agent production via Agent Statements — never overrides.
  let where = `WHERE classification ILIKE '%override%'`;
  if (period && period !== 'all') {
    params.push(period);
    where += ` AND payment_period = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT ${SELECT_COLS} FROM commission_records ${where} ORDER BY payment_period, agent_name, id`,
    params
  );
  return result.rows;
}

/** GET /api/override-statements/types */
router.get('/types', requireAuth, (_req, res) => {
  res.json({
    types: [
      {
        id: STATEMENT_TYPES.THEI_OVERRIDE,
        label: 'THEI Overrides',
        amountField: 'thei_share',
        description: 'THEI remittance view of Agency Override rows',
      },
      {
        id: STATEMENT_TYPES.BSI_OVERRIDE,
        label: 'BSI Overrides',
        amountField: 'bsi_share',
        description: 'BSI house share of Agency Override rows',
      },
      {
        id: STATEMENT_TYPES.MARCO,
        label: 'Marco',
        amountField: 'sub_agent_override',
        description: '$10/policy rollup across Marco downline agents',
      },
      {
        id: STATEMENT_TYPES.INTEGRITY,
        label: 'Chris / CAM / Integrity',
        amountField: 'producer_payable',
        description: 'Integrity Partners 50% producer statements',
      },
    ],
  });
});

/** GET /api/override-statements/periods */
router.get('/periods', requireAuth, async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT payment_period AS period, COUNT(*)::int AS override_rows
      FROM commission_records
      WHERE payment_period IS NOT NULL
        AND payment_period <> ''
        AND payment_period <> 'Unknown'
        AND classification ILIKE '%override%'
      GROUP BY 1
      ORDER BY 1 DESC
    `);
    res.json({ periods: result.rows });
  } catch (err) {
    console.error('[override-statements] periods', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/override-statements/preview?type=thei_override&period=202601
 * Returns JSON summary + per-payee totals (no CSV).
 */
router.get('/preview', requireAuth, async (req, res) => {
  try {
    const type = String(req.query.type || '');
    const period = String(req.query.period || 'all');
    if (!Object.values(STATEMENT_TYPES).includes(type)) {
      return res.status(400).json({ error: `Invalid type. Use one of: ${Object.values(STATEMENT_TYPES).join(', ')}` });
    }
    const pool = getPool();
    const rows = await fetchOverrideRows(pool, period, type);
    const bundle = buildOverrideStatements(rows, type, { period });
    res.json({
      type: bundle.type,
      period: bundle.period,
      periodLabel: bundle.periodLabel,
      statementCount: bundle.statementCount,
      grandTotal: bundle.grandTotal,
      statements: bundle.statements.map((s) => ({
        payee: s.payee,
        lineCount: s.lineCount,
        total: s.total,
      })),
    });
  } catch (err) {
    console.error('[override-statements] preview', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/override-statements/export?type=marco&period=202601&payee=Marco
 * CSV download. Omit payee for multi-payee zip-less concatenated summary + files is too heavy —
 * without payee returns summary CSV; with payee returns that statement.
 */
router.get('/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const type = String(req.query.type || '');
    const period = String(req.query.period || 'all');
    const payee = req.query.payee ? String(req.query.payee) : null;
    if (!Object.values(STATEMENT_TYPES).includes(type)) {
      return res.status(400).json({ error: `Invalid type. Use one of: ${Object.values(STATEMENT_TYPES).join(', ')}` });
    }
    const pool = getPool();
    const rows = await fetchOverrideRows(pool, period, type);
    const bundle = buildOverrideStatements(rows, type, { period });

    let csv;
    let filename;
    if (payee) {
      const stmt = bundle.statements.find(
        (s) => s.payee.toLowerCase() === payee.toLowerCase()
      );
      if (!stmt) {
        return res.status(404).json({ error: `No statement for payee "${payee}"` });
      }
      csv = statementToCsv(bundle, stmt);
      filename = filenameFor(bundle, stmt.payee);
    } else {
      csv = summaryToCsv(bundle);
      filename = filenameFor(bundle, 'SUMMARY');
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[override-statements] export', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/override-statements/export-all?type=integrity&period=202601
 * Returns JSON with each payee's CSV embedded (for UI multi-download).
 */
router.get('/export-all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const type = String(req.query.type || '');
    const period = String(req.query.period || 'all');
    if (!Object.values(STATEMENT_TYPES).includes(type)) {
      return res.status(400).json({ error: `Invalid type` });
    }
    const pool = getPool();
    const rows = await fetchOverrideRows(pool, period, type);
    const bundle = buildOverrideStatements(rows, type, { period });
    res.json({
      type: bundle.type,
      period: bundle.period,
      periodLabel: bundle.periodLabel,
      grandTotal: bundle.grandTotal,
      files: bundle.statements.map((s) => ({
        payee: s.payee,
        filename: filenameFor(bundle, s.payee),
        total: s.total,
        lineCount: s.lineCount,
        csv: statementToCsv(bundle, s),
      })),
      summaryFilename: filenameFor(bundle, 'SUMMARY'),
      summaryCsv: summaryToCsv(bundle),
    });
  } catch (err) {
    console.error('[override-statements] export-all', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

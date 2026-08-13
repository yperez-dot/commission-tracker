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
const {
  buildOverrideExcelWorkbook,
  filenameForOverrideExcel,
} = require('../src/overrideExcelStatement');

/** Override Statements tab — Lina/agent production is Agent Payouts only. */
const OVERRIDE_UI_TYPES = [
  STATEMENT_TYPES.THEI_OVERRIDE,
  STATEMENT_TYPES.BSI_OVERRIDE,
  STATEMENT_TYPES.MARCO,
  STATEMENT_TYPES.INTEGRITY,
];

const EXCEL_TYPES = new Set([
  STATEMENT_TYPES.THEI_OVERRIDE,
  STATEMENT_TYPES.BSI_OVERRIDE,
]);

function isValidOverrideType(type) {
  return OVERRIDE_UI_TYPES.includes(type);
}

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
  // THEI/BSI: Agency Override rows PLUS Alba rate-peeled agent-production shares.
  // Marco/Integrity: Agency Override only.
  // Lina's producer_payable itself is Agent Payouts / Lina Excel — not these statements.
  const includeAlbaPeel =
    type === STATEMENT_TYPES.THEI_OVERRIDE || type === STATEMENT_TYPES.BSI_OVERRIDE;
  let where = includeAlbaPeel
    ? `WHERE (
         classification ILIKE '%override%'
         OR (
           (agent_name ILIKE '%alba%hernandez%' OR agent_name ILIKE '%lina%hernandez%' OR agent_name ILIKE '%alba%ritela%')
           AND classification NOT ILIKE '%override%'
           AND classification NOT ILIKE '%held%'
           AND (COALESCE(thei_share,0) <> 0 OR COALESCE(bsi_share,0) <> 0)
         )
       )`
    : `WHERE classification ILIKE '%override%'`;
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

function pickPayeeStatement(bundle, payee) {
  if (!bundle.statements.length) return null;
  if (payee) {
    return (
      bundle.statements.find((s) => s.payee.toLowerCase() === String(payee).toLowerCase()) ||
      null
    );
  }
  // THEI/BSI typically one house payee — default to the largest absolute total
  return [...bundle.statements].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))[0];
}

/** GET /api/override-statements/types */
router.get('/types', requireAuth, (_req, res) => {
  res.json({
    types: [
      {
        id: STATEMENT_TYPES.THEI_OVERRIDE,
        label: 'THEI Overrides',
        amountField: 'thei_share',
        description: 'THEI 50% of Agency Override + Alba rate-peeled production shares',
        exportFormat: 'xlsx',
      },
      {
        id: STATEMENT_TYPES.BSI_OVERRIDE,
        label: 'BSI Overrides',
        amountField: 'bsi_share',
        description: 'BSI 50% of Agency Override + Alba rate-peeled production shares',
        exportFormat: 'xlsx',
      },
      {
        id: STATEMENT_TYPES.MARCO,
        label: 'Marco',
        amountField: 'sub_agent_override',
        description: '$10/policy rollup across Marco downline agents',
        exportFormat: 'csv',
      },
      {
        id: STATEMENT_TYPES.INTEGRITY,
        label: 'Chris / CAM / Integrity',
        amountField: 'producer_payable',
        description: 'Integrity Partners 50% producer statements',
        exportFormat: 'csv',
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
    if (!isValidOverrideType(type)) {
      return res.status(400).json({ error: `Invalid type. Use one of: ${OVERRIDE_UI_TYPES.join(', ')}` });
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
      exportFormat: EXCEL_TYPES.has(type) ? 'xlsx' : 'csv',
      statements: bundle.statements.map((s) => ({
        payee: s.payee,
        lineCount: s.lineCount,
        total: s.total,
        lines: (s.lines || []).map((l) => ({
          policy_number: l.policy_number,
          client_full_name: l.client_full_name,
          carrier: l.carrier,
          classification: l.classification,
          writing_agent: l.writing_agent,
          amount: l.amount,
        })),
      })),
    });
  } catch (err) {
    console.error('[override-statements] preview', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/override-statements/export-xlsx?type=thei_override&period=202601&payee=...
 * Excel download for THEI / BSI override statements (Lina-quality template).
 */
router.get('/export-xlsx', requireAuth, requireAdmin, async (req, res) => {
  try {
    const type = String(req.query.type || '');
    const period = String(req.query.period || 'all');
    const payee = req.query.payee ? String(req.query.payee) : null;
    if (!EXCEL_TYPES.has(type)) {
      return res.status(400).json({
        error: 'Excel export is for thei_override / bsi_override. Use /export for CSV types.',
      });
    }
    const pool = getPool();
    const rows = await fetchOverrideRows(pool, period, type);
    const bundle = buildOverrideStatements(rows, type, { period });
    const stmt = pickPayeeStatement(bundle, payee);
    if (!stmt) {
      return res.status(404).json({
        error: payee ? `No statement for payee "${payee}"` : 'No override lines',
      });
    }
    const wb = await buildOverrideExcelWorkbook(bundle, stmt);
    const buffer = await wb.xlsx.writeBuffer();
    const filename = filenameForOverrideExcel(bundle, stmt.payee);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[override-statements] export-xlsx', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/override-statements/export?type=marco&period=202601&payee=Marco
 * CSV download (Marco / Integrity). THEI/BSI with payee redirect to Excel.
 */
router.get('/export', requireAuth, requireAdmin, async (req, res) => {
  try {
    const type = String(req.query.type || '');
    const period = String(req.query.period || 'all');
    const payee = req.query.payee ? String(req.query.payee) : null;
    if (!isValidOverrideType(type)) {
      return res.status(400).json({ error: `Invalid type. Use one of: ${OVERRIDE_UI_TYPES.join(', ')}` });
    }
    // THEI/BSI Excel lives at /export-xlsx (Bearer auth). This route stays CSV.
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
 * Returns JSON with each payee's CSV (or xlsxBase64 for THEI/BSI).
 */
router.get('/export-all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const type = String(req.query.type || '');
    const period = String(req.query.period || 'all');
    if (!isValidOverrideType(type)) {
      return res.status(400).json({ error: `Invalid type. Use one of: ${OVERRIDE_UI_TYPES.join(', ')}` });
    }
    const pool = getPool();
    const rows = await fetchOverrideRows(pool, period, type);
    const bundle = buildOverrideStatements(rows, type, { period });
    const wantExcel = EXCEL_TYPES.has(type);

    const files = [];
    for (const s of bundle.statements) {
      const entry = {
        payee: s.payee,
        filename: wantExcel
          ? filenameForOverrideExcel(bundle, s.payee)
          : filenameFor(bundle, s.payee),
        total: s.total,
        lineCount: s.lineCount,
        format: wantExcel ? 'xlsx' : 'csv',
        csv: wantExcel ? undefined : statementToCsv(bundle, s),
      };
      if (wantExcel) {
        const wb = await buildOverrideExcelWorkbook(bundle, s);
        const buffer = await wb.xlsx.writeBuffer();
        entry.xlsxBase64 = Buffer.from(buffer).toString('base64');
      }
      files.push(entry);
    }

    res.json({
      type: bundle.type,
      period: bundle.period,
      periodLabel: bundle.periodLabel,
      grandTotal: bundle.grandTotal,
      exportFormat: wantExcel ? 'xlsx' : 'csv',
      files,
      summaryFilename: filenameFor(bundle, 'SUMMARY'),
      summaryCsv: summaryToCsv(bundle),
    });
  } catch (err) {
    console.error('[override-statements] export-all', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

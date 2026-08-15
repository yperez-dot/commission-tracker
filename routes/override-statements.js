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
const { isTheiHouseType } = require('../src/payeeSchedules');
const {
  buildOverrideExcelWorkbook,
  filenameForOverrideExcel,
} = require('../src/overrideExcelStatement');

/** Override Statements tab — Lina/agent production is Agent Payouts only. */
const OVERRIDE_UI_TYPES = [
  STATEMENT_TYPES.THEI_NHP,
  STATEMENT_TYPES.THEI_BSI,
  STATEMENT_TYPES.BSI_OVERRIDE,
  STATEMENT_TYPES.MARCO,
  STATEMENT_TYPES.INTEGRITY,
];

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
  cr.id, cr.agent_name, cr.client_full_name, cr.policy_number, cr.carrier, cr.effective_date,
  cr.payment_period, cr.classification, cr.commission, cr.gross_commission, cr.thei_share, cr.bsi_share,
  cr.producer_payable, cr.sub_agent_override, cr.payee, cr.source,
  u.original_name AS upload_original_name
`;

async function backfillNhpSourceFromUploads(pool) {
  const result = await pool.query(`
    UPDATE commission_records cr
    SET source = 'NHP'
    FROM uploads u
    WHERE cr.upload_id = u.id
      AND (
        cr.source IS NULL
        OR TRIM(cr.source) = ''
        OR LOWER(cr.source) IN ('direct_carrier', 'direct')
      )
      AND (
        LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%the_health_experts_insurance_statement%'
        OR LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%the_health_experst_insurance%'
        OR (
          LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%the_health_experts%'
          AND LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%statement%'
        )
        OR (
          LOWER(u.original_name) LIKE '%yahoska%'
          AND LOWER(u.original_name) LIKE '%katy%'
        )
        OR LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%_nhp_%'
        OR LOWER(REPLACE(u.original_name, ' ', '_')) LIKE 'nhp_%'
        OR LOWER(COALESCE(cr.payee, '')) = 'nhp'
      )
  `);
  return result.rowCount || 0;
}

/** Tailored ACA was sometimes booked as THEI override — move to agent pay. */
async function backfillTailoredAcaToAgentPay(pool) {
  const result = await pool.query(`
    UPDATE commission_records
    SET
      producer_payable = CASE
        WHEN COALESCE(producer_payable, 0) <> 0 THEN producer_payable
        WHEN COALESCE(thei_share, 0) <> 0 THEN thei_share
        WHEN COALESCE(commission, 0) <> 0 THEN commission
        ELSE COALESCE(gross_commission, 0)
      END,
      thei_share = 0,
      bsi_share = 0,
      commission = 0,
      classification = CASE
        WHEN COALESCE(
          NULLIF(producer_payable, 0),
          NULLIF(thei_share, 0),
          NULLIF(commission, 0),
          NULLIF(gross_commission, 0),
          0
        ) < 0 THEN 'ACA Agent Chargeback'
        ELSE 'ACA Agent Commission'
      END
    WHERE LOWER(agent_name) LIKE '%tailored%'
      AND UPPER(COALESCE(lob, '')) = 'ACA'
      AND (
        COALESCE(thei_share, 0) <> 0
        OR classification ILIKE '%aca%override%'
        OR classification ILIKE '%agency override%'
      )
  `);
  return result.rowCount || 0;
}

async function fetchOverrideRows(pool, period, type) {
  const params = [];
  // THEI/BSI: Agency Override rows PLUS Alba rate-peeled agent-production shares.
  // Marco/Integrity: Agency Override only.
  // Lina's producer_payable itself is Agent Payouts / Lina Excel — not these statements.
  const includeAlbaPeel = isTheiHouseType(type) || type === STATEMENT_TYPES.BSI_OVERRIDE;
  let where = includeAlbaPeel
    ? `WHERE (
         cr.classification ILIKE '%override%'
         OR (
           (cr.agent_name ILIKE '%alba%hernandez%' OR cr.agent_name ILIKE '%lina%hernandez%' OR cr.agent_name ILIKE '%alba%ritela%')
           AND cr.classification NOT ILIKE '%override%'
           AND cr.classification NOT ILIKE '%held%'
           AND (COALESCE(cr.thei_share,0) <> 0 OR COALESCE(cr.bsi_share,0) <> 0)
         )
       )`
    : `WHERE cr.classification ILIKE '%override%'`;
  if (period && period !== 'all') {
    params.push(period);
    where += ` AND cr.payment_period = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT ${SELECT_COLS}
     FROM commission_records cr
     LEFT JOIN uploads u ON u.id = cr.upload_id
     ${where}
     ORDER BY cr.payment_period, cr.agent_name, cr.id`,
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
        id: STATEMENT_TYPES.THEI_NHP,
        label: 'THEI — NHP sales',
        amountField: 'thei_share',
        description: 'THEI share of NHP agency statement sales only',
        exportFormat: 'xlsx',
      },
      {
        id: STATEMENT_TYPES.THEI_BSI,
        label: 'THEI — BSI remittance',
        amountField: 'thei_share',
        description: 'THEI share of what BSI pays us (BSI remittance)',
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
        label: 'Marco (Swan)',
        amountField: 'sub_agent_override',
        description: '$10/policy agency peel (Swan / Marco) across downline — not an agent payout',
        exportFormat: 'xlsx',
      },
      {
        id: STATEMENT_TYPES.INTEGRITY,
        label: 'Chris / CAM / Integrity',
        amountField: 'producer_payable',
        description: 'Integrity Partners 50% producer statements (agency schedule)',
        exportFormat: 'xlsx',
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
    let nhpSourceBackfilled = 0;
    if (type === STATEMENT_TYPES.THEI_NHP) {
      try {
        nhpSourceBackfilled = await backfillNhpSourceFromUploads(pool);
        if (nhpSourceBackfilled) {
          console.log(`[override-statements] backfilled source=NHP on ${nhpSourceBackfilled} rows`);
        }
      } catch (e) {
        console.warn('[override-statements] NHP source backfill', e.message);
      }
    }
    const rows = await fetchOverrideRows(pool, period, type);
    const bundle = buildOverrideStatements(rows, type, { period });

    let sourceUploads = [];
    if (type === STATEMENT_TYPES.THEI_NHP || type === STATEMENT_TYPES.THEI_BSI || type === STATEMENT_TYPES.BSI_OVERRIDE) {
      try {
        const periodClause = period && period !== 'all' ? 'AND cr.payment_period = $1' : '';
        const params = period && period !== 'all' ? [period] : [];
        const sourceFilter =
          type === STATEMENT_TYPES.THEI_NHP
            ? `AND (
                 UPPER(COALESCE(cr.source,'')) = 'NHP'
                 OR LOWER(COALESCE(cr.payee,'')) = 'nhp'
                 OR LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%the_health_experts_insurance_statement%'
                 OR LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%health_experts%statement%'
                 OR (LOWER(u.original_name) LIKE '%yahoska%' AND LOWER(u.original_name) LIKE '%katy%')
                 OR LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%nhp%'
               )`
            : type === STATEMENT_TYPES.THEI_BSI
              ? `AND (cr.source IN ('BSI','BSI_PAYEE') OR u.category = 'bsi_statement')`
              : '';
        const up = await pool.query(
          `SELECT u.id, u.original_name, COUNT(cr.id)::int AS row_count,
                  COALESCE(SUM(COALESCE(cr.thei_share,0)),0)::float AS thei_sum,
                  COALESCE(SUM(COALESCE(cr.bsi_share,0)),0)::float AS bsi_sum
           FROM commission_records cr
           JOIN uploads u ON u.id = cr.upload_id
           WHERE cr.classification ILIKE '%override%'
             ${periodClause}
             ${sourceFilter}
           GROUP BY u.id, u.original_name
           ORDER BY u.id DESC`,
          params
        );
        sourceUploads = up.rows;
      } catch (e) {
        console.warn('[override-statements] sourceUploads', e.message);
      }
    }

    res.json({
      type: bundle.type,
      period: bundle.period,
      periodLabel: bundle.periodLabel,
      statementCount: bundle.statementCount,
      grandTotal: bundle.grandTotal,
      exportFormat: 'xlsx',
      sourceUploads,
      nhpSourceBackfilled,
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
          effective_date: l.effective_date,
          payment_period: l.payment_period,
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
 * Excel download for all House Statement types (THEI / BSI / Marco / Integrity).
 */
router.get('/export-xlsx', requireAuth, requireAdmin, async (req, res) => {
  try {
    const type = String(req.query.type || '');
    const period = String(req.query.period || 'all');
    const payee = req.query.payee ? String(req.query.payee) : null;
    if (!isValidOverrideType(type)) {
      return res.status(400).json({
        error: `Excel export is for: ${OVERRIDE_UI_TYPES.join(', ')}`,
      });
    }
    const pool = getPool();
    if (type === STATEMENT_TYPES.THEI_NHP) {
      try { await backfillNhpSourceFromUploads(pool); } catch (e) { /* best-effort */ }
    }
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
 * CSV download (kept for CLI / backups). UI House Statements use Excel.
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
 * Returns JSON with each payee's Excel (xlsxBase64) plus a CSV summary.
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

    const files = [];
    for (const s of bundle.statements) {
      const wb = await buildOverrideExcelWorkbook(bundle, s);
      const buffer = await wb.xlsx.writeBuffer();
      files.push({
        payee: s.payee,
        filename: filenameForOverrideExcel(bundle, s.payee),
        total: s.total,
        lineCount: s.lineCount,
        format: 'xlsx',
        xlsxBase64: Buffer.from(buffer).toString('base64'),
      });
    }

    res.json({
      type: bundle.type,
      period: bundle.period,
      periodLabel: bundle.periodLabel,
      grandTotal: bundle.grandTotal,
      exportFormat: 'xlsx',
      files,
      summaryFilename: filenameFor(bundle, 'SUMMARY'),
      summaryCsv: summaryToCsv(bundle),
    });
  } catch (err) {
    console.error('[override-statements] export-all', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/override-statements/export-all-types?period=202607
 * Excel for every House Statement type (THEI, BSI, Marco, Integrity) in one period.
 */
router.get('/export-all-types', requireAuth, requireAdmin, async (req, res) => {
  try {
    const period = String(req.query.period || 'all');
    const pool = getPool();
    // THEI/BSI fetch is a superset (Agency Override + Alba rate-peel). Marco/Integrity ignore extra rows.
    const rows = await fetchOverrideRows(pool, period, STATEMENT_TYPES.THEI_NHP);
    const files = [];
    const typeSummaries = [];

    for (const type of OVERRIDE_UI_TYPES) {
      const bundle = buildOverrideStatements(rows, type, { period });
      typeSummaries.push({
        type: bundle.type,
        periodLabel: bundle.periodLabel,
        statementCount: bundle.statementCount,
        grandTotal: bundle.grandTotal,
      });
      for (const s of bundle.statements) {
        const wb = await buildOverrideExcelWorkbook(bundle, s);
        const buffer = await wb.xlsx.writeBuffer();
        files.push({
          type: bundle.type,
          payee: s.payee,
          filename: filenameForOverrideExcel(bundle, s.payee),
          total: s.total,
          lineCount: s.lineCount,
          format: 'xlsx',
          xlsxBase64: Buffer.from(buffer).toString('base64'),
        });
      }
    }

    const summaryLines = [
      '"OliComm House Statements — all types"',
      `"Period: ${typeSummaries[0] ? typeSummaries[0].periodLabel : period}"`,
      '',
      '"Type","Payee","Lines","Net Total"',
    ];
    for (const f of files) {
      summaryLines.push(
        `"${f.type}","${String(f.payee).replace(/"/g, '""')}",${f.lineCount},"$${Number(f.total || 0).toFixed(2)}"`
      );
    }

    res.json({
      period,
      periodLabel: typeSummaries[0] ? typeSummaries[0].periodLabel : period,
      types: typeSummaries,
      files,
      summaryFilename: `house_statements_all_types_${period === 'all' ? 'ALL' : period}.csv`,
      summaryCsv: summaryLines.join('\n'),
    });
  } catch (err) {
    console.error('[override-statements] export-all-types', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

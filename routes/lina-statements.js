'use strict';

const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const {
  buildLinaCompensationStatement,
  buildLinaCompensationWorkbook,
  filenameForLinaStatement,
} = require('../src/linaCompensationStatement');

const SELECT_COLS = `
  id, agent_name, client_full_name, policy_number, carrier, effective_date,
  payment_period, classification, producer_payable, commission, source
`;

async function fetchLinaRows(pool, period) {
  const params = [];
  let where = `WHERE (
      agent_name ILIKE '%alba%hernandez%'
      OR agent_name ILIKE '%lina%hernandez%'
      OR agent_name ILIKE '%alba%ritela%'
    )
    AND COALESCE(producer_payable,0) <> 0
    AND LOWER(COALESCE(classification,'')) NOT LIKE '%override%'
    AND (
      LOWER(COALESCE(classification,'')) LIKE '%new business%'
      OR LOWER(COALESCE(classification,'')) LIKE '%renewal%'
      OR LOWER(COALESCE(classification,'')) LIKE '%chargeback%'
      OR LOWER(COALESCE(classification,'')) LIKE '%agent commission%'
      OR LOWER(TRIM(COALESCE(classification,''))) = 'commission'
    )`;
  if (period && period !== 'all') {
    params.push(period);
    where += ` AND payment_period = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT ${SELECT_COLS} FROM commission_records ${where} ORDER BY carrier, policy_number, id`,
    params
  );
  return result.rows;
}

/** GET /api/lina-statements/preview?period=202607 */
router.get('/preview', requireAuth, async (req, res) => {
  try {
    const period = String(req.query.period || '');
    if (!period) return res.status(400).json({ error: 'period is required (YYYYMM or all)' });
    const pool = getPool();
    const rows = await fetchLinaRows(pool, period);
    const statement = buildLinaCompensationStatement(rows, { period });
    res.json({
      payee: statement.payee,
      issuedBy: statement.issuedBy,
      reportDate: statement.reportDate,
      period: statement.period,
      periodLabel: statement.periodLabel,
      periodTitle: statement.periodTitle,
      lineCount: statement.lineCount,
      gross: statement.gross,
      chargebacks: statement.chargebacks,
      balance: statement.balance,
      note: statement.note,
      lines: statement.lines,
    });
  } catch (err) {
    console.error('[lina-statements] preview', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/lina-statements/export?period=202607 — Excel download */
router.get('/export', requireAuth, async (req, res) => {
  try {
    const period = String(req.query.period || '');
    if (!period) return res.status(400).json({ error: 'period is required (YYYYMM or all)' });
    const pool = getPool();
    const rows = await fetchLinaRows(pool, period);
    const statement = buildLinaCompensationStatement(rows, { period });
    const wb = await buildLinaCompensationWorkbook(statement);
    const buffer = await wb.xlsx.writeBuffer();
    const filename = filenameForLinaStatement(statement);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[lina-statements] export', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

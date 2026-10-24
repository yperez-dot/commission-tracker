'use strict';

/**
 * Tables + data access for payroll close: locks, adjustments, payments,
 * month close, "none this month" carrier marks, deposits.
 *
 * All tables self-create on first use (CREATE TABLE / ADD COLUMN IF NOT EXISTS),
 * like payee_statements. migrations/014_payroll_close.sql has the same DDL for
 * reference / manual runs.
 */

const { adjustmentTotalsByPeriod } = require('../src/payrollLock');

/** Payout-row name used on Agent Payouts for each statement payee. */
const STATEMENT_PAYEE_NAMES = {
  lina: 'Lina Hernandez',
  'christian-munoz': 'Christian Munoz',
  'horacio-mendieta': 'Horacio Mendieta',
};
function statementKeyForName(name) {
  const k = Object.keys(STATEMENT_PAYEE_NAMES).find((key) => STATEMENT_PAYEE_NAMES[key] === name);
  return k || null;
}

let ready = false;
async function ensureCloseTables(pool) {
  if (ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_locks (
      id SERIAL PRIMARY KEY,
      agency_key TEXT NOT NULL DEFAULT 'thei',
      agent_name TEXT NOT NULL,
      payee_key TEXT,
      payment_period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'locked',          -- locked | unlocked
      source TEXT NOT NULL DEFAULT 'paid',            -- paid | close
      data_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      adjustments_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      period_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      carry_in NUMERIC(12,2) NOT NULL DEFAULT 0,
      net NUMERIC(12,2) NOT NULL DEFAULT 0,
      payable NUMERIC(12,2) NOT NULL DEFAULT 0,
      carry_out NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(12,2),
      statement_id INTEGER,
      statement_total NUMERIC(12,2),
      raw_agent_names JSONB,
      record_ids JSONB,
      locked_by TEXT,
      locked_at TIMESTAMPTZ DEFAULT NOW(),
      unlocked_by TEXT,
      unlocked_at TIMESTAMPTZ,
      unlock_reason TEXT
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_locks_active
    ON payroll_locks (agency_key, agent_name, payment_period) WHERE status = 'locked'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_adjustments (
      id SERIAL PRIMARY KEY,
      agency_key TEXT NOT NULL DEFAULT 'thei',
      agent_name TEXT NOT NULL,
      payee_key TEXT,
      payment_period TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      category TEXT NOT NULL,
      reason TEXT NOT NULL,
      corrects_period TEXT,
      corrects_lock_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',          -- active | void
      entered_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      voided_by TEXT,
      voided_at TIMESTAMPTZ,
      void_reason TEXT
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_lookup
    ON payroll_adjustments (agency_key, agent_name, payment_period)`);

  // Existing table (create_payroll_payments_table.sql) — create if missing, then add new columns.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_payments (
      id SERIAL PRIMARY KEY,
      payment_date DATE NOT NULL,
      agent_name TEXT NOT NULL,
      payment_amount NUMERIC(10, 2) NOT NULL,
      payment_method TEXT,
      check_number TEXT,
      period_start DATE,
      period_end DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      created_by TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
  for (const col of [
    `agency_key TEXT DEFAULT 'thei'`,
    'payment_period TEXT',
    'lock_id INTEGER',
    'amount_payable NUMERIC(12,2)',
    `status TEXT DEFAULT 'active'`,
    'voided_by TEXT',
    'voided_at TIMESTAMPTZ',
    'void_reason TEXT',
    // 'payout' (we paid the agent) | 'repayment' (the agent paid back a balance due;
    // payment_amount is negative = money in). A repayment links to its adjustment line.
    `kind TEXT DEFAULT 'payout'`,
    'adjustment_id INTEGER',
  ]) {
    await pool.query(`ALTER TABLE payroll_payments ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payroll_payments_period2
    ON payroll_payments (agency_key, payment_period, agent_name)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_month_close (
      id SERIAL PRIMARY KEY,
      agency_key TEXT NOT NULL DEFAULT 'thei',
      payment_period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'closed',          -- closed | reopened
      closed_by TEXT,
      closed_at TIMESTAMPTZ DEFAULT NOW(),
      notes TEXT,
      checklist JSONB,
      reopened_by TEXT,
      reopened_at TIMESTAMPTZ,
      reopen_reason TEXT
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_month_close_active
    ON payroll_month_close (agency_key, payment_period) WHERE status = 'closed'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_close_carrier_none (
      id SERIAL PRIMARY KEY,
      agency_key TEXT NOT NULL DEFAULT 'thei',
      payment_period TEXT NOT NULL,
      carrier TEXT NOT NULL,
      reason TEXT NOT NULL,
      entered_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      removed_at TIMESTAMPTZ,
      removed_by TEXT
    )`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_deposits (
      id SERIAL PRIMARY KEY,
      agency_key TEXT NOT NULL DEFAULT 'thei',
      deposit_date DATE NOT NULL,
      payer TEXT NOT NULL,
      payer_other TEXT,
      amount NUMERIC(12,2) NOT NULL,
      reference TEXT,
      memo TEXT,
      source TEXT NOT NULL DEFAULT 'manual',           -- manual | quickbooks (future import)
      external_id TEXT,                                -- e.g. QuickBooks deposit id (future)
      status TEXT NOT NULL DEFAULT 'active',           -- active | deleted
      entered_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT,
      updated_at TIMESTAMPTZ,
      deleted_by TEXT,
      deleted_at TIMESTAMPTZ,
      delete_reason TEXT
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_deposits_external
    ON payroll_deposits (agency_key, source, external_id) WHERE external_id IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_deposit_allocations (
      id SERIAL PRIMARY KEY,
      deposit_id INTEGER NOT NULL REFERENCES payroll_deposits(id) ON DELETE CASCADE,
      payment_period TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payroll_deposit_alloc_period
    ON payroll_deposit_allocations (payment_period)`);
  ready = true;
}

function num(v) { return v == null ? 0 : Number(v); }

async function loadLocks(pool, ak, agentName) {
  await ensureCloseTables(pool);
  const r = await pool.query(
    `SELECT * FROM payroll_locks WHERE agency_key=$1 AND agent_name=$2 AND status='locked'`,
    [ak, agentName]
  );
  const out = {};
  for (const row of r.rows) out[row.payment_period] = row;
  return out;
}

async function loadAdjustments(pool, ak, agentName, period) {
  await ensureCloseTables(pool);
  const params = [ak, agentName];
  let extra = '';
  if (period) { params.push(period); extra = ' AND payment_period = $3'; }
  const r = await pool.query(
    `SELECT * FROM payroll_adjustments WHERE agency_key=$1 AND agent_name=$2 AND status='active'${extra}
      ORDER BY payment_period, created_at, id`,
    params
  );
  return r.rows.map((a) => Object.assign({}, a, { amount: num(a.amount) }));
}

async function adjustmentTotals(pool, ak, agentName) {
  return adjustmentTotalsByPeriod(await loadAdjustments(pool, ak, agentName));
}

async function activeLock(pool, ak, agentName, period) {
  await ensureCloseTables(pool);
  const r = await pool.query(
    `SELECT * FROM payroll_locks WHERE agency_key=$1 AND agent_name=$2 AND payment_period=$3 AND status='locked'`,
    [ak, agentName, period]
  );
  return r.rows[0] || null;
}

async function monthClose(pool, ak, period) {
  await ensureCloseTables(pool);
  const r = await pool.query(
    `SELECT * FROM payroll_month_close WHERE agency_key=$1 AND payment_period=$2 AND status='closed'`,
    [ak, period]
  );
  return r.rows[0] || null;
}

/** True when nothing new may be posted to payee+period (paid/locked or month closed). */
async function isFrozen(pool, ak, agentName, period) {
  if (await activeLock(pool, ak, agentName, period)) return true;
  return !!(await monthClose(pool, ak, period));
}

module.exports = {
  STATEMENT_PAYEE_NAMES,
  statementKeyForName,
  ensureCloseTables,
  loadLocks,
  loadAdjustments,
  adjustmentTotals,
  activeLock,
  monthClose,
  isFrozen,
};

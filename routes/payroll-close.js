'use strict';

/**
 * Payroll close — month lock, manual adjustments, payment records, monthly close
 * checklist, THEI deposit reconciliation.  Mounted at /api/payroll-close.
 *
 * Roles (routes/payrollRoles.js):
 *   staff  (admin + payroll staff, e.g. Yahoska and Katy): adjustments, mark paid
 *          (records the payment and locks the month), checklist, close month, deposits
 *   admin  (requirePayrollAdmin): unlock a paid month, void an adjustment, reopen a month
 *
 * Every write is recorded in change_log (routes/change-log.js).
 * Tables self-create on first use (routes/payrollCloseStore.js).
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { requirePayrollStaff, requirePayrollAdmin, isPayrollAdmin, isPayrollStaff } = require('./payrollRoles');
const { logChange } = require('./change-log');
const store = require('./payrollCloseStore');
const payee = require('./payee-statements');
const {
  ADJUSTMENT_CATEGORIES, PAYMENT_METHODS, round2, isMethod, validateAdjustment,
  suggestCorrection, lockSnapshot, categoryLabel,
} = require('../src/payrollLock');
const {
  buildCloseChecklist, previousPeriods, canonicalCarrier, DEFAULT_EXPECTED_CARRIERS,
} = require('../src/payrollCloseChecklist');
const { PAYERS, validateDeposit, reconcileDeposits, depositWarnings, depositPayer, bsiExpectedFromRows } = require('../src/depositRecon');

function agencyKey(req) {
  const raw = req.query.agency || (req.body && req.body.agency) ||
    req.headers['x-agency-override'] || (req.user && req.user.agency) || 'thei';
  const s = String(raw || 'thei').toLowerCase();
  return s.includes('broker society') || s === 'bsi' ? 'bsi' : 'thei';
}
function who(req) {
  const u = req.user || {};
  return u.name || u.email || u.username || null;
}
/** pg returns DATE as a local-midnight Date; format it without a UTC shift. */
function ymd(d) {
  if (!(d instanceof Date)) return String(d || '').slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isPeriod(p) { return /^\d{6}$/.test(String(p || '')); }
function money(n) { return (round2(n) < 0 ? '-$' : '$') + Math.abs(round2(n)).toFixed(2); }
function wrap(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error('[payroll-close]', req.method, req.path, err);
    res.status(500).json({ error: err.message });
  });
}

async function ensurePayoutStatus(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_payout_status (
      id SERIAL PRIMARY KEY,
      agency_key TEXT NOT NULL DEFAULT 'thei',
      payment_period TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      is_paid BOOLEAN NOT NULL DEFAULT FALSE,
      paid_date DATE,
      amount NUMERIC(12, 2),
      notes TEXT,
      updated_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (agency_key, payment_period, agent_name)
    )`);
}

/**
 * Live data total for a payee+period, used to spot data that changed under a
 * locked month.  Statement payees use the same builders as their statements.
 * Other payees (ACA producers) sum producer pay on the raw agent names captured
 * when the month was locked (same filter as Agent Payouts: ACA, no sub-agent override).
 */
async function liveDataTotals(pool, lock, cache) {
  const key = lock.payee_key || store.statementKeyForName(lock.agent_name);
  if (key && payee.PAYEES[key]) {
    if (!cache[key]) cache[key] = await payee.periodTotals(pool, key);
    return round2(cache[key][lock.payment_period] || 0);
  }
  const names = Array.isArray(lock.raw_agent_names) && lock.raw_agent_names.length
    ? lock.raw_agent_names : [lock.agent_name];
  const r = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN COALESCE(sub_agent_override,0) <> 0 THEN sub_agent_override
                              ELSE COALESCE(producer_payable,0) END),0) AS t
       FROM commission_records
      WHERE agent_name = ANY($1) AND payment_period = $2
        AND UPPER(COALESCE(lob,'')) = 'ACA' AND COALESCE(producer_payable,0) <> 0
        AND COALESCE(sub_agent_override,0) <= 0`,
    [names, lock.payment_period]
  );
  return round2(r.rows[0].t);
}

/**
 * Freeze payee+period. Statement payees (Lina, Munoz, Mendieta): rebuild server-side
 * (rows + adjustments + carry), store the issued statement, freeze it.  Other payees:
 * the client sends the data total it shows (Agent Payouts) + raw agent names.
 */
async function createLock(pool, req, ak, opts) {
  const agent = opts.agent;
  const period = opts.period;
  const key = store.statementKeyForName(agent);
  let carry;
  let statementId = null;
  let statementTotal = null;
  if (key) {
    const built = await payee.buildFor(pool, key, period, ak);
    carry = built.carry;
    const issued = await payee.issueStatement(pool, req, key, period,
      `Frozen when ${opts.source === 'close' ? 'month closed' : 'marked paid'}`, built);
    if (issued) { statementId = issued.id; statementTotal = Number(issued.total); }
  } else {
    const adjs = await store.loadAdjustments(pool, ak, agent, period);
    const adjTotal = round2(adjs.reduce((s, a) => s + a.amount, 0));
    const dataTotal = round2(opts.dataTotal);
    const net = round2(dataTotal + adjTotal);
    carry = { dataTotal, adjustmentsTotal: adjTotal, periodTotal: net, carryIn: 0, net, payable: Math.max(0, net), carryOut: 0 };
  }
  const snap = lockSnapshot(carry, { paidAmount: opts.paidAmount, statementTotal });
  const ins = await pool.query(
    `INSERT INTO payroll_locks
       (agency_key, agent_name, payee_key, payment_period, status, source, data_total, adjustments_total,
        period_total, carry_in, net, payable, carry_out, paid_amount, statement_id, statement_total,
        raw_agent_names, record_ids, locked_by)
     VALUES ($1,$2,$3,$4,'locked',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [ak, agent, key, period, opts.source || 'paid', snap.data_total, snap.adjustments_total,
      snap.period_total, snap.carry_in, snap.net, snap.payable, snap.carry_out, snap.paid_amount,
      statementId, snap.statement_total,
      JSON.stringify(opts.rawAgentNames || []), JSON.stringify(opts.recordIds || []), who(req)]
  );
  const lock = ins.rows[0];
  await logChange(pool, req, {
    agencyKey: ak, type: 'payroll.locked', entityType: 'payroll_lock', entityId: lock.id, period, payee: agent,
    summary: `Locked ${agent} ${period} (${opts.source === 'close' ? 'month closed' : 'marked paid'}): payable ${money(snap.payable)}`,
    details: { snapshot: snap, statementId },
  });
  return lock;
}

// ─── meta ────────────────────────────────────────────────────────────────────
router.get('/meta', requireAuth, (req, res) => {
  res.json({
    adjustmentCategories: ADJUSTMENT_CATEGORIES,
    paymentMethods: PAYMENT_METHODS,
    payers: PAYERS,
    expectedCarriers: DEFAULT_EXPECTED_CARRIERS,
    isStaff: isPayrollStaff(req.user),
    canUnlock: isPayrollAdmin(req.user),
  });
});

// ─── period state (locks, adjustments, payments, close, corrections) ─────────
router.get('/period', requireAuth, wrap(async (req, res) => {
  const period = String(req.query.period || '');
  if (!isPeriod(period)) return res.status(400).json({ error: 'period must be YYYYMM' });
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const locks = await pool.query(
    `SELECT * FROM payroll_locks WHERE agency_key=$1 AND payment_period=$2 AND status='locked' ORDER BY agent_name`, [ak, period]);
  const adjs = await pool.query(
    `SELECT * FROM payroll_adjustments WHERE agency_key=$1 AND payment_period=$2 ORDER BY agent_name, created_at`, [ak, period]);
  const pays = await pool.query(
    `SELECT * FROM payroll_payments WHERE agency_key=$1 AND payment_period=$2 ORDER BY created_at DESC`, [ak, period]);
  const close = await store.monthClose(pool, ak, period);

  // Prior-period corrections: locked months (last 12, before this one) whose data has moved.
  const prior = await pool.query(
    `SELECT * FROM payroll_locks WHERE agency_key=$1 AND status='locked' AND payment_period < $2
      ORDER BY payment_period DESC LIMIT 300`, [ak, period]);
  const posted = await pool.query(
    `SELECT agent_name, corrects_period, amount FROM payroll_adjustments
      WHERE agency_key=$1 AND status='active' AND category='prior_period_correction'`, [ak]);
  const cache = {};
  const corrections = [];
  const recent = previousPeriods(period, 12);
  for (const lock of prior.rows) {
    if (!recent.includes(lock.payment_period)) continue;
    const live = await liveDataTotals(pool, lock, cache);
    const done = posted.rows.filter((a) => a.agent_name === lock.agent_name && a.corrects_period === lock.payment_period);
    const suggested = suggestCorrection(lock.data_total, live, done);
    if (suggested !== 0) {
      corrections.push({
        agent: lock.agent_name, lockedPeriod: lock.payment_period, lockId: lock.id,
        lockedDataTotal: round2(lock.data_total), liveDataTotal: live,
        alreadyPosted: round2(done.reduce((s, a) => s + Number(a.amount), 0)), suggested,
      });
    }
  }
  res.json({
    period, close, corrections,
    locks: locks.rows,
    adjustments: adjs.rows.map((a) => Object.assign({}, a, { amount: Number(a.amount), categoryLabel: categoryLabel(a.category) })),
    payments: pays.rows,
  });
}));

// ─── adjustments ─────────────────────────────────────────────────────────────
router.post('/adjustments', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const b = req.body || {};
  const agent = String(b.agent || '').trim();
  const period = String(b.period || '');
  const frozen = isPeriod(period) && agent ? await store.isFrozen(pool, ak, agent, period) : false;
  const err = validateAdjustment({
    period, agent, amount: b.amount, reason: b.reason, category: b.category, correctsPeriod: b.correctsPeriod,
  }, frozen);
  if (err) return res.status(frozen ? 409 : 400).json({ error: err });
  const amount = round2(b.amount);
  const ins = await pool.query(
    `INSERT INTO payroll_adjustments
       (agency_key, agent_name, payee_key, payment_period, amount, category, reason, corrects_period, corrects_lock_id, entered_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [ak, agent, store.statementKeyForName(agent), period, amount, b.category, String(b.reason).trim(),
      b.category === 'prior_period_correction' ? String(b.correctsPeriod) : null,
      b.correctsLockId ? Number(b.correctsLockId) : null, who(req)]
  );
  const a = ins.rows[0];
  await logChange(pool, req, {
    agencyKey: ak, type: 'payroll.adjustment_added', entityType: 'payroll_adjustment', entityId: a.id, period, payee: agent,
    summary: `${categoryLabel(a.category)} ${money(amount)} for ${agent} (${period}): ${a.reason}`,
    details: { amount, category: a.category, reason: a.reason, correctsPeriod: a.corrects_period },
  });
  res.json(a);
}));

router.post('/adjustments/:id(\\d+)/void', requireAuth, requirePayrollAdmin, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  const cur = await pool.query(`SELECT * FROM payroll_adjustments WHERE id=$1 AND agency_key=$2`, [req.params.id, ak]);
  if (!cur.rows.length) return res.status(404).json({ error: 'not found' });
  const a = cur.rows[0];
  if (a.status !== 'active') return res.status(400).json({ error: 'already void' });
  if (await store.isFrozen(pool, ak, a.agent_name, a.payment_period)) {
    return res.status(409).json({ error: 'That month is locked — unlock it first (its paid figures are frozen).' });
  }
  const r = await pool.query(
    `UPDATE payroll_adjustments SET status='void', voided_by=$2, voided_at=NOW(), void_reason=$3 WHERE id=$1 RETURNING *`,
    [a.id, who(req), reason]);
  await logChange(pool, req, {
    agencyKey: ak, type: 'payroll.adjustment_voided', entityType: 'payroll_adjustment', entityId: a.id,
    period: a.payment_period, payee: a.agent_name,
    summary: `Voided ${categoryLabel(a.category)} ${money(a.amount)} for ${a.agent_name} (${a.payment_period}): ${reason}`,
    details: { reason, amount: Number(a.amount) },
  });
  res.json(r.rows[0]);
}));

// ─── mark paid = record payment + lock ───────────────────────────────────────
router.post('/pay', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  await ensurePayoutStatus(pool);
  const ak = agencyKey(req);
  const b = req.body || {};
  const period = String(b.period || '');
  const agent = String(b.agent || '').trim();
  if (!isPeriod(period) || !agent) return res.status(400).json({ error: 'period (YYYYMM) and agent are required' });
  const method = String(b.method || '').toLowerCase();
  if (!isMethod(method)) return res.status(400).json({ error: 'method must be check, ach, zelle or other' });
  if (method === 'other' && !String(b.notes || '').trim()) return res.status(400).json({ error: 'say how it was paid in notes for Other' });
  const payDate = String(b.payDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) return res.status(400).json({ error: 'payDate must be YYYY-MM-DD' });
  const existing = await store.activeLock(pool, ak, agent, period);
  const paidBefore = await pool.query(
    `SELECT is_paid FROM payroll_payout_status WHERE agency_key=$1 AND payment_period=$2 AND agent_name=$3`, [ak, period, agent]);
  if (existing && (existing.source !== 'close' || (paidBefore.rows[0] && paidBefore.rows[0].is_paid))) {
    return res.status(409).json({ error: `${agent} ${period} is already paid and locked` });
  }
  // Month already closed (frozen) but not yet paid: pay against the frozen snapshot.
  const lock = existing || await createLock(pool, req, ak, {
    agent, period, source: 'paid', dataTotal: b.dataTotal, rawAgentNames: b.rawAgentNames, recordIds: b.recordIds,
    paidAmount: b.amount != null && b.amount !== '' ? Number(b.amount) : null,
  });
  const amount = b.amount != null && b.amount !== '' && Number.isFinite(Number(b.amount))
    ? round2(b.amount) : round2(lock.payable);
  if (lock.paid_amount == null || lock.source !== 'paid') {
    // A close-made lock becomes a paid lock (so reopening the month won't unlock it).
    await pool.query(`UPDATE payroll_locks SET paid_amount=$2, source='paid' WHERE id=$1`, [lock.id, amount]);
    lock.source = 'paid';
  }
  const pay = await pool.query(
    `INSERT INTO payroll_payments
       (payment_date, agent_name, payment_amount, payment_method, check_number, notes, created_by,
        agency_key, payment_period, lock_id, amount_payable, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active') RETURNING *`,
    [payDate, agent, amount, method, b.reference ? String(b.reference).trim() : null,
      b.notes ? String(b.notes) : null, who(req), ak, period, lock.id, round2(lock.payable)]
  );
  await pool.query(
    `INSERT INTO payroll_payout_status
       (agency_key, payment_period, agent_name, is_paid, paid_date, amount, notes, updated_by, updated_at)
     VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,NOW())
     ON CONFLICT (agency_key, payment_period, agent_name)
     DO UPDATE SET is_paid=TRUE, paid_date=EXCLUDED.paid_date, amount=EXCLUDED.amount,
                   notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
    [ak, period, agent, payDate, amount, `${method}${b.reference ? ' #' + b.reference : ''}`, who(req)]
  );
  await logChange(pool, req, {
    agencyKey: ak, type: 'payroll.payment_recorded', entityType: 'payroll_payment', entityId: pay.rows[0].id, period, payee: agent,
    summary: `Paid ${agent} ${money(amount)} for ${period} by ${method}${b.reference ? ' #' + b.reference : ''} on ${payDate}` +
      (Math.abs(amount - Number(lock.payable)) >= 0.01 ? ` (payable was ${money(lock.payable)})` : ''),
    details: { amount, payable: Number(lock.payable), method, reference: b.reference || null, payDate, lockId: lock.id },
  });
  res.json({ lock: Object.assign({}, lock, { paid_amount: amount }), payment: pay.rows[0] });
}));

/** Unlock (admin + reason). Also clears the paid mark and voids its payment record unless keepPaid. */
router.post('/unlock', requireAuth, requirePayrollAdmin, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  await ensurePayoutStatus(pool);
  const ak = agencyKey(req);
  const b = req.body || {};
  const period = String(b.period || '');
  const agent = String(b.agent || '').trim();
  const reason = String(b.reason || '').trim();
  if (!isPeriod(period) || !agent) return res.status(400).json({ error: 'period and agent are required' });
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  const lock = await store.activeLock(pool, ak, agent, period);
  if (!lock) return res.status(404).json({ error: 'not locked' });
  await pool.query(
    `UPDATE payroll_locks SET status='unlocked', unlocked_by=$2, unlocked_at=NOW(), unlock_reason=$3 WHERE id=$1`,
    [lock.id, who(req), reason]);
  let voided = 0;
  if (!b.keepPaid) {
    const v = await pool.query(
      `UPDATE payroll_payments SET status='void', voided_by=$2, voided_at=NOW(), void_reason=$3
        WHERE lock_id=$1 AND COALESCE(status,'active')='active' RETURNING id`, [lock.id, who(req), reason]);
    voided = v.rowCount;
    await pool.query(
      `UPDATE payroll_payout_status SET is_paid=FALSE, paid_date=NULL, updated_by=$4, updated_at=NOW()
        WHERE agency_key=$1 AND payment_period=$2 AND agent_name=$3`, [ak, period, agent, who(req)]);
  }
  await logChange(pool, req, {
    agencyKey: ak, type: 'payroll.unlocked', entityType: 'payroll_lock', entityId: lock.id, period, payee: agent,
    summary: `Unlocked ${agent} ${period}: ${reason}${voided ? ` (voided ${voided} payment record${voided > 1 ? 's' : ''})` : ''}`,
    details: { reason, keepPaid: !!b.keepPaid, voidedPayments: voided, frozen: lockSnapshot({
      dataTotal: lock.data_total, adjustmentsTotal: lock.adjustments_total, periodTotal: lock.period_total,
      carryIn: lock.carry_in, net: lock.net, payable: lock.payable, carryOut: lock.carry_out }, {}) },
  });
  res.json({ success: true, voidedPayments: voided });
}));

/** Payment records for Payment History. */
router.get('/payments', requireAuth, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const limit = Math.min(parseInt(req.query.limit, 10) || 300, 1000);
  const r = await pool.query(
    `SELECT p.*, l.payable AS locked_payable, l.status AS lock_status
       FROM payroll_payments p LEFT JOIN payroll_locks l ON l.id = p.lock_id
      WHERE COALESCE(p.agency_key,'thei') = $1
      ORDER BY p.payment_date DESC, p.created_at DESC LIMIT ${limit}`, [ak]);
  res.json(r.rows.map((p) => Object.assign({}, p, { payment_date: ymd(p.payment_date) })));
}));

// ─── monthly close checklist ────────────────────────────────────────────────
async function expectedByPayer(pool, period) {
  // See src/depositRecon.js header for how "expected" is defined.
  // BSI pays agents directly: expected from BSI = stored thei_share only (bsiExpectedFromRows).
  const bsi = await pool.query(
    `SELECT u.id AS upload_id, COALESCE(u.display_title, u.original_name) AS upload_name, r.thei_share, r.commission
       FROM commission_records r JOIN uploads u ON u.id = r.upload_id
      WHERE u.category = 'bsi_statement' AND r.payment_period = $1
      ORDER BY u.id`, [period]);
  const direct = await pool.query(
    `SELECT u.id, u.original_name AS name, u.carrier,
            COALESCE(SUM(COALESCE(r.commission,0)),0) AS expected
       FROM commission_records r JOIN uploads u ON u.id = r.upload_id
      WHERE (u.category IS NULL OR u.category = 'commission_statement') AND r.payment_period = $1
      GROUP BY u.id`, [period]);
  const out = [];
  const bsiExpected = bsiExpectedFromRows(bsi.rows);
  if (bsiExpected) out.push(bsiExpected);
  for (const r of direct.rows) {
    out.push({
      payer: canonicalCarrier(String(r.carrier || '').split(',')[0]) || 'Unknown carrier',
      expected: round2(r.expected),
      uploads: [{ id: r.id, name: r.name, amount: round2(r.expected) }],
    });
  }
  return out;
}

async function loadDeposits(pool, ak, period) {
  const params = [ak];
  let where = `d.agency_key=$1 AND d.status='active'`;
  if (period) {
    params.push(period);
    where += ` AND (EXISTS (SELECT 1 FROM payroll_deposit_allocations a WHERE a.deposit_id=d.id AND a.payment_period=$2)
               OR NOT EXISTS (SELECT 1 FROM payroll_deposit_allocations a WHERE a.deposit_id=d.id)
               OR d.amount > (SELECT COALESCE(SUM(a.amount),0) FROM payroll_deposit_allocations a WHERE a.deposit_id=d.id))`;
  }
  const d = await pool.query(`SELECT d.* FROM payroll_deposits d WHERE ${where} ORDER BY d.deposit_date DESC, d.id DESC`, params);
  if (!d.rows.length) return [];
  const a = await pool.query(
    `SELECT deposit_id, payment_period, amount FROM payroll_deposit_allocations WHERE deposit_id = ANY($1) ORDER BY payment_period`,
    [d.rows.map((x) => x.id)]);
  return d.rows.map((x) => Object.assign({}, x, {
    amount: Number(x.amount),
    deposit_date: ymd(x.deposit_date),
    allocations: a.rows.filter((y) => y.deposit_id === x.id).map((y) => ({ payment_period: y.payment_period, amount: Number(y.amount) })),
  }));
}

async function depositRecon(pool, ak, period) {
  return reconcileDeposits({
    period,
    expected: await expectedByPayer(pool, period),
    deposits: await loadDeposits(pool, ak, period),
  });
}

async function checklistFor(pool, ak, period) {
  await store.ensureCloseTables(pool);
  const ups = await pool.query(
    `SELECT u.id, u.original_name, u.display_title, u.carrier, u.uploaded_at, usr.name AS uploaded_by_name,
            COUNT(r.id) AS record_count, COALESCE(SUM(r.commission),0) AS total
       FROM uploads u
       JOIN commission_records r ON r.upload_id = u.id AND r.payment_period = $1
       LEFT JOIN users usr ON usr.id = u.uploaded_by
      WHERE u.category = 'bsi_statement'
      GROUP BY u.id, usr.name
      ORDER BY u.uploaded_at`, [period]);
  const recent = await pool.query(
    `SELECT DISTINCT r.carrier FROM commission_records r JOIN uploads u ON u.id = r.upload_id
      WHERE u.category = 'bsi_statement' AND r.payment_period = ANY($1) AND r.carrier IS NOT NULL`,
    [previousPeriods(period, 3)]);
  const nones = await pool.query(
    `SELECT * FROM payroll_close_carrier_none WHERE agency_key=$1 AND payment_period=$2 AND removed_at IS NULL`, [ak, period]);
  const recon = await depositRecon(pool, ak, period);
  const checklist = buildCloseChecklist({
    period,
    uploads: ups.rows.map((u) => Object.assign({}, u, { record_count: Number(u.record_count), total: Number(u.total) })),
    recentCarriers: recent.rows.map((r) => r.carrier),
    nones: nones.rows,
    depositWarnings: depositWarnings(recon),
    missingShareWarnings: recon.rows.filter((r) => r.missingShareRows > 0).map((r) => ({ payer: r.payer, rows: r.missingShareRows })),
  });
  checklist.close = await store.monthClose(pool, ak, period);
  const hist = await pool.query(
    `SELECT * FROM payroll_month_close WHERE agency_key=$1 AND payment_period=$2 ORDER BY closed_at DESC`, [ak, period]);
  checklist.closeHistory = hist.rows;
  checklist.deposits = recon;
  return checklist;
}

router.get('/checklist', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const period = String(req.query.period || '');
  if (!isPeriod(period)) return res.status(400).json({ error: 'period must be YYYYMM' });
  res.json(await checklistFor(getPool(), agencyKey(req), period));
}));

router.post('/checklist/none', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const b = req.body || {};
  const period = String(b.period || '');
  const carrier = canonicalCarrier(b.carrier);
  const reason = String(b.reason || '').trim();
  if (!isPeriod(period) || !carrier) return res.status(400).json({ error: 'period and carrier are required' });
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  if (await store.monthClose(pool, ak, period)) return res.status(409).json({ error: 'month is closed' });
  const r = await pool.query(
    `INSERT INTO payroll_close_carrier_none (agency_key, payment_period, carrier, reason, entered_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`, [ak, period, carrier, reason, who(req)]);
  await logChange(pool, req, {
    agencyKey: ak, type: 'payroll.carrier_none', entityType: 'close_carrier_none', entityId: r.rows[0].id, period,
    summary: `Marked ${carrier} "none this month" for ${period}: ${reason}`, details: { carrier, reason },
  });
  res.json(r.rows[0]);
}));

router.post('/checklist/none/:id(\\d+)/remove', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const r = await pool.query(
    `UPDATE payroll_close_carrier_none SET removed_at=NOW(), removed_by=$3
      WHERE id=$1 AND agency_key=$2 AND removed_at IS NULL RETURNING *`, [req.params.id, ak, who(req)]);
  if (!r.rows.length) return res.status(404).json({ error: 'not found' });
  await logChange(pool, req, {
    agencyKey: ak, type: 'payroll.carrier_none_removed', entityType: 'close_carrier_none', entityId: r.rows[0].id,
    period: r.rows[0].payment_period, summary: `Removed "none this month" for ${r.rows[0].carrier} (${r.rows[0].payment_period})`,
  });
  res.json(r.rows[0]);
}));

/**
 * POST /close { period, notes, payees: [{agent, dataTotal, rawAgentNames, recordIds}] }
 * Only when every expected carrier is uploaded or marked "none this month".
 * Locks Lina / Munoz / Mendieta and every payee row the page sends (unless already locked).
 */
router.post('/close', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  const ak = agencyKey(req);
  const b = req.body || {};
  const period = String(b.period || '');
  if (!isPeriod(period)) return res.status(400).json({ error: 'period must be YYYYMM' });
  const checklist = await checklistFor(pool, ak, period);
  if (checklist.close) return res.status(409).json({ error: 'month is already closed' });
  if (!checklist.canClose) return res.status(400).json({ error: 'Checklist not complete', blockers: checklist.blockers });
  const ins = await pool.query(
    `INSERT INTO payroll_month_close (agency_key, payment_period, status, closed_by, notes, checklist)
     VALUES ($1,$2,'closed',$3,$4,$5) RETURNING *`,
    [ak, period, who(req), b.notes || null, JSON.stringify({
      carriers: checklist.carriers, warnings: checklist.warnings, deposits: checklist.deposits.totals,
    })]);
  const payees = Array.isArray(b.payees) ? b.payees.slice() : [];
  for (const name of Object.values(store.STATEMENT_PAYEE_NAMES)) {
    if (!payees.some((p) => p.agent === name)) payees.push({ agent: name });
  }
  const locked = [];
  for (const p of payees) {
    if (!p || !p.agent) continue;
    if (await store.activeLock(pool, ak, p.agent, period)) continue;
    const isStatement = !!store.statementKeyForName(p.agent);
    if (!isStatement && p.dataTotal == null) continue;
    const lock = await createLock(pool, req, ak, {
      agent: p.agent, period, source: 'close', dataTotal: p.dataTotal, rawAgentNames: p.rawAgentNames, recordIds: p.recordIds,
    });
    locked.push(lock.agent_name);
  }
  await logChange(pool, req, {
    agencyKey: ak, type: 'payroll.month_closed', entityType: 'payroll_month_close', entityId: ins.rows[0].id, period,
    summary: `Closed ${period}${checklist.warnings.length ? ` with ${checklist.warnings.length} warning(s)` : ''}; locked ${locked.length} payee(s)`,
    details: { warnings: checklist.warnings, locked, notes: b.notes || null },
  });
  res.json({ close: ins.rows[0], locked });
}));

/** POST /reopen { period, reason } — admin. Unlocks close-made locks; paid locks stay. */
router.post('/reopen', requireAuth, requirePayrollAdmin, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const period = String((req.body && req.body.period) || '');
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!isPeriod(period)) return res.status(400).json({ error: 'period must be YYYYMM' });
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  const close = await store.monthClose(pool, ak, period);
  if (!close) return res.status(404).json({ error: 'month is not closed' });
  await pool.query(
    `UPDATE payroll_month_close SET status='reopened', reopened_by=$2, reopened_at=NOW(), reopen_reason=$3 WHERE id=$1`,
    [close.id, who(req), reason]);
  const un = await pool.query(
    `UPDATE payroll_locks SET status='unlocked', unlocked_by=$3, unlocked_at=NOW(), unlock_reason=$4
      WHERE agency_key=$1 AND payment_period=$2 AND status='locked' AND source='close' RETURNING agent_name`,
    [ak, period, who(req), `Month reopened: ${reason}`]);
  await logChange(pool, req, {
    agencyKey: ak, type: 'payroll.month_reopened', entityType: 'payroll_month_close', entityId: close.id, period,
    summary: `Reopened ${period}: ${reason} (unlocked ${un.rowCount} unpaid payee(s); paid months stay locked)`,
    details: { reason, unlocked: un.rows.map((r) => r.agent_name) },
  });
  res.json({ success: true, unlocked: un.rows.map((r) => r.agent_name) });
}));

// ─── deposits ───────────────────────────────────────────────────────────────
function cleanAllocations(b) {
  const list = Array.isArray(b.allocations) ? b.allocations : [];
  return list.filter((a) => a && (a.period || a.amount))
    .map((a) => ({ period: String(a.period || ''), amount: round2(a.amount) }));
}

async function writeAllocations(pool, depositId, allocs) {
  await pool.query(`DELETE FROM payroll_deposit_allocations WHERE deposit_id=$1`, [depositId]);
  for (const a of allocs) {
    await pool.query(`INSERT INTO payroll_deposit_allocations (deposit_id, payment_period, amount) VALUES ($1,$2,$3)`,
      [depositId, a.period, a.amount]);
  }
}

function depositSummary(d, allocs) {
  const p = depositPayer(d);
  const split = allocs.map((a) => `${a.period} ${money(a.amount)}`).join(', ');
  const date = ymd(d.deposit_date);
  return `${p} ${money(d.amount)} on ${date}${d.reference ? ' ref ' + d.reference : ''}${split ? ' → ' + split : ' (unallocated)'}`;
}

router.get('/deposits', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const period = req.query.period ? String(req.query.period) : null;
  res.json(await loadDeposits(pool, agencyKey(req), period));
}));

router.get('/deposits/recon', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const period = String(req.query.period || '');
  if (!isPeriod(period)) return res.status(400).json({ error: 'period must be YYYYMM' });
  const pool = getPool();
  await store.ensureCloseTables(pool);
  res.json(await depositRecon(pool, agencyKey(req), period));
}));

router.post('/deposits', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const b = req.body || {};
  const allocs = cleanAllocations(b);
  const err = validateDeposit({ depositDate: b.depositDate, payer: b.payer, payerOther: b.payerOther, amount: b.amount, allocations: allocs });
  if (err) return res.status(400).json({ error: err });
  const ins = await pool.query(
    `INSERT INTO payroll_deposits (agency_key, deposit_date, payer, payer_other, amount, reference, memo, source, entered_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8) RETURNING *`,
    [ak, b.depositDate, b.payer, b.payer === 'Other' ? String(b.payerOther).trim() : null, round2(b.amount),
      b.reference || null, b.memo || null, who(req)]);
  const d = ins.rows[0];
  await writeAllocations(pool, d.id, allocs);
  await logChange(pool, req, {
    agencyKey: ak, type: 'deposit.created', entityType: 'payroll_deposit', entityId: d.id,
    period: allocs.length === 1 ? allocs[0].period : null,
    summary: `Deposit ${depositSummary(d, allocs)}`, details: { deposit: d, allocations: allocs },
  });
  res.json(Object.assign({}, d, { allocations: allocs }));
}));

router.put('/deposits/:id(\\d+)', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'reason is required to edit a deposit' });
  const cur = await pool.query(`SELECT * FROM payroll_deposits WHERE id=$1 AND agency_key=$2 AND status='active'`, [req.params.id, ak]);
  if (!cur.rows.length) return res.status(404).json({ error: 'not found' });
  const before = cur.rows[0];
  const beforeAlloc = (await pool.query(`SELECT payment_period AS period, amount FROM payroll_deposit_allocations WHERE deposit_id=$1`, [before.id])).rows;
  const allocs = cleanAllocations(b);
  const err = validateDeposit({ depositDate: b.depositDate, payer: b.payer, payerOther: b.payerOther, amount: b.amount, allocations: allocs });
  if (err) return res.status(400).json({ error: err });
  const up = await pool.query(
    `UPDATE payroll_deposits SET deposit_date=$2, payer=$3, payer_other=$4, amount=$5, reference=$6, memo=$7,
            updated_by=$8, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [before.id, b.depositDate, b.payer, b.payer === 'Other' ? String(b.payerOther).trim() : null, round2(b.amount),
      b.reference || null, b.memo || null, who(req)]);
  await writeAllocations(pool, before.id, allocs);
  await logChange(pool, req, {
    agencyKey: ak, type: 'deposit.updated', entityType: 'payroll_deposit', entityId: before.id,
    summary: `Edited deposit: ${depositSummary(up.rows[0], allocs)} — ${reason}`,
    details: { reason, before: Object.assign({}, before, { allocations: beforeAlloc }), after: Object.assign({}, up.rows[0], { allocations: allocs }) },
  });
  res.json(Object.assign({}, up.rows[0], { allocations: allocs }));
}));

router.post('/deposits/:id(\\d+)/delete', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  await store.ensureCloseTables(pool);
  const ak = agencyKey(req);
  const reason = String((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ error: 'reason is required to delete a deposit' });
  const r = await pool.query(
    `UPDATE payroll_deposits SET status='deleted', deleted_by=$3, deleted_at=NOW(), delete_reason=$4
      WHERE id=$1 AND agency_key=$2 AND status='active' RETURNING *`, [req.params.id, ak, who(req), reason]);
  if (!r.rows.length) return res.status(404).json({ error: 'not found' });
  const allocs = (await pool.query(`SELECT payment_period AS period, amount FROM payroll_deposit_allocations WHERE deposit_id=$1`, [r.rows[0].id])).rows
    .map((a) => ({ period: a.period, amount: Number(a.amount) }));
  await logChange(pool, req, {
    agencyKey: ak, type: 'deposit.deleted', entityType: 'payroll_deposit', entityId: r.rows[0].id,
    summary: `Deleted deposit ${depositSummary(r.rows[0], allocs)} — ${reason}`, details: { reason, deposit: r.rows[0], allocations: allocs },
  });
  res.json({ success: true });
}));

module.exports = router;

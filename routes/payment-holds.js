'use strict';

/**
 * Payment holds — THEI / BSI house override statements.
 *
 *   GET  /api/payment-holds              list (optional ?active=1&payee=thei)
 *   POST /api/payment-holds              create { payeeKey, effectiveOnOrAfter, note }
 *   POST /api/payment-holds/:id/release  release
 *
 * Writes go to change_log. Table self-creates (routes/paymentHoldStore.js).
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../db/database');
const { requireAuth } = require('./auth');
const { requirePayrollStaff } = require('./payrollRoles');
const { logChange } = require('./change-log');
const store = require('./paymentHoldStore');

function who(req) {
  const u = (req && req.user) || {};
  return u.name || u.email || u.username || null;
}

function wrap(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[payment-holds]', req.method, req.path, err);
    res.status(status).json({ error: err.message });
  });
}

router.get('/', requireAuth, wrap(async (req, res) => {
  const pool = getPool();
  const holds = await store.listHolds(pool, {
    activeOnly: String(req.query.active || '') === '1',
    payeeKey: req.query.payee || req.query.payeeKey || '',
  });
  res.json({ holds });
}));

router.post('/', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  const body = req.body || {};
  const hold = await store.createHold(pool, {
    payeeKey: body.payeeKey || body.payee_key || body.payee,
    effectiveOnOrAfter: body.effectiveOnOrAfter || body.effective_on_or_after,
    note: body.note,
    createdBy: who(req),
  });
  await logChange(pool, req, {
    type: 'payment_hold.created',
    entityType: 'payment_hold',
    entityId: hold.id,
    payee: hold.payeeKey,
    summary: `Set ${hold.payeeKey} payment hold for policies effective ${hold.effectiveOnOrAfter} or later`,
    details: {
      payeeKey: hold.payeeKey,
      effectiveOnOrAfter: hold.effectiveOnOrAfter,
      note: hold.note || null,
    },
  });
  res.status(201).json({ hold });
}));

router.post('/:id/release', requireAuth, requirePayrollStaff, wrap(async (req, res) => {
  const pool = getPool();
  const hold = await store.releaseHold(pool, req.params.id, who(req));
  await logChange(pool, req, {
    type: 'payment_hold.released',
    entityType: 'payment_hold',
    entityId: hold.id,
    payee: hold.payeeKey,
    summary: `Released ${hold.payeeKey} payment hold (effective ${hold.effectiveOnOrAfter} or later)`,
    details: {
      payeeKey: hold.payeeKey,
      effectiveOnOrAfter: hold.effectiveOnOrAfter,
      createdAt: hold.createdAt,
    },
  });
  res.json({ hold });
}));

module.exports = router;

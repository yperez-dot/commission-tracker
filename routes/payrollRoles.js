'use strict';

/**
 * Payroll role checks.
 *
 *  requirePayrollStaff — payroll work (adjustments, payments, close checklist,
 *    deposits, change log). Allowed: role 'admin', or roles listed in
 *    PAYROLL_STAFF_ROLES (default "admin,staff,payroll,manager"), or an email in
 *    PAYROLL_STAFF_EMAILS (comma list). Plain 'agent' accounts are refused.
 *
 *  requirePayrollAdmin — unlock a paid/closed month, void a payment or
 *    adjustment, reopen a month. Role 'admin' required. If PAYROLL_UNLOCK_EMAILS
 *    is set, the user must also be on that list (lets you keep unlock to one
 *    person even when several people are admins).
 */

function list(envName, fallback) {
  return String(process.env[envName] || fallback || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isPayrollStaff(user) {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin') return true;
  if (list('PAYROLL_STAFF_ROLES', 'admin,staff,payroll,manager').includes(role)) return true;
  return list('PAYROLL_STAFF_EMAILS', '').includes(String(user.email || '').toLowerCase());
}

function isPayrollAdmin(user) {
  if (!user || String(user.role || '').toLowerCase() !== 'admin') return false;
  const allow = list('PAYROLL_UNLOCK_EMAILS', '');
  return !allow.length || allow.includes(String(user.email || '').toLowerCase());
}

function requirePayrollStaff(req, res, next) {
  if (!isPayrollStaff(req.user)) return res.status(403).json({ error: 'Payroll staff only' });
  next();
}

function requirePayrollAdmin(req, res, next) {
  if (!isPayrollAdmin(req.user)) return res.status(403).json({ error: 'Admin only (unlock / void / reopen)' });
  next();
}

module.exports = { isPayrollStaff, isPayrollAdmin, requirePayrollStaff, requirePayrollAdmin };

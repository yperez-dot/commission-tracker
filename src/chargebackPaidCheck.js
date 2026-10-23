'use strict';

/**
 * Chargeback-vs-paid check for BSI feeds (read-only, never changes a split).
 *
 * Carriers sometimes charge back more than they ever paid on a policy, or charge back a
 * policy they never paid. Each chargeback is matched by carrier + policy number (or, when
 * the policy is blank, carrier + client name + effective date) against everything imported
 * for it across all BSI uploads:
 *   paid         = sum of positive lines (HRA / bonus / fee / held lines excluded)
 *   charged back = sum of negative lines (same exclusions), i.e. this one plus earlier ones
 * Flags: 'no_payment' when nothing positive was found, 'exceeds_paid' when the cumulative
 * chargebacks are more than what was paid.
 */

const { clientNameKey } = require('./clientNameKey');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);

function carrierKey(carrier) {
  const c = String(carrier || '').trim().toLowerCase();
  if (!c) return '';
  if (c.includes('omaha')) return 'unitedofomaha';
  if (c.includes('united') || c === 'uhc') return 'uhc';
  for (const k of ['aetna', 'humana', 'devoted', 'optimum', 'freedom', 'doctors', 'solis']) {
    if (c.includes(k)) return k;
  }
  if (c.includes('healthspring') || c.includes('cigna')) return 'healthspring';
  if (c.includes('elevance') || c.includes('anthem')) return 'elevance';
  if (c.includes('healthsun') || c.includes('health sun')) return 'healthsun';
  return c.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Date-ish → YYYY-MM-DD (or '' when unknown). */
function dayKey(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return '';
}

/** HRA, bonus, fee and held lines are not carrier commission paid on the policy. */
function isExcludedLine(classification) {
  const c = String(classification || '').toLowerCase();
  return c.includes('hra') || c.includes('bonus') || c.includes('fee') || c.includes('held');
}

function fields(row) {
  return {
    carrier: row.carrier,
    policy: row.policyNumber != null ? row.policyNumber : row.policy_number,
    client: row.client != null ? row.client : row.client_full_name,
    effective: row.effectiveDate != null ? row.effectiveDate : row.effective_date,
    amount: num(row.commission != null ? row.commission : row.amount),
    classification: row.classification,
  };
}

/** { policyKey, nameKey } for a row; either may be null. */
function matchKeys(row) {
  const f = fields(row);
  const ck = carrierKey(f.carrier);
  const policy = String(f.policy || '').trim().toLowerCase();
  const name = clientNameKey(f.client);
  const eff = dayKey(f.effective);
  return {
    policyKey: policy ? `${ck}|p:${policy}` : null,
    nameKey: name && eff ? `${ck}|n:${name}|${eff}` : null,
  };
}

function addTo(map, key, amt) {
  if (!key) return;
  map.set(key, round2((map.get(key) || 0) + amt));
}

/** Totals over a set of rows: paid / charged back by policy key and by name key. */
function buildTotals(rows) {
  const t = { paidP: new Map(), paidN: new Map(), cbP: new Map(), cbN: new Map() };
  for (const row of rows || []) {
    const f = fields(row);
    if (isExcludedLine(f.classification) || Math.abs(f.amount) < 0.005) continue;
    const { policyKey, nameKey } = matchKeys(row);
    if (f.amount > 0) {
      addTo(t.paidP, policyKey, f.amount);
      addTo(t.paidN, nameKey, f.amount);
    } else {
      addTo(t.cbP, policyKey, -f.amount);
      addTo(t.cbN, nameKey, -f.amount);
    }
  }
  return t;
}

/** Check one chargeback row against the totals. Returns a flag object or null. */
function checkOne(row, totals) {
  const f = fields(row);
  if (!(f.amount < -0.005) || isExcludedLine(f.classification)) return null;
  const { policyKey, nameKey } = matchKeys(row);
  let paid = 0;
  let chargedBack = 0;
  let matchedBy = null;
  // Policy number when the chargeback has one; client name + effective date only when blank.
  if (policyKey) {
    if ((totals.paidP.get(policyKey) || 0) > 0) {
      paid = totals.paidP.get(policyKey);
      chargedBack = totals.cbP.get(policyKey) || 0;
      matchedBy = 'policy';
    }
  } else if (nameKey && (totals.paidN.get(nameKey) || 0) > 0) {
    paid = totals.paidN.get(nameKey);
    chargedBack = totals.cbN.get(nameKey) || 0;
    matchedBy = 'client_and_effective_date';
  }
  if (!matchedBy) {
    chargedBack = (policyKey ? totals.cbP.get(policyKey) : totals.cbN.get(nameKey)) || -f.amount;
    return { status: 'no_payment', paid: 0, chargedBack: round2(chargedBack), excess: round2(chargedBack), matchedBy: null };
  }
  if (chargedBack > paid + 0.01) {
    return { status: 'exceeds_paid', paid: round2(paid), chargedBack: round2(chargedBack), excess: round2(chargedBack - paid), matchedBy };
  }
  return null;
}

function flagNote(flag) {
  if (!flag) return '';
  return flag.status === 'no_payment'
    ? 'Chargeback: no payment found for this policy — dispute with carrier'
    : `Chargeback exceeds what was paid ($${flag.paid.toFixed(2)} paid, $${flag.chargedBack.toFixed(2)} charged back) — dispute with carrier`;
}

/**
 * Upload check: `records` = the file being imported, `storedRows` = BSI rows already in the
 * database for the same policies / clients. Returns [{ record, flag }] for this file's
 * flagged chargebacks. Does not modify the records.
 */
function checkUploadChargebacks(records, storedRows) {
  const totals = buildTotals([...(storedRows || []), ...(records || [])]);
  const out = [];
  for (const r of records || []) {
    const flag = checkOne(r, totals);
    if (flag) out.push({ record: r, flag });
  }
  return out;
}

/**
 * Stored-data check: every flagged chargeback among `rows` (all BSI rows). Optional
 * opts.period limits the listed chargebacks to one payment period (totals still use all rows).
 */
function checkStoredChargebacks(rows, opts = {}) {
  const totals = buildTotals(rows);
  const out = [];
  for (const r of rows || []) {
    if (opts.period && String(r.payment_period || r.period || '') !== String(opts.period)) continue;
    const flag = checkOne(r, totals);
    if (flag) out.push({ record: r, flag });
  }
  return out;
}

/** Upload-result / UI summary, like the no-split warning. */
function summarizeFlags(flags) {
  if (!flags || !flags.length) return null;
  const over = flags.filter((f) => f.flag.status === 'exceeds_paid').length;
  const none = flags.length - over;
  const parts = [];
  if (over) parts.push(`${over} chargeback(s) exceed what was paid`);
  if (none) parts.push(`${none} chargeback(s) with no payment found`);
  return {
    count: flags.length,
    exceedsPaid: over,
    noPayment: none,
    total: round2(flags.reduce((s, f) => s + num(f.record.commission != null ? f.record.commission : f.record.amount), 0)),
    message: `${parts.join(', ')} — dispute with the carrier`,
  };
}

/** Policy numbers and name keys to load stored rows for (upload path). */
function lookupKeys(records) {
  const policies = new Set();
  const names = new Set();
  for (const r of records || []) {
    const f = fields(r);
    if (!(f.amount < 0)) continue;
    const p = String(f.policy || '').trim().toLowerCase();
    if (p) {
      policies.add(p);
      continue;
    }
    const n = clientNameKey(f.client);
    if (n) names.add(n);
  }
  return { policies: [...policies], names: [...names] };
}

module.exports = {
  carrierKey,
  dayKey,
  isExcludedLine,
  matchKeys,
  buildTotals,
  checkOne,
  flagNote,
  checkUploadChargebacks,
  checkStoredChargebacks,
  summarizeFlags,
  lookupKeys,
};

/** Flat row for the upload result / UI table / export. */
function chargebackFlagRow({ record: r, flag }) {
  const f = fields(r);
  return {
    id: r.id != null ? r.id : null,
    agent: r.agent != null ? r.agent : r.agent_name,
    carrier: f.carrier,
    client: f.client,
    policy: f.policy,
    effectiveDate: f.effective instanceof Date ? dayKey(f.effective) : f.effective,
    period: r.period != null ? r.period : r.payment_period,
    classification: f.classification,
    amount: round2(f.amount),
    status: flag.status,
    paid: flag.paid,
    chargedBack: flag.chargedBack,
    excess: flag.excess,
    matchedBy: flag.matchedBy,
    uploadId: r.upload_id != null ? r.upload_id : null,
  };
}

module.exports.chargebackFlagRow = chargebackFlagRow;

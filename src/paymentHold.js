'use strict';

/**
 * Payment hold for house override statements (THEI / BSI).
 *
 * An active hold is a live display/export filter: lines whose policy
 * effective date is on or after the hold date are left out of payable
 * totals. Stored commission rows are not rewritten. Releasing the hold
 * (released_at set) stops the filter, so those lines reappear on the
 * statement for their original payment_period. They cannot be paid twice
 * because they were never in the payable / sent-to-commissions amount.
 *
 * NOTE: no array destructuring / spread in this file. The CRA frontend
 * imports it and Babel would inject an ESM helper that hides module.exports
 * (same constraint as src/periodFormat.js).
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizePayeeKey(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'thei' || s === 'the' || s.indexOf('health expert') !== -1) return 'thei';
  if (s === 'bsi' || s.indexOf('broker society') !== -1) return 'bsi';
  return s.replace(/\s+/g, '-');
}

/** House types that a THEI / BSI hold applies to. Other payees are untouched. */
function holdPayeeKeyForType(statementType) {
  const t = String(statementType || '');
  if (t === 'thei_bsi' || t === 'thei_override' || t === 'thei_nhp') return 'thei';
  if (t === 'bsi_override') return 'bsi';
  return '';
}

/**
 * Normalize a date-ish value to YYYY-MM-DD (UTC for Date/ISO).
 * Accepts Date, ISO, YYYY-MM-DD, MM/DD/YYYY, MM-DD-YYYY, MM.YYYY, YYYY-MM, YYYYMM.
 */
function parseEffectiveYmd(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getUTCFullYear() + '-' + pad2(value.getUTCMonth() + 1) + '-' + pad2(value.getUTCDate());
  }
  const s = String(value).trim();
  if (!s || s === '—') return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return m[3] + '-' + pad2(Number(m[1])) + '-' + pad2(Number(m[2]));
  m = s.match(/^(\d{1,2})\.(\d{4})$/);
  if (m) return m[2] + '-' + pad2(Number(m[1])) + '-01';
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return m[1] + '-' + m[2] + '-01';
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return m[1] + '-' + m[2] + '-01';
  return null;
}

function isEffectiveOnOrAfter(effectiveDate, holdDate) {
  const a = parseEffectiveYmd(effectiveDate);
  const b = parseEffectiveYmd(holdDate);
  if (!a || !b) return false;
  return a >= b;
}

function isActiveHold(hold) {
  if (!hold) return false;
  if (hold.releasedAt || hold.released_at) return false;
  return !!(hold.effectiveOnOrAfter || hold.effective_on_or_after);
}

function formatHoldMoney(n) {
  const v = round2(n);
  const abs = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-$' : '$') + abs;
}

function defaultHoldNote(stats) {
  const year = (stats.holdYmd || '').slice(0, 4) || '2027';
  return (
    'Hold: ' + year + '-effective overrides (' +
    stats.lineCount + ' line items across ' + stats.policyCount +
    ' policies, ' + formatHoldMoney(stats.heldTotal) +
    ') are being held and will be paid in 12.2026 or 01.2027. They are not included in this statement.'
  );
}

function holdNoteText(hold, stats) {
  const custom = hold && (hold.note != null ? hold.note : hold.note_text);
  if (custom && String(custom).trim()) return String(custom).trim();
  return defaultHoldNote(stats);
}

function policyKey(line) {
  const p = String(line && line.policy_number != null ? line.policy_number : '').trim();
  if (p) return p;
  return 'id:' + String(line && line.id != null ? line.id : '');
}

function applyHoldToStatement(statement, hold) {
  if (!statement) return statement;
  if (!isActiveHold(hold)) {
    return Object.assign({}, statement, {
      hold: null,
      heldLines: [],
      heldTotal: 0,
    });
  }
  const holdYmd = parseEffectiveYmd(hold.effectiveOnOrAfter || hold.effective_on_or_after);
  const payable = [];
  const held = [];
  const lines = statement.lines || [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isEffectiveOnOrAfter(line.effective_date, holdYmd)) held.push(line);
    else payable.push(line);
  }
  let payableTotal = 0;
  let heldTotal = 0;
  for (let i = 0; i < payable.length; i += 1) payableTotal += Number(payable[i].amount) || 0;
  for (let i = 0; i < held.length; i += 1) heldTotal += Number(held[i].amount) || 0;
  const policies = {};
  for (let i = 0; i < held.length; i += 1) policies[policyKey(held[i])] = true;
  const policyCount = Object.keys(policies).length;
  const stats = {
    lineCount: held.length,
    policyCount: policyCount,
    heldTotal: round2(heldTotal),
    holdYmd: holdYmd,
  };
  return Object.assign({}, statement, {
    lines: payable,
    total: round2(payableTotal),
    lineCount: payable.length,
    heldLines: held,
    heldTotal: round2(heldTotal),
    hold: {
      id: hold.id || null,
      payeeKey: normalizePayeeKey(hold.payeeKey || hold.payee_key),
      effectiveOnOrAfter: holdYmd,
      note: holdNoteText(hold, stats),
      createdAt: hold.createdAt || hold.created_at || null,
      releasedAt: null,
      heldLineCount: held.length,
      heldPolicyCount: policyCount,
      heldTotal: round2(heldTotal),
    },
  });
}

function applyHoldsToBundle(bundle, holds) {
  if (!bundle) return bundle;
  const list = holds || [];
  const byKey = {};
  for (let i = 0; i < list.length; i += 1) {
    const h = list[i];
    if (!isActiveHold(h)) continue;
    const k = normalizePayeeKey(h.payeeKey || h.payee_key);
    if (k) byKey[k] = h;
  }
  const typeKey = holdPayeeKeyForType(bundle.type);
  const statements = [];
  const src = bundle.statements || [];
  for (let i = 0; i < src.length; i += 1) {
    const s = src[i];
    let hold = null;
    if (typeKey && byKey[typeKey]) hold = byKey[typeKey];
    else if (byKey[normalizePayeeKey(s.payeeGroupKey || s.payee)]) {
      hold = byKey[normalizePayeeKey(s.payeeGroupKey || s.payee)];
    }
    statements.push(applyHoldToStatement(s, hold));
  }
  let grand = 0;
  for (let i = 0; i < statements.length; i += 1) grand += Number(statements[i].total) || 0;
  return Object.assign({}, bundle, {
    statements: statements,
    statementCount: statements.length,
    grandTotal: round2(grand),
  });
}

function rowToHold(row) {
  if (!row) return null;
  return {
    id: row.id,
    payeeKey: row.payee_key,
    effectiveOnOrAfter: row.effective_on_or_after
      ? parseEffectiveYmd(row.effective_on_or_after)
      : null,
    note: row.note || '',
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    releasedBy: row.released_by || null,
    releasedAt: row.released_at || null,
  };
}

module.exports = {
  normalizePayeeKey,
  holdPayeeKeyForType,
  parseEffectiveYmd,
  isEffectiveOnOrAfter,
  isActiveHold,
  formatHoldMoney,
  defaultHoldNote,
  holdNoteText,
  applyHoldToStatement,
  applyHoldsToBundle,
  rowToHold,
  round2,
};

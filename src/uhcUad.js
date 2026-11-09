'use strict';

/**
 * UHC unearned-advance (UAD) recoup helpers.
 *
 * UAD Activity on a UHC statement is UHC recouping previously advanced commission.
 * It is stored on its own amount field (`uad_activity` / `uadActivity`) and must
 * never be folded into `commission`, splits, or agent-facing statement totals.
 *
 * NOTE: no array destructuring / spread in this file. The CRA frontend may import
 * the classification label and Babel would inject an ESM helper that hides
 * module.exports (same constraint as src/periodFormat.js).
 */

var UAD_CLASSIFICATION = 'UHC advance recoup (UAD)';

function parseUhcMoney(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') {
    if (!isFinite(raw)) return 0;
    return Math.round(raw * 100) / 100;
  }
  var s = String(raw).trim();
  if (!s) return 0;
  var neg = false;
  if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.charAt(0) === '-') {
    neg = true;
    s = s.slice(1);
  }
  var n = parseFloat(s);
  if (!isFinite(n)) return 0;
  if (neg) n = -n;
  return Math.round(n * 100) / 100;
}

function rowValue(row, names) {
  if (!row || typeof row !== 'object') return undefined;
  var i;
  for (i = 0; i < names.length; i++) {
    if (Object.prototype.hasOwnProperty.call(row, names[i]) && row[names[i]] !== undefined && row[names[i]] !== '') {
      return row[names[i]];
    }
  }
  var keys = Object.keys(row);
  var want = [];
  for (i = 0; i < names.length; i++) want.push(String(names[i]).toLowerCase().replace(/\s+/g, ''));
  for (i = 0; i < keys.length; i++) {
    var compact = String(keys[i]).toLowerCase().replace(/\s+/g, '');
    var j;
    for (j = 0; j < want.length; j++) {
      if (compact === want[j]) return row[keys[i]];
    }
  }
  return undefined;
}

function parseUadActivity(row) {
  return parseUhcMoney(rowValue(row, ['UAD Activity', 'UADActivity', 'UAD']));
}

function uadAmount(record) {
  if (!record) return 0;
  if (record.uadActivity != null && record.uadActivity !== '') {
    return parseUhcMoney(record.uadActivity);
  }
  if (record.uad_activity != null && record.uad_activity !== '') {
    return parseUhcMoney(record.uad_activity);
  }
  var raw = record.raw || record.raw_data;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      raw = null;
    }
  }
  if (raw && typeof raw === 'object') return parseUadActivity(raw);
  return 0;
}

function isUadOnly(record) {
  if (!record) return false;
  var commission = parseUhcMoney(record.commission);
  return commission === 0 && uadAmount(record) !== 0;
}

function isUhcUadClassification(classification) {
  return String(classification || '') === UAD_CLASSIFICATION;
}

/**
 * Attach UAD to a parsed UHC record. Commission stays the Commission column.
 * UAD-only rows (Commission $0, nonzero UAD) are labeled as an advance recoup
 * so they can be filtered without landing in New / Renewal totals.
 */
function applyUhcUad(record, row) {
  var src = row || (record && record.raw) || record;
  var uad = parseUadActivity(src);
  if (record) {
    record.uadActivity = uad;
    if (uad !== 0 && parseUhcMoney(record.commission) === 0) {
      record.classification = UAD_CLASSIFICATION;
    }
  }
  return record;
}

function moneyKey(n) {
  return parseUhcMoney(n).toFixed(2);
}

/**
 * Cross-file duplicate identity: policy + client + effective date + commission
 * + payment period + UAD. A nonzero-UAD $0 row is distinct from a plain $0 row
 * (e.g. BSI $0 vs UHC advance recoup).
 */
function crossFileDuplicateKey(record) {
  if (!record) return '';
  var policy = String(record.policyNumber || record.policy_number || record.policy || '').trim();
  var client = String(record.client || record.client_full_name || '').trim().toLowerCase();
  var date = String(record.effectiveDate || record.effective_date || record.date || '').trim();
  var period = String(record.period || record.payment_period || '').trim();
  var commission = moneyKey(record.commission != null ? record.commission : record.amount);
  var uad = moneyKey(uadAmount(record));
  return policy + '|' + client + '|' + date + '|' + commission + '|' + period + '|' + uad;
}

function pad2(n) {
  var s = String(n);
  return s.length < 2 ? '0' + s : s;
}

function normalizeStatementDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return pad2(value.getUTCMonth() + 1) + '/' + pad2(value.getUTCDate()) + '/' + value.getUTCFullYear();
  }
  var s = String(value).trim();
  if (!s) return '';
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return pad2(m[1]) + '/' + pad2(m[2]) + '/' + m[3];
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[2] + '/' + iso[3] + '/' + iso[1];
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    var date = new Date((value - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime()) && date.getUTCFullYear() > 1990 && date.getUTCFullYear() < 2100) {
      return pad2(date.getUTCMonth() + 1) + '/' + pad2(date.getUTCDate()) + '/' + date.getUTCFullYear();
    }
  }
  return s;
}

function rawObject(record) {
  if (!record) return null;
  var raw = record.raw || record.raw_data;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      var o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch (e) {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

function statementDateOf(record) {
  if (!record) return '';
  if (record.statementDate) return normalizeStatementDate(record.statementDate);
  if (record.statement_date) return normalizeStatementDate(record.statement_date);
  var raw = rawObject(record);
  if (!raw) return '';
  return normalizeStatementDate(raw['Statement Date'] || raw.StatementDate || '');
}

/**
 * Same UHC payment line across party/payee files (THEI agency vs personal 706381).
 * Policy + statement date + commission amount; agent/payee/party are ignored.
 * Empty when Statement Date is missing so BSI rows with a different amount
 * (or no UHC statement date) are not pulled in.
 */
function uhcTransactionKey(record) {
  if (!record) return '';
  var policy = String(record.policyNumber || record.policy_number || record.policy || '').trim().toLowerCase();
  var stmt = statementDateOf(record);
  if (!policy || !stmt) return '';
  return policy + '|' + stmt + '|' + moneyKey(record.commission != null ? record.commission : record.amount);
}

function recordFromDbRow(row) {
  if (!row) return null;
  var raw = rawObject({ raw_data: row.raw_data, raw: row.raw });
  return {
    policyNumber: row.policy_number || row.policyNumber,
    client: row.client_full_name || row.client,
    effectiveDate: row.effective_date || row.effectiveDate,
    commission: row.commission,
    period: row.payment_period || row.period,
    uadActivity: row.uad_activity != null ? row.uad_activity : row.uadActivity,
    carrier: row.carrier,
    statementDate: row.statement_date || row.statementDate,
    raw: raw || row.raw_data || row.raw,
  };
}

/**
 * Incoming rows that already exist. Matches either the full identity key
 * (policy+client+effective date+commission+period+UAD) or a UHC transaction
 * key (policy+statement date+amount) so the same UHC line paid under a
 * different party/payee is still a duplicate.
 */
function findIncomingDuplicates(existingRows, incomingRecords) {
  var existing = existingRows || [];
  var incoming = incomingRecords || [];
  var identity = {};
  var txn = {};
  var i;
  for (i = 0; i < existing.length; i++) {
    var er = existing[i] && (existing[i].client || existing[i].client_full_name)
      ? existing[i]
      : recordFromDbRow(existing[i]);
    if (!er) continue;
    identity[crossFileDuplicateKey(er)] = true;
    var etk = uhcTransactionKey(er);
    if (etk) txn[etk] = true;
  }
  var out = [];
  for (i = 0; i < incoming.length; i++) {
    var r = incoming[i];
    if (!r) continue;
    var idKey = crossFileDuplicateKey(r);
    var tKey = uhcTransactionKey(r);
    if ((idKey && identity[idKey]) || (tKey && txn[tKey])) out.push(r);
  }
  return out;
}

function isUHCDirectFilename(filename) {
  var f = String(filename || '').toLowerCase().replace(/\s+/g, '_');
  return f.indexOf('commission_statement_706381') !== -1;
}

function isUHCFilename(filename) {
  var f = String(filename || '').toLowerCase().replace(/\s+/g, '_');
  if (f.indexOf('p_uhc') !== -1 || f.indexOf('p-uhc') !== -1) return true;
  if (isUHCDirectFilename(f)) return false;
  if (f.indexOf('commission_statement_2737247') !== -1) return true;
  if (f.indexOf('uhc_statement') !== -1) return true;
  if (f.indexOf('uhc') !== -1 && f.indexOf('statement') !== -1) return true;
  if (f.indexOf('uhc') !== -1 && f.indexOf('thei') !== -1) return true;
  return false;
}

module.exports = {
  UAD_CLASSIFICATION: UAD_CLASSIFICATION,
  parseUhcMoney: parseUhcMoney,
  parseUadActivity: parseUadActivity,
  uadAmount: uadAmount,
  isUadOnly: isUadOnly,
  isUhcUadClassification: isUhcUadClassification,
  applyUhcUad: applyUhcUad,
  moneyKey: moneyKey,
  crossFileDuplicateKey: crossFileDuplicateKey,
  normalizeStatementDate: normalizeStatementDate,
  statementDateOf: statementDateOf,
  uhcTransactionKey: uhcTransactionKey,
  recordFromDbRow: recordFromDbRow,
  findIncomingDuplicates: findIncomingDuplicates,
  isUHCDirectFilename: isUHCDirectFilename,
  isUHCFilename: isUHCFilename,
};

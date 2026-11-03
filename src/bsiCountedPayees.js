'use strict';

/**
 * Counted payees on carrier→BSI statements (Yahoska).
 *
 * THEI only receives override money. A BSI workbook can list every writing
 * agent's own Commission rows next to the house Override rows — those writer
 * rows are the carrier paying the agent directly and must not count.
 *
 * Edit BSI_COUNTED_PAYEES to add/remove a payee. Matching is on the *payee*
 * column (Agent Name / Payee Name), never the writing agent.
 *
 * Default: Broker Society Insurance, The Health Experts Insurance, Alba Hernandez.
 */

const { isAlbaHernandez, isTheiWritingAgent, normName } = require('./payeeSchedules');

/**
 * Display names for the allowlist. Aliases (BSI, Lina, THEI LLC, …) are
 * handled in isCountedBsiPayee — do not duplicate them here.
 */
const BSI_COUNTED_PAYEES = Object.freeze([
  'Broker Society Insurance',
  'The Health Experts Insurance',
  'Alba Hernandez',
]);

const ALBA_WRITING_AGENT_CODE = 'EG5642';
const ALBA_WRITING_NPN = '21209073';

function isBsiPayeeName(name) {
  const n = normName(name);
  if (!n) return false;
  if (n === 'bsi' || n === 'bsi agent') return true;
  return n.includes('broker society');
}

/** True when the payee (Agent Name / Payee Name) is on the counted allowlist. */
function isCountedBsiPayee(name) {
  if (isBsiPayeeName(name)) return true;
  if (isTheiWritingAgent(name)) return true;
  if (isAlbaHernandez(name)) return true;
  return false;
}

function parseRaw(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : {};
    } catch (e) {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

/**
 * Payee as printed on the statement — Agent Name / Payee Name.
 * Does NOT fall back to Writing Agent.
 */
function statementPayeeFromRow(row) {
  if (!row) return '';
  if (row.statementPayee) return String(row.statementPayee).trim();
  const raw = parseRaw(row.raw || row.raw_data);
  const fromRaw = raw['Agent Name'] || raw.AgentName || raw['Payee Name'] || raw.PayeeName || '';
  if (fromRaw) return String(fromRaw).trim();
  const direct = row['Agent Name'] || row.AgentName || row['Payee Name'] || row.PayeeName || '';
  return String(direct).trim();
}

/**
 * Whether this imported / stored BSI row should count.
 * Missing payee (UHC rows stored without Agent Name in raw) still counts —
 * those feeds are already BSI-payee-only.
 */
function isCountedBsiStatementRow(row) {
  const payee = statementPayeeFromRow(row);
  if (!payee) return true;
  return isCountedBsiPayee(payee);
}

function isHraBonusRow(row) {
  const raw = parseRaw(row && (row.raw || row.raw_data));
  const src = row || {};
  const blob = [
    raw['Voucher Description'],
    raw['Commission Type'],
    raw['Product Item Name'],
    src['Voucher Description'],
    src['Commission Type'],
    src['Product Item Name'],
    src.classification,
    src.voucherDescription,
  ].join(' ');
  return /hra|bonus/i.test(blob);
}

function writingAgentFromRow(row) {
  const raw = parseRaw(row && (row.raw || row.raw_data));
  return String(
    raw['Writing Agent'] ||
      raw['Writing Agent Name'] ||
      (row && (row.writingAgent || row.agent || row.agent_name)) ||
      ''
  ).trim();
}

function writingAgentCodeFromRow(row) {
  const raw = parseRaw(row && (row.raw || row.raw_data));
  return String(raw['Writing Agent Code'] || raw['Writing Agent ID'] || '').trim().toUpperCase();
}

function writingNpnFromRow(row) {
  const raw = parseRaw(row && (row.raw || row.raw_data));
  const v = String(
    (row && row.writingNpn) ||
      raw['Writing Agent NPN'] ||
      raw['Writing Agent NPN '] ||
      raw['Producer Code'] ||
      ''
  )
    .trim()
    .replace(/\.0$/, '');
  return v;
}

/** Writing agent on the policy is Alba (name, EG5642, or NPN 21209073). */
function isAlbaWritingAgent(row) {
  if (writingAgentCodeFromRow(row) === ALBA_WRITING_AGENT_CODE) return true;
  if (writingNpnFromRow(row) === ALBA_WRITING_NPN) return true;
  return isAlbaHernandez(writingAgentFromRow(row));
}

function isOverrideCommissionType(row) {
  const raw = parseRaw(row && (row.raw || row.raw_data));
  const t = String(raw['Commission Type'] || row && row.commissionType || '').trim().toLowerCase();
  return t === 'override';
}

/**
 * BSI/THEI/Alba-payee Override chargeback on an Alba-written policy.
 * These are passed to Lina in full (not rate-peeled). UHC Commission Action
 * chargebacks do not have Commission Type = Override, so they stay peeled.
 */
function isAlbaPolicyOverrideChargeback(row) {
  const amt = Number(row && (row.commission != null ? row.commission : row.amount)) || 0;
  if (!(amt < -0.005)) return false;
  if (!isOverrideCommissionType(row)) return false;
  if (!isAlbaWritingAgent(row)) return false;
  return true;
}

function statusNote(statusRaw) {
  const s = String(statusRaw || '').trim();
  if (!s) return '';
  if (/^open$/i.test(s)) return 'Held — Open status';
  if (/hold/i.test(s)) return 'Held — Hold Commission status';
  return '';
}

module.exports = {
  BSI_COUNTED_PAYEES,
  ALBA_WRITING_AGENT_CODE,
  ALBA_WRITING_NPN,
  isBsiPayeeName,
  isCountedBsiPayee,
  statementPayeeFromRow,
  isCountedBsiStatementRow,
  isHraBonusRow,
  writingAgentFromRow,
  isAlbaWritingAgent,
  isOverrideCommissionType,
  isAlbaPolicyOverrideChargeback,
  statusNote,
  parseRaw,
};

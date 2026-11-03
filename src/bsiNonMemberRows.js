'use strict';

/**
 * BSI carrier→BSI statements (UHC) carry rows with a blank Member Name:
 *
 *   - "HA payment|chargeback for agent ID … for member NAME MBI … policy number …"
 *       HRA (health risk assessment) on one of Lina's members → paid to Lina
 *       (payment or chargeback). Member / policy are parsed from the text when
 *       the Member Name and Policy Number cells are blank. MBI may be empty.
 *   - "<ST> Appointment Initial|Renewal Fee Collection for Required Entity: …"
 *       BSI's own licensing / appointment fees → never counted: not Lina, not THEI,
 *       not in any THEI/BSI override split.
 *
 * The parsers used to drop every blank-member row, so HRA was never paid to Lina and
 * the upload no longer tied to the carrier's Commission Summary. These helpers keep
 * the rows and classify them explicitly.
 */

const { ALBA_DB_AGENT } = require('./bsiBookAttribution');

const BSI_HOUSE_AGENT = 'Broker Society Insurance';
const HRA_CLASSIFICATION = 'HRA/Bonus';
const BSI_FEE_CLASSIFICATION = 'BSI Fee';

const HA_RE =
  /^\s*HA\s+(payment|chargeback|reversal)\s+for\s+agent\s+ID\s+(\d+)\s+for\s+member\s+(.+?)\s+MBI(?:\s+(?!policy\s+number)(\S+))?\s+policy\s+number\s+(\S+)/i;
const HA_RE_NO_MBI =
  /^\s*HA\s+(payment|chargeback|reversal)\s+for\s+agent\s+ID\s+(\d+)\s+for\s+member\s+(.+?)\s+policy\s+number\s+(\S+)/i;
const FEE_RE = /Appointment\s+(Initial|Renewal)\s+Fee Collection/i;
const FEE_DETAIL_RE =
  /^\s*([A-Z]{2})\s+Appointment\s+(Initial|Renewal)\s+Fee Collection.*?for Required Entity:\s*(.+?)\s*$/i;

/**
 * Parse UHC "HA payment/chargeback for agent ID … for member … policy number …"
 * text. Member Name / Policy Number cells are often blank on these rows.
 */
function parseHaDescription(description) {
  const text = String(description || '').trim();
  if (!text) return null;
  const withMbi = text.match(HA_RE);
  if (withMbi) {
    return {
      kind: withMbi[1].toLowerCase(),
      agentId: withMbi[2],
      member: withMbi[3].replace(/\s+/g, ' ').trim(),
      mbi: withMbi[4] || '',
      policy: withMbi[5],
    };
  }
  const noMbi = text.match(HA_RE_NO_MBI);
  if (noMbi) {
    return {
      kind: noMbi[1].toLowerCase(),
      agentId: noMbi[2],
      member: noMbi[3].replace(/\s+MBI\s*$/i, '').replace(/\s+/g, ' ').trim(),
      mbi: '',
      policy: noMbi[4],
    };
  }
  return null;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  return parseFloat(String(v == null ? '' : v).replace(/[$,]/g, '')) || 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Classify a blank-Member-Name row. Returns a parsed record, or null when the row
 * is not an HA payment / appointment fee (or has no amount).
 */
function classifyBsiNonMemberRow(row, opts = {}) {
  const description = String(row['Commission Action'] || '').trim();
  const commission = round2(toNumber(row['Commission']));
  if (!description || commission === 0) return null;

  const period = String(opts.period || row['Payment Period'] || '').trim();
  const carrier = opts.carrier || 'UnitedHealthcare';

  const ha = parseHaDescription(description);
  if (ha) {
    const isChargeback = ha.kind !== 'payment' || commission < -0.005;
    return {
      agent: ALBA_DB_AGENT,
      carrier,
      planType: '',
      client: ha.member,
      effectiveDate: '',
      premium: 0,
      commission,
      classification: HRA_CLASSIFICATION,
      period,
      policyNumber: ha.policy,
      payee: 'BSI',
      source: 'BSI',
      // HRA is paid straight through to Lina: no FMV-cap peel, no THEI/BSI share.
      // Chargebacks use the same HA path (not UHC rate-peel, not Override pass-through).
      grossCommission: commission,
      producerPayable: commission,
      theiShare: 0,
      bsiShare: 0,
      splitApplies: false,
      mga: isChargeback ? 'HRA chargeback — paid to Lina' : 'HRA payment — paid to Lina',
      raw: row,
    };
  }

  if (FEE_RE.test(description)) {
    const d = description.match(FEE_DETAIL_RE);
    const label = d
      ? `BSI FEE ${d[1].toUpperCase()} ${d[2]} — ${d[3]}`
      : `BSI FEE — ${description}`;
    return {
      agent: BSI_HOUSE_AGENT,
      carrier,
      planType: '',
      client: label,
      effectiveDate: '',
      premium: 0,
      commission,
      classification: BSI_FEE_CLASSIFICATION,
      period,
      policyNumber: 'FEE',
      payee: 'BSI',
      source: 'BSI',
      // BSI licensing / appointment fee: not Lina, not THEI, not in any split.
      grossCommission: commission,
      producerPayable: 0,
      theiShare: 0,
      bsiShare: 0,
      splitApplies: false,
      mga: 'BSI appointment/licensing fee — excluded from splits and agent statements',
      raw: row,
    };
  }

  return null;
}

/** Sum the "Commission Activity" column of a carrier Commission Summary sheet. */
function sumSummaryActivity(summaryRows) {
  if (!Array.isArray(summaryRows) || !summaryRows.length) return null;
  let total = 0;
  let found = false;
  for (const r of summaryRows) {
    const v = r['Commission Activity'];
    if (v === '' || v == null) continue;
    total += toNumber(v);
    found = true;
  }
  return found ? round2(total) : null;
}

/**
 * Compare what was imported against the carrier's own Commission Summary.
 * Held rows (commission $0) are ignored by the sum automatically.
 */
function reconcileToSummary(records, summaryTotal, excludedFees = 0) {
  const importedTotal = round2((records || []).reduce((s, r) => s + (parseFloat(r.commission) || 0), 0));
  const excluded = round2(excludedFees);
  if (summaryTotal == null) {
    return { checked: false, importedTotal, excludedFees: excluded, summaryTotal: null, variance: null, ok: null };
  }
  // Excluded BSI fees are on the carrier summary but deliberately not stored.
  const variance = round2(importedTotal + excluded - summaryTotal);
  return {
    checked: true,
    importedTotal,
    excludedFees: excluded,
    summaryTotal,
    variance,
    ok: Math.abs(variance) < 0.01,
  };
}

module.exports = {
  BSI_HOUSE_AGENT,
  HRA_CLASSIFICATION,
  BSI_FEE_CLASSIFICATION,
  parseHaDescription,
  classifyBsiNonMemberRow,
  sumSummaryActivity,
  reconcileToSummary,
};

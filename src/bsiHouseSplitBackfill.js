'use strict';

/**
 * Safe fill-in for already-imported BSI rows (dry run by default, scoped to an upload or
 * a payment period — never all months, no catch-ups).
 *
 * 1. Lines with dollars and NO split whose writing agent gets the house split (other
 *    agents, and THEI itself as the writing agent): producer 0, THEI/BSI 50/50, Marco $10
 *    first for Swan agents (once per policy, across uploads). Chargebacks reverse it.
 * 2. Swan/Marco correction: rows the old name matching missed (e.g. a middle initial in
 *    the feed) that were stored as a plain 50/50 with no Marco $10. The first such line per
 *    policy (when no $10 was taken on that policy yet) moves $10 from THEI/BSI (5 + 5) to
 *    Marco; a stored chargeback on such a policy reverses Marco's share in proportion.
 *
 * 3. Lina chargebacks (kind 'lina_cb_prorate'): re-split in proportion to the original
 *    payment(s) on the carrier + policy (Lina's cumulative producer payable / cumulative gross,
 *    the rest THEI/BSI in the original THEI/BSI proportion) when the stored split differs.
 *    No original found → left as is.
 *
 * Steps 1–2 never touch a row that already has a different split, Lina, Integrity, HRA or fees.
 */

const {
  MARCO_AGENTS,
  isMarcoAgent,
  isAlbaAgentCommission,
  isAgencyOverride,
} = require('./payeeSchedules');
const { legacyAgentNameInList } = require('./agentNameMatch');
const { splitFullOverridePot } = require('./overrideSplitMath');
const {
  fillHouseSplit,
  reverseHouseSplit,
  hasNoSplit,
  isHraOrFee,
  isHouseSplitBsiAgent,
  policyKey,
} = require('./bsiBookAttribution');
const { isTheiWritingAgent } = require('./payeeSchedules');
const {
  isLinaChargeback,
  linaPolicyKey,
  linaProportionalChargeback,
  proportionalNote,
  loadLinaOriginalSales,
} = require('./linaChargebackProrate');

const GUARD_NOTE = 'No THEI/BSI split stored for this line — review';
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

function stripGuardNote(mga) {
  return String(mga || '')
    .split(' | ')
    .filter((p) => p && p !== GUARD_NOTE)
    .join(' | ');
}

function toRecord(row) {
  return {
    id: row.id,
    agent: row.agent_name,
    carrier: row.carrier,
    classification: row.classification,
    commission: num(row.commission),
    policyNumber: row.policy_number,
    period: row.payment_period,
    producerPayable: row.producer_payable == null ? null : num(row.producer_payable),
    theiShare: row.thei_share == null ? null : num(row.thei_share),
    bsiShare: row.bsi_share == null ? null : num(row.bsi_share),
    subAgentOverride: num(row.sub_agent_override),
    splitApplies: row.split_applies,
    mga: row.mga || '',
    source: row.source,
    storedGross: row.gross_commission == null ? null : num(row.gross_commission),
  };
}

function snapshot(r) {
  return {
    producerPayable: num(r.producerPayable),
    theiShare: num(r.theiShare),
    bsiShare: num(r.bsiShare),
    subAgentOverride: num(r.subAgentOverride),
  };
}

const isBsiSource = (s) => ['BSI', 'BSI_PAYEE'].includes(String(s || '').toUpperCase().trim());
const isHeld = (c) => String(c || '').toLowerCase().includes('held');
const byPeriodThenId = (a, b) =>
  String(a.period || '').localeCompare(String(b.period || '')) || (Number(a.id) || 0) - (Number(b.id) || 0);

/** Swan agent only under the new tolerant matching (the old substring rule missed it). */
function isNewlyMatchedMarco(agent, period) {
  return isMarcoAgent(agent, period) && !legacyAgentNameInList(agent, MARCO_AGENTS);
}

/**
 * Pure planner. rows: DB rows in scope. history: { deductedPolicies:Set, marcoOriginals:Map }
 * from stored data (policy → { gross, sub, reversed }). Returns { updates, summary }.
 */
function planBsiHouseSplitBackfill(rows, history = {}) {
  const deducted = new Set(history.deductedPolicies ? [...history.deductedPolicies] : []);
  const marcoOriginals = new Map();
  if (history.marcoOriginals instanceof Map) {
    for (const [k, v] of history.marcoOriginals) marcoOriginals.set(k, { ...v });
  }
  const recs = (rows || []).map(toRecord).filter((r) =>
    isBsiSource(r.source) && !isHeld(r.classification) && !isHraOrFee(r.classification) &&
    Math.abs(r.commission) >= 0.005);
  recs.sort(byPeriodThenId);

  const updates = [];
  const push = (r, kind, before) => {
    updates.push({
      id: r.id,
      kind,
      period: r.period,
      classification: r.classification,
      commission: r.commission,
      before,
      after: snapshot(r),
      grossCommission: r.grossCommission != null ? r.grossCommission
        : (r.storedGross != null && r.storedGross !== 0 ? r.storedGross : r.commission),
      splitApplies: !!r.splitApplies,
      mga: stripGuardNote(r.mga),
    });
  };

  // 1. Unsplit house-split lines (agent production classes only, like the upload path).
  const fill = recs.filter((r) => !isAgencyOverride(r.classification) &&
    isAlbaAgentCommission(r.classification) && hasNoSplit(r) && isHouseSplitBsiAgent(r.agent));
  const deferred = [];
  for (const r of fill) {
    const before = snapshot(r);
    const res = fillHouseSplit(r, r.commission, deducted);
    if (res === 'filled') push(r, isTheiWritingAgent(r.agent) ? 'thei_fill' : 'other_fill', before);
    if (res === 'deferred') deferred.push({ r, before });
  }
  for (const r of fill) {
    const sub = num(r.subAgentOverride);
    const pk = policyKey(r);
    if (sub > 0 && pk && r.commission > 0 && !marcoOriginals.has(pk)) {
      marcoOriginals.set(pk, { gross: r.commission, sub, reversed: 0 });
    }
  }

  // 2. Swan correction: stored as plain 50/50, no $10, agent missed by the old matching.
  const plain5050 = (r) => r.splitApplies !== false && num(r.producerPayable) === 0 &&
    num(r.subAgentOverride) === 0 &&
    Math.abs(num(r.theiShare) + num(r.bsiShare) - r.commission) < 0.02 &&
    Math.abs(num(r.theiShare) - num(r.bsiShare)) < 0.02;
  const fixable = recs.filter((r) => !hasNoSplit(r) && plain5050(r) &&
    (isAgencyOverride(r.classification) || isAlbaAgentCommission(r.classification)) &&
    isNewlyMatchedMarco(r.agent, r.period));
  for (const r of fixable.filter((x) => x.commission > 0)) {
    const pk = policyKey(r);
    if (!pk || deducted.has(r.policyNumber) || deducted.has(pk) || r.commission < 10) continue;
    const before = snapshot(r);
    const split = splitFullOverridePot(r.commission, { agentName: r.agent, paymentPeriod: r.period });
    if (!split.subAgentOverride) continue;
    r.theiShare = split.theiShare;
    r.bsiShare = split.bsiShare;
    r.subAgentOverride = split.subAgentOverride;
    r.producerPayable = 0;
    r.splitApplies = true;
    deducted.add(r.policyNumber);
    deducted.add(pk);
    if (!marcoOriginals.has(pk)) marcoOriginals.set(pk, { gross: r.commission, sub: split.subAgentOverride, reversed: 0 });
    push(r, 'marco_fix', before);
  }
  // Chargebacks of fill (deferred) and of corrected policies — only when the sale's $10 is known.
  for (const { r, before } of deferred) {
    reverseHouseSplit(r, r.commission, marcoOriginals);
    push(r, isTheiWritingAgent(r.agent) ? 'thei_fill' : 'other_fill', before);
  }
  for (const r of fixable.filter((x) => x.commission < 0)) {
    const orig = marcoOriginals.get(policyKey(r));
    if (!orig || !(orig.sub > 0)) continue;
    const before = snapshot(r);
    reverseHouseSplit(r, r.commission, marcoOriginals);
    if (num(r.subAgentOverride) === 0) continue;
    push(r, 'marco_fix', before);
  }

  // 3. Lina chargebacks → proportional to the original payment(s) on the policy.
  const linaOriginals = history.linaOriginals instanceof Map ? history.linaOriginals : new Map();
  const LINA_STALE_NOTES = [/^Chargeback override prorated/, /^Alba rate review/, /^Lina chargeback taken back in proportion/];
  for (const r of recs.filter((x) => isLinaChargeback(x))) {
    const orig = linaOriginals.get(linaPolicyKey(r));
    const split = linaProportionalChargeback(r.commission, orig);
    if (!split) continue;
    const before = snapshot(r);
    const same = Math.abs(before.producerPayable - split.producerPayable) < 0.005 &&
      Math.abs(before.theiShare - split.theiShare) < 0.005 &&
      Math.abs(before.bsiShare - split.bsiShare) < 0.005;
    if (same) continue;
    r.producerPayable = split.producerPayable;
    r.theiShare = split.theiShare;
    r.bsiShare = split.bsiShare;
    r.subAgentOverride = before.subAgentOverride;
    r.grossCommission = r.commission;
    r.splitApplies = false;
    r.mga = [...String(r.mga || '').split(' | ').filter((p) => p && !LINA_STALE_NOTES.some((re) => re.test(p))),
      proportionalNote(orig)].join(' | ');
    push(r, 'lina_cb_prorate', before);
  }

  const summary = { rows: updates.length, byKind: {}, theiDelta: 0, bsiDelta: 0, marcoDelta: 0, linaDelta: 0 };
  for (const u of updates) {
    summary.byKind[u.kind] = (summary.byKind[u.kind] || 0) + 1;
    summary.theiDelta = round2(summary.theiDelta + u.after.theiShare - u.before.theiShare);
    summary.bsiDelta = round2(summary.bsiDelta + u.after.bsiShare - u.before.bsiShare);
    summary.marcoDelta = round2(summary.marcoDelta + u.after.subAgentOverride - u.before.subAgentOverride);
    if (u.kind === 'lina_cb_prorate') {
      summary.linaDelta = round2(summary.linaDelta + u.after.producerPayable - u.before.producerPayable);
    }
  }
  return { updates, summary };
}

async function loadMarcoHistory(pool) {
  const deductedPolicies = new Set();
  const marcoOriginals = new Map();
  const r = await pool.query(`
    SELECT TRIM(policy_number) AS policy,
           SUM(CASE WHEN sub_agent_override > 0 THEN sub_agent_override ELSE 0 END)::float AS sub,
           SUM(CASE WHEN sub_agent_override > 0
                    THEN COALESCE(NULLIF(gross_commission, 0), commission, 0) ELSE 0 END)::float AS gross,
           SUM(CASE WHEN sub_agent_override < 0 THEN -sub_agent_override ELSE 0 END)::float AS reversed
    FROM commission_records
    WHERE COALESCE(sub_agent_override, 0) <> 0
      AND COALESCE(TRIM(policy_number), '') <> ''
    GROUP BY TRIM(policy_number)`);
  for (const row of r.rows) {
    if ((row.sub || 0) > 0) {
      deductedPolicies.add(row.policy);
      deductedPolicies.add(String(row.policy).toLowerCase());
    }
    marcoOriginals.set(String(row.policy).toLowerCase(), {
      gross: row.gross || 0, sub: row.sub || 0, reversed: row.reversed || 0,
    });
  }
  return { deductedPolicies, marcoOriginals };
}

/**
 * Run (or dry-run) the backfill for one or more uploads or one payment period.
 * opts: { uploadIds?: number[], period?: 'YYYYMM', apply?: boolean }
 */
async function runBsiHouseSplitBackfill(pool, opts = {}) {
  const uploadIds = (opts.uploadIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const period = /^\d{6}$/.test(String(opts.period || '')) ? String(opts.period) : null;
  if (!uploadIds.length && !period) throw new Error('uploadId or period (YYYYMM) is required');
  const params = [];
  const where = [];
  if (uploadIds.length) { params.push(uploadIds); where.push(`cr.upload_id = ANY($${params.length}::int[])`); }
  if (period) { params.push(period); where.push(`cr.payment_period = $${params.length}`); }
  const sel = await pool.query(
    `SELECT cr.id, cr.agent_name, cr.carrier, cr.classification, cr.commission, cr.policy_number,
            cr.payment_period, cr.gross_commission, cr.producer_payable, cr.thei_share, cr.bsi_share, cr.sub_agent_override,
            cr.split_applies, cr.mga, cr.source, cr.upload_id
     FROM commission_records cr
     WHERE UPPER(COALESCE(cr.source, '')) IN ('BSI', 'BSI_PAYEE') AND ${where.join(' AND ')}`,
    params
  );
  const history = await loadMarcoHistory(pool);
  history.linaOriginals = await loadLinaOriginalSales(
    pool,
    sel.rows.filter((r) => isLinaChargeback(r)).map((r) => r.policy_number)
  );
  const plan = planBsiHouseSplitBackfill(sel.rows, history);
  if (!opts.apply) return { dryRun: true, ...plan };

  const client = await pool.connect();
  let applied = 0;
  try {
    await client.query('BEGIN');
    for (const u of plan.updates) {
      // Only if the row still has the split we planned from (no double-apply on a re-run).
      const q = await client.query(
        `UPDATE commission_records
         SET gross_commission = $2, producer_payable = $3, thei_share = $4, bsi_share = $5,
             sub_agent_override = $6, split_applies = $7, mga = $8
         WHERE id = $1
           AND COALESCE(producer_payable, 0) = $9 AND COALESCE(thei_share, 0) = $10
           AND COALESCE(bsi_share, 0) = $11 AND COALESCE(sub_agent_override, 0) = $12`,
        [u.id, u.grossCommission, u.after.producerPayable, u.after.theiShare, u.after.bsiShare,
          u.after.subAgentOverride, u.splitApplies, u.mga,
          u.before.producerPayable, u.before.theiShare, u.before.bsiShare, u.before.subAgentOverride]
      );
      applied += q.rowCount || 0;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { dryRun: false, applied, ...plan };
}

module.exports = {
  GUARD_NOTE,
  planBsiHouseSplitBackfill,
  runBsiHouseSplitBackfill,
  isNewlyMatchedMarco,
  stripGuardNote,
};

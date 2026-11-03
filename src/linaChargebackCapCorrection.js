'use strict';

/**
 * Idempotent rewrite of stored Lina chargebacks so her take-back never exceeds
 * what she was actually paid on that policy. House gets the rest 50/50 when the
 * original has no THEI/BSI share.
 *
 * Why #112 planned 0: the unsplit original on the 100% Lina UHC chargeback has
 * commission equal to the chargeback. Treating that as paid recreates 100% Lina,
 * so the planner saw "already the same" and skipped. That commission is a short
 * first-year installment; the house override on it is one month of the annual
 * Initial rate (e.g. $150/12 = $12.50), so Lina's actual pay is line − monthly
 * override — not the full line.
 *
 * This pass:
 *   1. Prefers stored producer pay when it exists (Humana-style prorate stays).
 *   2. Reconstructs short-installment pay when the stored split is 100% Lina
 *      and unsplit/house-capped originals would otherwise keep 100%.
 *   3. Logs one skip line per policy (carrier, last-4, amounts, reason).
 *      No client names.
 *
 * Scoped to one payment period (default 202610). Does not delete rows. Does not
 * change Integrity / Swan / Marco split rules.
 */

const { extractMemberState, buildAlbaRateInput } = require('./bsiBookAttribution');
const { calculateAlbaOverrideSplit } = require('./overrideRateEngine');
const {
  linaPolicyKey,
  isLinaOriginal,
  isLinaChargeback,
  isUnsplitShares,
  isHouseOnlySplit,
  addLinaOriginal,
  linaProportionalChargeback,
} = require('./linaChargebackProrate');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const close = (a, b) => Math.abs(round2(a) - round2(b)) < 0.015;

const STALE_NOTES = [
  /^Chargeback override prorated/,
  /^Alba rate review/,
  /^Lina chargeback taken back in proportion/,
  /^Lina take-back capped at actual prior pay/,
];

function capNote(orig) {
  const paid = round2(Math.max(0, num(orig && orig.producer)));
  return `Lina take-back capped at actual prior pay on this policy ($${paid.toFixed(2)})`;
}

function mergeNote(mga, orig) {
  const kept = String(mga || '')
    .split(' | ')
    .filter((p) => p && !STALE_NOTES.some((re) => re.test(p)));
  kept.push(capNote(orig));
  return kept.join(' | ');
}

function parseRaw(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function policyLast4(policy) {
  const s = String(policy || '').replace(/\D/g, '');
  if (s.length >= 4) return s.slice(-4);
  const t = String(policy || '').trim();
  return t ? t.slice(-4) : 'none';
}

function normalizePolicy(p) {
  let s = String(p == null ? '' : p).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/\.0+$/, '');
  const digits = s.replace(/\D/g, '');
  return digits.length >= 6 ? digits : s;
}

function toRecord(row) {
  const raw = parseRaw(row.raw_data != null ? row.raw_data : row.raw);
  return {
    id: row.id,
    agent: row.agent_name || row.agent,
    agent_name: row.agent_name || row.agent,
    carrier: row.carrier,
    classification: row.classification,
    commission: num(row.commission),
    policyNumber: row.policy_number || row.policyNumber,
    policy_number: row.policy_number || row.policyNumber,
    period: row.payment_period || row.period,
    producerPayable: row.producer_payable != null ? num(row.producer_payable) : num(row.producerPayable),
    producer_payable: row.producer_payable != null ? num(row.producer_payable) : num(row.producerPayable),
    theiShare: row.thei_share != null ? num(row.thei_share) : num(row.theiShare),
    thei_share: row.thei_share != null ? num(row.thei_share) : num(row.theiShare),
    bsiShare: row.bsi_share != null ? num(row.bsi_share) : num(row.bsiShare),
    bsi_share: row.bsi_share != null ? num(row.bsi_share) : num(row.bsiShare),
    mga: row.mga || '',
    source: row.source,
    effectiveDate: row.effective_date || row.effectiveDate || raw['Original Effective Date'] || '',
    memberState: row.member_state || row.memberState || extractMemberState({ raw }),
    raw,
  };
}

function origKey(r) {
  const k = linaPolicyKey(r);
  if (k) return k;
  const pol = normalizePolicy(r.policyNumber || r.policy_number);
  return pol ? `norm|${pol}` : '';
}

/** Unsplit positives count as paid = commission only when that is smaller than the CB. */
function addUnsplitAsPaid(map, r, cbAbs) {
  if (!isLinaOriginal(r) || isHouseOnlySplit(r) || !isUnsplitShares(r)) return;
  const key = origKey(r);
  if (!key) return;
  const existing = map.get(key);
  if (existing && num(existing.producer) > 0.005) return;
  const commission = num(r.commission);
  if (!(commission > 0.005)) return;
  // Same-size unsplit as the chargeback is the #110 invented 100% original — not
  // actual Lina pay. Reconstruction handles that case.
  if (cbAbs > 0.005 && Math.abs(commission - cbAbs) < 0.02) return;
  const o = existing || { gross: 0, producer: 0, thei: 0, bsi: 0 };
  o.gross = round2(o.gross + commission);
  o.producer = round2(o.producer + commission);
  map.set(key, o);
}

function buildCapOriginals(rows, cbAbsByPolicy) {
  const map = new Map();
  for (const row of rows || []) {
    const rec = toRecord(row);
    addLinaOriginal(map, rec);
    const abs = cbAbsByPolicy ? cbAbsByPolicy.get(normalizePolicy(rec.policyNumber)) : 0;
    addUnsplitAsPaid(map, rec, abs || 0);
  }
  return map;
}

/**
 * Short first-year UHC installment: Comp Type R + New is Initial. The rate-table
 * annual override (CT/National $150) is larger than the installment, so a peel
 * caps house at the line and reports Lina $0. peel.totalOverride is that cap,
 * not the annual rate — using it made reconstruction return null (#112 follow-up).
 *
 * Actual pay on the installment is the line minus one month of the annual rate
 * ($150/12 = $12.50). Chargeback action is rewritten to New so Comp Type R is
 * treated as first-year, not Renewal.
 */
function reconstructShortInstallmentPay(cb) {
  const abs = round2(Math.abs(num(cb.commission)));
  if (!(abs > 0.005)) return null;
  const sale = {
    carrier: cb.carrier,
    classification: 'New Business',
    commission: abs,
    policyNumber: cb.policyNumber,
    period: cb.period,
    effectiveDate: cb.effectiveDate,
    memberState: cb.memberState,
    raw: Object.assign({}, cb.raw || {}, { 'Commission Action': 'New' }),
  };
  const split = calculateAlbaOverrideSplit(buildAlbaRateInput(sale, abs));
  if (!split || split.needsReview || split.nonCommissionable) return null;
  const annual = num(split.totalOverride);
  if (!(annual > abs + 0.005)) return null;
  const monthly = round2(annual / 12);
  const producer = round2(abs - Math.min(abs, monthly));
  if (!(producer > 0.005)) return null;
  return { gross: abs, producer, thei: 0, bsi: 0 };
}

function isFullLinaStored(r) {
  const houseAbs = Math.abs(num(r.theiShare)) + Math.abs(num(r.bsiShare));
  const abs = Math.abs(num(r.commission));
  return houseAbs < 0.005 && Math.abs(Math.abs(num(r.producerPayable)) - abs) < 0.02;
}

/** Paid is missing, or it is the same-size line (#112 invented 100% original). */
function paidIsLineOrMissing(paid, commission) {
  const abs = Math.abs(num(commission));
  return paid < 0.005 || Math.abs(paid - abs) < 0.02;
}

function findOrig(map, r) {
  const k = linaPolicyKey(r);
  if (k && map.has(k)) return map.get(k);
  const norm = normalizePolicy(r.policyNumber);
  if (norm) {
    for (const [key, o] of map) {
      if (normalizePolicy(key.split('|').slice(1).join('|')) === norm) return o;
    }
  }
  return null;
}

function skipEntry(r, reason, extra) {
  return Object.assign({
    carrier: String(r.carrier || '').replace(/[^a-zA-Z]/g, '').slice(0, 12) || 'unknown',
    policyLast4: policyLast4(r.policyNumber),
    commission: round2(r.commission),
    stored: round2(r.producerPayable),
    paid: 0,
    reason,
  }, extra || {});
}

function planLinaChargebackCapCorrection(chargebacks, originals) {
  const map = originals instanceof Map ? originals : new Map();
  const updates = [];
  const skipped = [];
  for (const raw of chargebacks || []) {
    const r = toRecord(raw);
    if (!isLinaChargeback(r)) {
      skipped.push(skipEntry(r, 'not_lina_cb'));
      continue;
    }
    const houseAbs = Math.abs(r.theiShare) + Math.abs(r.bsiShare);
    let orig = findOrig(map, r);
    let paid = Math.max(0, num(orig && orig.producer));
    // Stored 100% Lina + paid missing or equal to the chargeback: the unsplit
    // original is the same installment (#112 then planned 0 as "already the
    // same"). Reconstruct short-installment pay from Comp Type / state / dates.
    if (isFullLinaStored(r) && paidIsLineOrMissing(paid, r.commission)) {
      const rebuilt = reconstructShortInstallmentPay(r);
      if (rebuilt) {
        orig = rebuilt;
        paid = rebuilt.producer;
      } else {
        skipped.push(skipEntry(r, 'reconstruct_failed', { paid }));
        continue;
      }
    }
    const split = linaProportionalChargeback(r.commission, orig);
    if (!split) {
      skipped.push(skipEntry(r, orig ? 'no_paid' : 'no_original', { paid }));
      continue;
    }
    if (paid > 0.005 && r.producerPayable + 0.015 >= -paid && houseAbs > 0.005) {
      skipped.push(skipEntry(r, 'within_cap_house', { paid }));
      continue;
    }
    if (close(split.producerPayable, r.producerPayable)
      && close(split.theiShare, r.theiShare)
      && close(split.bsiShare, r.bsiShare)) {
      skipped.push(skipEntry(r, 'already_capped', { paid }));
      continue;
    }
    updates.push({
      id: r.id,
      policy: r.policyNumber,
      period: r.period,
      commission: r.commission,
      before: {
        producer: round2(r.producerPayable),
        thei: round2(r.theiShare),
        bsi: round2(r.bsiShare),
      },
      after: {
        producer: split.producerPayable,
        thei: split.theiShare,
        bsi: split.bsiShare,
      },
      mga: mergeNote(r.mga, orig),
    });
  }
  return { updates, skipped };
}

function logSkipped(skipped) {
  for (const s of skipped || []) {
    console.log(
      `[lina-cb-cap] skip carrier=${s.carrier} policy=…${s.policyLast4}`
      + ` comm=${Number(s.commission).toFixed(2)} stored=${Number(s.stored).toFixed(2)}`
      + ` paid=${Number(s.paid).toFixed(2)} reason=${s.reason}`
    );
  }
}

async function applyLinaChargebackCapCorrection(pool, opts = {}) {
  const period = /^\d{6}$/.test(String(opts.period || '')) ? String(opts.period) : '202610';
  const empty = { period, found: 0, planned: 0, applied: 0, updates: [], skipped: [] };
  const cbs = await pool.query(
    `SELECT cr.id, cr.agent_name, cr.carrier, cr.classification, cr.commission,
            cr.producer_payable, cr.thei_share, cr.bsi_share, cr.policy_number,
            cr.payment_period, cr.mga, cr.source, cr.effective_date, cr.raw_data
     FROM commission_records cr
     LEFT JOIN uploads u ON u.id = cr.upload_id
     WHERE (cr.upload_id IS NULL OR u.id IS NOT NULL)
       AND UPPER(COALESCE(cr.source, '')) IN ('BSI', 'BSI_PAYEE')
       AND cr.payment_period = $1
       AND COALESCE(cr.commission, 0) < -0.005
       AND cr.agent_name ILIKE '%hernandez%'`,
    [period]
  );
  if (!cbs.rows.length) return empty;
  const policies = [...new Set(cbs.rows.flatMap((row) => {
    const rawPol = String(row.policy_number || '').trim().toLowerCase();
    const norm = normalizePolicy(row.policy_number);
    return [rawPol, norm].filter(Boolean);
  }))];
  const cbAbsByPolicy = new Map();
  for (const row of cbs.rows) {
    const k = normalizePolicy(row.policy_number);
    if (k) cbAbsByPolicy.set(k, round2(Math.abs(num(row.commission))));
  }
  let positives = [];
  if (policies.length) {
    const extra = await pool.query(
      `SELECT cr.agent_name, cr.carrier, cr.policy_number, cr.classification, cr.commission,
              cr.producer_payable, cr.thei_share, cr.bsi_share, cr.effective_date, cr.raw_data
       FROM commission_records cr
       LEFT JOIN uploads u ON u.id = cr.upload_id
       WHERE (cr.upload_id IS NULL OR u.id IS NOT NULL)
         AND UPPER(COALESCE(cr.source, '')) IN ('BSI', 'BSI_PAYEE')
         AND COALESCE(cr.commission, 0) > 0.005
         AND (
           LOWER(TRIM(COALESCE(cr.policy_number, ''))) = ANY($1::text[])
           OR regexp_replace(LOWER(TRIM(COALESCE(cr.policy_number, ''))), '[^0-9]', '', 'g')
              = ANY($1::text[])
         )
         AND (
           cr.agent_name ILIKE '%hernandez%'
           OR cr.agent_name ILIKE '%broker society%'
           OR LOWER(TRIM(COALESCE(cr.agent_name, ''))) IN ('', 'bsi', 'bsi agent')
         )`,
      [policies]
    );
    positives = extra.rows;
  }
  const { updates, skipped } = planLinaChargebackCapCorrection(
    cbs.rows,
    buildCapOriginals(positives, cbAbsByPolicy)
  );
  logSkipped(skipped);
  let applied = 0;
  for (const u of updates) {
    const q = await pool.query(
      `UPDATE commission_records
       SET producer_payable = $1, thei_share = $2, bsi_share = $3, mga = $4
       WHERE id = $5 AND payment_period = $6
         AND COALESCE(producer_payable, 0) = $7
         AND COALESCE(thei_share, 0) = $8
         AND COALESCE(bsi_share, 0) = $9`,
      [u.after.producer, u.after.thei, u.after.bsi, u.mga, u.id, period,
        u.before.producer, u.before.thei, u.before.bsi]
    );
    applied += q.rowCount || 0;
  }
  return { period, found: cbs.rows.length, planned: updates.length, applied, updates, skipped };
}

module.exports = {
  buildCapOriginals,
  addUnsplitAsPaid,
  reconstructShortInstallmentPay,
  planLinaChargebackCapCorrection,
  applyLinaChargebackCapCorrection,
  logSkipped,
  capNote,
  policyLast4,
  normalizePolicy,
};

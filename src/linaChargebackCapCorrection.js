'use strict';

/**
 * Idempotent rewrite of stored Lina chargebacks so her take-back never exceeds
 * what she was actually paid on that policy. House gets the rest 50/50 when the
 * original has no THEI/BSI share.
 *
 * Why a separate pass: lina_cb_prorate uses addLinaOriginal, which skips unsplit
 * rows (so it will not invent producer = commission). After #110 wrote a 100%
 * Lina split from that invented original, the next deploy finds no usable
 * original and plans 0 — the stored 100% row stays. This pass recovers unpaid
 * unsplit positives as "she was paid the line" only when no stored producer
 * exists, then applies the paid cap.
 *
 * Scoped to one payment period (default 202610). Does not delete rows. Does not
 * change Integrity / Swan / Marco split rules.
 */

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

function toRecord(row) {
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
  };
}

/** Unsplit Lina/house-named positives count as paid = commission when no stored producer exists. */
function addUnsplitAsPaid(map, r) {
  if (!isLinaOriginal(r) || isHouseOnlySplit(r) || !isUnsplitShares(r)) return;
  const key = linaPolicyKey(r);
  if (!key) return;
  const existing = map.get(key);
  if (existing && num(existing.producer) > 0.005) return;
  const commission = num(r.commission);
  if (!(commission > 0.005)) return;
  const o = existing || { gross: 0, producer: 0, thei: 0, bsi: 0 };
  o.gross = round2(o.gross + commission);
  o.producer = round2(o.producer + commission);
  map.set(key, o);
}

/** Stored producer first; unsplit line amount only when that policy has no stored pay. */
function buildCapOriginals(rows) {
  const map = new Map();
  for (const row of rows || []) addLinaOriginal(map, toRecord(row));
  for (const row of rows || []) addUnsplitAsPaid(map, toRecord(row));
  return map;
}

function planLinaChargebackCapCorrection(chargebacks, originals) {
  const map = originals instanceof Map ? originals : new Map();
  const updates = [];
  for (const raw of chargebacks || []) {
    const r = toRecord(raw);
    if (!isLinaChargeback(r)) continue;
    const orig = map.get(linaPolicyKey(r));
    const split = linaProportionalChargeback(r.commission, orig);
    if (!split) continue;
    const paid = Math.max(0, num(orig && orig.producer));
    const houseAbs = Math.abs(r.theiShare) + Math.abs(r.bsiShare);
    // Already within the paid cap and the house already has a share (Humana-style
    // prorate). Leave it. 100% Lina rows still go through the cap rewrite.
    if (paid > 0.005 && r.producerPayable + 0.015 >= -paid && houseAbs > 0.005) continue;
    const same = close(split.producerPayable, r.producerPayable)
      && close(split.theiShare, r.theiShare)
      && close(split.bsiShare, r.bsiShare);
    if (same) continue;
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
  return { updates };
}

async function applyLinaChargebackCapCorrection(pool, opts = {}) {
  const period = /^\d{6}$/.test(String(opts.period || '')) ? String(opts.period) : '202610';
  const empty = { period, found: 0, planned: 0, applied: 0, updates: [] };
  const cbs = await pool.query(
    `SELECT cr.id, cr.agent_name, cr.carrier, cr.classification, cr.commission,
            cr.producer_payable, cr.thei_share, cr.bsi_share, cr.policy_number,
            cr.payment_period, cr.mga, cr.source
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
  const policies = [...new Set(
    cbs.rows.map((row) => String(row.policy_number || '').trim().toLowerCase()).filter(Boolean)
  )];
  let positives = [];
  if (policies.length) {
    const extra = await pool.query(
      `SELECT cr.agent_name, cr.carrier, cr.policy_number, cr.classification, cr.commission,
              cr.producer_payable, cr.thei_share, cr.bsi_share
       FROM commission_records cr
       LEFT JOIN uploads u ON u.id = cr.upload_id
       WHERE (cr.upload_id IS NULL OR u.id IS NOT NULL)
         AND UPPER(COALESCE(cr.source, '')) IN ('BSI', 'BSI_PAYEE')
         AND COALESCE(cr.commission, 0) > 0.005
         AND LOWER(TRIM(COALESCE(cr.policy_number, ''))) = ANY($1::text[])
         AND (
           cr.agent_name ILIKE '%hernandez%'
           OR (
             (cr.agent_name ILIKE '%broker society%'
              OR LOWER(TRIM(COALESCE(cr.agent_name, ''))) IN ('', 'bsi', 'bsi agent'))
             AND (LOWER(cr.carrier) LIKE '%united%' OR LOWER(TRIM(cr.carrier)) = 'uhc')
           )
         )`,
      [policies]
    );
    positives = extra.rows;
  }
  const { updates } = planLinaChargebackCapCorrection(cbs.rows, buildCapOriginals(positives));
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
  return { period, found: cbs.rows.length, planned: updates.length, applied, updates };
}

module.exports = {
  buildCapOriginals,
  addUnsplitAsPaid,
  planLinaChargebackCapCorrection,
  applyLinaChargebackCapCorrection,
  capNote,
};

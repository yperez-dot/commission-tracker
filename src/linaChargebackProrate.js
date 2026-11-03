'use strict';

/**
 * Lina (Alba Hernandez on BSI files) chargebacks are taken back in proportion to how the
 * original payment(s) on the policy were split:
 *   Lina      = chargeback × (Lina's cumulative producer payable / cumulative gross paid)
 *   remainder = chargeback − Lina, split THEI/BSI in the same proportion as the original
 *               THEI/BSI shares (50/50 when the originals carry no THEI/BSI share)
 * Originals = positive Lina lines on the same carrier + policy across all BSI uploads
 * (HRA / bonus / fee / held / override lines excluded). No original found → the caller keeps
 * its existing chargeback logic.
 */

const { isAlbaHernandez } = require('./payeeSchedules');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);

function carrierKey(carrier) {
  const c = String(carrier || '').trim().toLowerCase();
  if (c.includes('omaha')) return 'unitedofomaha';
  if (c.includes('united') || c === 'uhc') return 'uhc';
  for (const k of ['aetna', 'humana', 'devoted', 'optimum', 'freedom', 'doctors', 'solis', 'healthsun']) {
    if (c.includes(k)) return k;
  }
  if (c.includes('healthspring') || c.includes('cigna')) return 'healthspring';
  if (c.includes('elevance') || c.includes('anthem')) return 'elevance';
  return c.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** carrier|policy key, or '' without a policy number. */
function linaPolicyKey(r) {
  const policy = String((r.policyNumber != null ? r.policyNumber : r.policy_number) || '').trim().toLowerCase();
  return policy ? `${carrierKey(r.carrier)}|${policy}` : '';
}

function isExcludedClass(classification) {
  const c = String(classification || '').toLowerCase();
  return c.includes('hra') || c.includes('bonus') || c.includes('fee') || c.includes('held') || c.includes('override');
}

/** House writing-agent label on BSI UHC book lines (never remapped on early 2026 uploads). */
function isHouseNamedAgent(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return true;
  return n.includes('broker society') || n === 'bsi' || n === 'bsi agent'
    || n === 'broker society insurance / level up insurance';
}

function sharesOf(r) {
  return {
    producer: num(r.producerPayable != null ? r.producerPayable : r.producer_payable),
    thei: num(r.theiShare != null ? r.theiShare : r.thei_share),
    bsi: num(r.bsiShare != null ? r.bsiShare : r.bsi_share),
  };
}

/** Producer and house shares all ~0 — the peel was never stored. */
function isUnsplitShares(r) {
  const s = sharesOf(r);
  return Math.abs(s.producer) < 0.005 && Math.abs(s.thei) < 0.005 && Math.abs(s.bsi) < 0.005;
}

/** House took the whole line (producer ~0, THEI+BSI ≈ commission). Not a Lina original. */
function isHouseOnlySplit(r) {
  if (isUnsplitShares(r)) return false;
  const s = sharesOf(r);
  const commission = num(r.commission);
  return Math.abs(s.producer) < 0.005
    && Math.abs(Math.abs(s.thei + s.bsi) - Math.abs(commission)) < 0.02;
}

/** A stored row whose upload was deleted (LEFT JOIN left u.id null). */
function isOrphanCommissionRow(r) {
  const uploadId = r.upload_id != null ? r.upload_id : r.uploadId;
  if (uploadId == null || uploadId === '') return false;
  if (r.upload_missing === true || r.live_upload === false) return true;
  if (r.upload_exists === false || r.upload_exists === 0) return true;
  return false;
}

const LIVE_UPLOAD_SQL = '(cr.upload_id IS NULL OR u.id IS NOT NULL)';

/** Lina line that counts as an original payment (positive, not HRA etc.). */
function isLinaOriginal(r) {
  if (isOrphanCommissionRow(r)) return false;
  const amount = num(r.commission);
  if (!(amount > 0.005) || isExcludedClass(r.classification)) return false;
  const agent = r.agent != null ? r.agent : r.agent_name;
  if (isAlbaHernandez(agent)) return true;
  return isHouseNamedAgent(agent) && carrierKey(r.carrier) === 'uhc';
}

/** Lina line to re-split in proportion (negative, not HRA etc.). */
function isLinaChargeback(r) {
  const agent = r.agent != null ? r.agent : r.agent_name;
  return isAlbaHernandez(agent) && num(r.commission) < -0.005 && !isExcludedClass(r.classification);
}

/** Add a positive Lina line to the originals map (key → { gross, producer, thei, bsi }). */
function addLinaOriginal(map, r) {
  // Unsplit rows have no stored Lina pay — do not invent producer = commission
  // (that made a UHC chargeback take back 100% from Lina). House-only peels
  // and leftover Lina < 0 peels are not "what she was paid" either.
  if (!isLinaOriginal(r) || isHouseOnlySplit(r) || isUnsplitShares(r)) return;
  const key = linaPolicyKey(r);
  if (!key) return;
  const s = sharesOf(r);
  if (s.producer < -0.005) return;
  const o = map.get(key) || { gross: 0, producer: 0, thei: 0, bsi: 0 };
  o.gross = round2(o.gross + num(r.commission));
  o.producer = round2(o.producer + s.producer);
  o.thei = round2(o.thei + s.thei);
  o.bsi = round2(o.bsi + s.bsi);
  map.set(key, o);
}

/**
 * Proportional split of a (negative) chargeback against the originals, or null when there is
 * no usable original (caller keeps its current logic).
 */
function linaProportionalChargeback(commission, orig) {
  const cb = num(commission);
  const paid = Math.max(0, num(orig && orig.producer));
  if (!(cb < 0) || !orig || !(orig.gross > 0) || !(paid > 0.005)) return null;
  const linaFrac = Math.max(0, Math.min(1, paid / orig.gross));
  let producerPayable = round2(cb * linaFrac);
  // Never take back more than Lina was actually paid on this policy.
  if (producerPayable < -paid) producerPayable = round2(-paid);
  const rest = round2(cb - producerPayable);
  const houseTotal = num(orig.thei) + num(orig.bsi);
  const theiFrac = Math.abs(houseTotal) > 0.005 ? Math.max(0, Math.min(1, num(orig.thei) / houseTotal)) : 0.5;
  const bsiShare = round2(rest * (1 - theiFrac));
  const theiShare = round2(rest - bsiShare);
  return { producerPayable, theiShare, bsiShare, linaFrac, theiFrac };
}

function proportionalNote(orig) {
  const pct = (orig.producer / orig.gross) * 100;
  return `Lina chargeback taken back in proportion to the original payment(s) on this policy (${pct.toFixed(1)}% Lina)`;
}

/** Stored originals for the carrier+policy keys of Lina chargebacks (all BSI uploads). */
async function loadLinaOriginalSales(pool, policyNumbers) {
  const map = new Map();
  const list = [...new Set((policyNumbers || []).map((p) => String(p || '').trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return map;
  const r = await pool.query(
    `SELECT cr.agent_name, cr.carrier, cr.policy_number, cr.classification, cr.commission,
            cr.producer_payable, cr.thei_share, cr.bsi_share
     FROM commission_records cr
     LEFT JOIN uploads u ON u.id = cr.upload_id
     WHERE (UPPER(COALESCE(cr.source, '')) IN ('BSI', 'BSI_PAYEE') OR u.category = 'bsi_statement')
       AND ${LIVE_UPLOAD_SQL}
       AND COALESCE(cr.commission, 0) > 0
       AND (
         cr.agent_name ILIKE '%hernandez%'
         OR (
           (cr.agent_name ILIKE '%broker society%'
            OR LOWER(TRIM(COALESCE(cr.agent_name, ''))) IN ('', 'bsi', 'bsi agent'))
           AND (LOWER(cr.carrier) LIKE '%united%' OR LOWER(TRIM(cr.carrier)) = 'uhc')
         )
       )
       AND LOWER(TRIM(COALESCE(cr.policy_number, ''))) = ANY($1::text[])`,
    [list]
  );
  for (const row of r.rows) addLinaOriginal(map, row);
  return map;
}

module.exports = {
  linaPolicyKey,
  isLinaOriginal,
  isLinaChargeback,
  isHouseNamedAgent,
  isUnsplitShares,
  isHouseOnlySplit,
  isOrphanCommissionRow,
  LIVE_UPLOAD_SQL,
  addLinaOriginal,
  linaProportionalChargeback,
  proportionalNote,
  loadLinaOriginalSales,
};

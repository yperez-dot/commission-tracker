'use strict';

/**
 * Re-peel stored Lina UHC Initial positives after leftover / orphan priors are gone.
 * Idempotent. Scoped to one payment period (default 202610).
 */

const { peelAlbaProduction, extractMemberState } = require('./bsiBookAttribution');
const {
  linaPolicyKey,
  isLinaOriginal,
  addLinaOriginal,
  loadLinaOriginalSales,
} = require('./linaChargebackProrate');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const close = (a, b) => Math.abs(round2(a) - round2(b)) < 0.015;

function parseRaw(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function toRecord(row) {
  const raw = parseRaw(row.raw_data != null ? row.raw_data : row.raw);
  return {
    id: row.id,
    agent: row.agent_name || row.agent,
    carrier: row.carrier,
    classification: row.classification,
    commission: Number(row.commission) || 0,
    policyNumber: row.policy_number || row.policyNumber,
    period: row.payment_period || row.period,
    effectiveDate: row.effective_date || row.effectiveDate,
    statementDate: row.statement_date || raw['Statement Date'] || '',
    raw,
    memberState: row.member_state || extractMemberState({ raw, memberState: row.member_state }),
    producerPayable: row.producer_payable != null ? row.producer_payable : row.producerPayable,
    theiShare: row.thei_share != null ? row.thei_share : row.theiShare,
    bsiShare: row.bsi_share != null ? row.bsi_share : row.bsiShare,
    mga: row.mga || '',
  };
}

function planLinaRemainingOverrideCorrection(rows, originals) {
  const map = new Map();
  if (originals instanceof Map) {
    for (const [k, v] of originals) map.set(k, { ...v });
  }
  const updates = [];
  const recs = (rows || []).map(toRecord).filter((r) => r.commission > 0.005 && isLinaOriginal(r));
  recs.sort((a, b) => String(a.period || '').localeCompare(String(b.period || '')) || (a.id || 0) - (b.id || 0));
  for (const r of recs) {
    const peel = peelAlbaProduction(r, r.commission, { prior: map.get(linaPolicyKey(r)) || null });
    if (!peel.ok) continue;
    const same = close(peel.producerPayable, r.producerPayable)
      && close(peel.theiShare, r.theiShare)
      && close(peel.bsiShare, r.bsiShare);
    if (same) {
      addLinaOriginal(map, {
        ...r,
        producerPayable: peel.producerPayable,
        theiShare: peel.theiShare,
        bsiShare: peel.bsiShare,
      });
      continue;
    }
    updates.push({
      id: r.id,
      policy: r.policyNumber,
      period: r.period,
      before: {
        producer: round2(r.producerPayable),
        thei: round2(r.theiShare),
        bsi: round2(r.bsiShare),
      },
      after: {
        producer: peel.producerPayable,
        thei: peel.theiShare,
        bsi: peel.bsiShare,
      },
      mga: peel.splitSaleNote || r.mga,
    });
    addLinaOriginal(map, {
      ...r,
      producerPayable: peel.producerPayable,
      theiShare: peel.theiShare,
      bsiShare: peel.bsiShare,
    });
  }
  return { updates };
}

async function applyLinaRemainingOverrideCorrection(pool, opts = {}) {
  const period = /^\d{6}$/.test(String(opts.period || '')) ? String(opts.period) : '202610';
  const r = await pool.query(
    `SELECT cr.id, cr.agent_name, cr.carrier, cr.classification, cr.commission,
            cr.producer_payable, cr.thei_share, cr.bsi_share, cr.policy_number,
            cr.payment_period, cr.effective_date, cr.raw_data, cr.mga, cr.source
     FROM commission_records cr
     LEFT JOIN uploads u ON u.id = cr.upload_id
     WHERE (cr.upload_id IS NULL OR u.id IS NOT NULL)
       AND UPPER(COALESCE(cr.source, '')) IN ('BSI', 'BSI_PAYEE')
       AND cr.payment_period = $1
       AND COALESCE(cr.commission, 0) > 0
       AND (cr.agent_name ILIKE '%hernandez%' OR cr.agent_name ILIKE '%broker society%')
       AND (LOWER(cr.carrier) LIKE '%united%' OR LOWER(TRIM(cr.carrier)) = 'uhc')`,
    [period]
  );
  const originals = await loadLinaOriginalSales(
    pool,
    r.rows.map((row) => row.policy_number)
  );
  // Stored positives in this period are themselves in originals; peel against
  // earlier periods only so this month is re-applied in file order.
  for (const row of r.rows) {
    const rec = toRecord(row);
    const key = linaPolicyKey(rec);
    const o = originals.get(key);
    if (!o) continue;
    o.gross = round2(o.gross - (Number(row.commission) || 0));
    o.producer = round2(o.producer - (Number(row.producer_payable) || 0));
    o.thei = round2(o.thei - (Number(row.thei_share) || 0));
    o.bsi = round2(o.bsi - (Number(row.bsi_share) || 0));
    if (o.gross < 0.005) originals.delete(key);
    else originals.set(key, o);
  }
  const { updates } = planLinaRemainingOverrideCorrection(r.rows, originals);
  let applied = 0;
  for (const u of updates) {
    await pool.query(
      `UPDATE commission_records
       SET producer_payable = $1, thei_share = $2, bsi_share = $3
       WHERE id = $4 AND payment_period = $5`,
      [u.after.producer, u.after.thei, u.after.bsi, u.id, period]
    );
    applied += 1;
  }
  return { period, found: r.rows.length, planned: updates.length, applied };
}

module.exports = {
  planLinaRemainingOverrideCorrection,
  applyLinaRemainingOverrideCorrection,
  toRecord,
};

'use strict';

/**
 * Remittance chargeback audit — catch BSI double/over clawbacks on THEI remittance.
 *
 * OliComm must not invent chargebacks; it should also not silently accept a
 * remittance clawback when THEI's prior remittance net for that member is
 * already $0 (or the new CB exceeds remaining net).
 */

const { clientCarrierKey, normPeriod } = require('./missingRenewalsLogic');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isRemittanceUploadName(filename) {
  const f = String(filename || '').toLowerCase().replace(/\s+/g, '_');
  return (
    f.includes('thei_statement_bsi') ||
    /t\.?h\.?e[_\-.]*statement/.test(f) ||
    f.includes('the_statements') ||
    (f.includes('medicare_statement') && f.includes('the')) ||
    (f.includes('medicare statement') && f.includes('the'))
  );
}

function isLikelyTheRemittanceUploadName(filename) {
  return isRemittanceUploadName(filename);
}

/** History rows that represent BSI→THEI remittance money (credits or clawbacks). */
function isRemittanceHistoryRow(row) {
  const cls = String(row.classification || '').toLowerCase();
  if (cls.includes('agency override')) return true;
  if (!cls.includes('chargeback')) return false;
  const upload = row.upload_original_name || row.original_name || '';
  // Unit tests may omit upload name — treat Chargeback as remittance history then
  if (!upload) return true;
  return isRemittanceUploadName(upload);
}

/**
 * @param {object} opts
 * @param {Array} opts.chargebacks - negative commission rows to validate
 * @param {Array} opts.history - prior remittance/override rows (positives + prior CBs)
 * @returns {{ ok: Array, problems: Array, summary: object }}
 */
function auditRemittanceChargebacks({ chargebacks = [], history = [] }) {
  const byKey = new Map();
  for (const r of history) {
    if (!isRemittanceHistoryRow(r)) continue;
    const name = r.client_full_name || r.client;
    const key = clientCarrierKey(name, r.carrier);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({
      id: r.id,
      name,
      carrier: r.carrier,
      amt: parseFloat(r.commission) || 0,
      period: normPeriod(r.payment_period || r.period) || '',
      classification: r.classification,
      upload: r.upload_original_name || r.original_name || '',
    });
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => String(a.period).localeCompare(String(b.period)) || (a.id || 0) - (b.id || 0));
  }

  const ok = [];
  const problems = [];

  for (const cb of chargebacks) {
    const amt = parseFloat(cb.commission);
    if (!(amt < 0)) continue;
    const name = cb.client_full_name || cb.client;
    const key = clientCarrierKey(name, cb.carrier);
    const period = normPeriod(cb.payment_period || cb.period) || '';
    const hist = (byKey.get(key) || []).filter((h) => h.id == null || cb.id == null || h.id !== cb.id);

    const priorPos = hist.filter((h) => {
      if (h.amt <= 0) return false;
      if (!period) return true;
      if (h.period < period) return true;
      if (h.period === period && (h.id || 0) < (cb.id || Infinity)) return true;
      return false;
    });
    const priorNeg = hist.filter((h) => {
      if (h.amt >= 0) return false;
      if (!period) return true;
      if (h.period < period) return true;
      if (h.period === period && (h.id || 0) < (cb.id || Infinity)) return true;
      return false;
    });

    const priorPosSum = round2(priorPos.reduce((s, h) => s + h.amt, 0));
    const priorNegSum = round2(priorNeg.reduce((s, h) => s + h.amt, 0));
    const priorNet = round2(priorPosSum + priorNegSum);

    let status = 'OK';
    let note = '';
    if (priorPosSum < 0.01) {
      status = 'NO_PRIOR_PAYMENT';
      note = 'Chargeback with no prior positive THEI remittance/override found';
    } else if (priorNet + amt < -0.5) {
      status = 'DOUBLE_OR_OVER_CB';
      note = `CB ${amt.toFixed(2)} exceeds remaining prior remittance net ${priorNet.toFixed(2)} (paid ${priorPosSum.toFixed(2)}, already clawed ${priorNegSum.toFixed(2)})`;
    }

    const row = {
      status,
      note,
      client: name,
      carrier: cb.carrier,
      agent: cb.agent_name || cb.agent || '',
      period,
      chargeback: amt,
      priorPosSum,
      priorNegSum,
      priorNet,
      priorPayPeriods: [...new Set(priorPos.map((p) => p.period).filter(Boolean))],
      classification: cb.classification || '',
      upload: cb.upload_original_name || cb.original_name || '',
      identityKey: key,
    };

    if (status === 'OK') ok.push(row);
    else problems.push(row);
  }

  return {
    ok,
    problems,
    summary: {
      chargebacksChecked: ok.length + problems.length,
      ok: ok.length,
      problems: problems.length,
      problemAmount: round2(problems.reduce((s, p) => s + p.chargeback, 0)),
    },
  };
}

/** Load remittance/override history from DB and audit chargebacks on one upload. */
async function auditRemittanceUploadChargebacks(pool, uploadId) {
  const upload = await pool.query(`SELECT id, original_name FROM uploads WHERE id = $1`, [uploadId]);
  if (!upload.rows.length) return null;
  const originalName = upload.rows[0].original_name || '';

  const cbs = await pool.query(
    `SELECT cr.id, cr.client_full_name, cr.carrier, cr.agent_name, cr.commission,
            cr.classification, cr.payment_period, u.original_name AS upload_original_name
     FROM commission_records cr
     JOIN uploads u ON u.id = cr.upload_id
     WHERE cr.upload_id = $1 AND cr.commission < 0`,
    [uploadId]
  );
  if (!cbs.rows.length) {
    return {
      ok: [],
      problems: [],
      summary: { chargebacksChecked: 0, ok: 0, problems: 0, problemAmount: 0 },
      uploadId,
      originalName,
    };
  }

  const hist = await pool.query(
    `SELECT cr.id, cr.client_full_name, cr.carrier, cr.agent_name, cr.commission,
            cr.classification, cr.payment_period, u.original_name AS upload_original_name
     FROM commission_records cr
     JOIN uploads u ON u.id = cr.upload_id
     WHERE (
       LOWER(cr.classification) LIKE '%agency override%'
       OR (
         LOWER(cr.classification) LIKE '%chargeback%'
         AND (
           LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%thei_statement_bsi%'
           OR LOWER(REPLACE(u.original_name, ' ', '_')) LIKE '%t.h.e_statements%'
           OR (
             LOWER(u.original_name) LIKE '%medicare statement%'
             AND LOWER(u.original_name) LIKE '%the%'
           )
         )
       )
     )
     AND cr.upload_id <> $1`,
    [uploadId]
  );

  const sameFilePos = await pool.query(
    `SELECT cr.id, cr.client_full_name, cr.carrier, cr.agent_name, cr.commission,
            cr.classification, cr.payment_period, u.original_name AS upload_original_name
     FROM commission_records cr
     JOIN uploads u ON u.id = cr.upload_id
     WHERE cr.upload_id = $1 AND cr.commission > 0`,
    [uploadId]
  );

  const result = auditRemittanceChargebacks({
    chargebacks: cbs.rows,
    history: [...hist.rows, ...sameFilePos.rows],
  });
  return { ...result, uploadId, originalName };
}

module.exports = {
  auditRemittanceChargebacks,
  auditRemittanceUploadChargebacks,
  isRemittanceHistoryRow,
  isLikelyTheRemittanceUploadName,
  isRemittanceUploadName,
  round2,
};

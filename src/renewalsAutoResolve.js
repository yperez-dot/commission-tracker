'use strict';

const {
  normName,
  normalizeCarrier,
  carriersMatch,
  namesLooseMatch,
} = require('./matchingNormalize');

/**
 * Build a lookup key for chase/pending policy rows vs upload payments.
 */
function renewalMatchKey(client, carrier, agent) {
  return `${normName(client)}|${normalizeCarrier(carrier)}|${normName(agent || '')}`;
}

/**
 * Decide whether an uploaded commission row pays a chased/pending policy.
 * Positive commissions resolve; zeros and chargebacks do not.
 */
function paymentResolvesChase(uploadRow, statusRow) {
  const commission = parseFloat(uploadRow.commission);
  if (!(commission > 0)) return false;
  if (!namesLooseMatch(uploadRow.client_full_name, statusRow.client_full_name)) return false;
  if (!carriersMatch(uploadRow.carrier, statusRow.carrier)) return false;
  // Agent must match when both sides have a name
  const a1 = normName(uploadRow.agent_name);
  const a2 = normName(statusRow.agent_name);
  if (a1 && a2 && !namesLooseMatch(uploadRow.agent_name, statusRow.agent_name)) return false;
  return true;
}

function appendAutoResolveNote(existingNotes, detail) {
  const stamp = `[Auto-resolved] ${detail}`;
  const prev = (existingNotes || '').trim();
  if (!prev) return stamp;
  if (prev.includes(stamp)) return prev;
  return `${prev}\n${stamp}`;
}

/**
 * Clear chase/pending policy_status rows when this upload contains a matching payment.
 *
 * @returns {Promise<{resolved: object[], count: number}>}
 */
async function resolveChasedRenewals(pool, uploadId, resolvedBy = 'system') {
  const open = await pool.query(
    `SELECT id, client_full_name, carrier, agent_name, status, notes
     FROM policy_status
     WHERE status IN ('chase', 'pending')`
  );

  if (!open.rows.length) {
    return { resolved: [], count: 0 };
  }

  const paid = await pool.query(
    `SELECT id, client_full_name, carrier, agent_name, commission, payment_period, policy_number
     FROM commission_records
     WHERE upload_id = $1
       AND commission IS NOT NULL
       AND commission::numeric > 0`,
    [uploadId]
  );

  if (!paid.rows.length) {
    return { resolved: [], count: 0 };
  }

  const resolved = [];
  const usedStatusIds = new Set();

  for (const statusRow of open.rows) {
    if (usedStatusIds.has(statusRow.id)) continue;
    const match = paid.rows.find((row) => paymentResolvesChase(row, statusRow));
    if (!match) continue;

    const detail =
      `Paid in upload #${uploadId}` +
      (match.payment_period ? ` period ${match.payment_period}` : '') +
      ` · $${parseFloat(match.commission).toFixed(2)}` +
      (match.policy_number ? ` · policy ${match.policy_number}` : '') +
      ` (was ${statusRow.status})`;

    const notes = appendAutoResolveNote(statusRow.notes, detail);

    await pool.query(
      `UPDATE policy_status
       SET status = 'active',
           notes = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [notes, resolvedBy, statusRow.id]
    );

    usedStatusIds.add(statusRow.id);
    resolved.push({
      client: statusRow.client_full_name,
      carrier: statusRow.carrier,
      agent: statusRow.agent_name,
      previousStatus: statusRow.status,
      paymentPeriod: match.payment_period,
      commission: parseFloat(match.commission),
      policyNumber: match.policy_number || null,
      commissionRecordId: match.id,
    });
  }

  return { resolved, count: resolved.length };
}

module.exports = {
  renewalMatchKey,
  paymentResolvesChase,
  appendAutoResolveNote,
  resolveChasedRenewals,
};

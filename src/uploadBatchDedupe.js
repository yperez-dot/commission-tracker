'use strict';

/**
 * Within-batch upload dedupe (Upload 374 class).
 * Collapses exact duplicate lines inside a single parsed file before insert.
 * Key includes commission so pay/chargeback pairs with different amounts are kept.
 */

function batchDedupeKey(r) {
  const client = String(r.client || r.client_full_name || '').trim().toLowerCase();
  const carrier = String(r.carrier || '').trim().toLowerCase();
  const effectiveDate = String(r.effectiveDate || r.effective_date || '').trim();
  const period = String(r.period || r.payment_period || '').trim();
  const classification = String(r.classification || r.type || '').trim().toLowerCase();
  const commission = String(r.commission ?? '');
  const policy = String(r.policyNumber || r.policy_number || '').trim().toLowerCase();
  return `${client}|${carrier}|${effectiveDate}|${period}|${classification}|${commission}|${policy}`;
}

/**
 * List duplicate occurrences after the first (does not mutate input).
 */
function findInternalDuplicates(records) {
  if (!Array.isArray(records) || !records.length) return [];

  const seen = new Map();
  const duplicates = [];

  for (const r of records) {
    const client = r.client || r.client_full_name;
    const carrier = r.carrier;
    const effectiveDate = r.effectiveDate || r.effective_date;
    if (!client || !carrier || !effectiveDate) continue;

    const key = batchDedupeKey(r);
    if (seen.has(key)) {
      const first = seen.get(key);
      duplicates.push({
        client,
        carrier,
        date: effectiveDate,
        amount: r.commission,
        agent: r.agent || r.agent_name,
        period: r.period || r.payment_period,
        type: r.classification,
        policy: r.policyNumber || r.policy_number || null,
        firstAmount: first.commission,
        isDuplicate: true,
      });
    } else {
      seen.set(key, r);
    }
  }

  return duplicates;
}

/**
 * Keep first occurrence of each key; drop later exact duplicates.
 * @returns {{ records: object[], removed: object[], removedCount: number }}
 */
function collapseInternalDuplicates(records) {
  if (!Array.isArray(records) || !records.length) {
    return { records: [], removed: [], removedCount: 0 };
  }

  const seen = new Set();
  const kept = [];
  const removed = [];

  for (const r of records) {
    const client = r.client || r.client_full_name;
    const carrier = r.carrier;
    const effectiveDate = r.effectiveDate || r.effective_date;

    // Incomplete rows cannot form a stable key — keep them (downstream may skip)
    if (!client || !carrier || !effectiveDate) {
      kept.push(r);
      continue;
    }

    const key = batchDedupeKey(r);
    if (seen.has(key)) {
      removed.push({
        client,
        carrier,
        date: effectiveDate,
        amount: r.commission,
        agent: r.agent || r.agent_name,
        period: r.period || r.payment_period,
        type: r.classification,
        policy: r.policyNumber || r.policy_number || null,
      });
      continue;
    }
    seen.add(key);
    kept.push(r);
  }

  return {
    records: kept,
    removed,
    removedCount: removed.length,
  };
}

module.exports = {
  batchDedupeKey,
  findInternalDuplicates,
  collapseInternalDuplicates,
};

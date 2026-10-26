'use strict';

/**
 * Data-driven house-statement payee grouping.
 *
 * A group is { groupKey, statementType?, displayName, members: [match strings] }.
 * Writing-agent / payee labels that match a group's members roll into one
 * statement (one card, one total, one export). Lines keep their writing agent.
 *
 * Groups are loaded from the DB (house_statement_payee_groups) so they can be
 * edited later without a code change. Tests pass placeholder groups.
 */

const { agentNameInList } = require('./agentNameMatch');

function groupForName(groups, name, statementType) {
  const list = groups || [];
  for (let i = 0; i < list.length; i += 1) {
    const g = list[i];
    if (g.statementType && statementType && g.statementType !== statementType) continue;
    if (agentNameInList(name, g.members || [])) return g;
  }
  return null;
}

/**
 * Merge statement buckets so members of the same group become one payee.
 * Unmatched payees stay as they are. Line writing_agent is not rewritten.
 */
function mergePayeeBuckets(statements, groups, statementType) {
  if (!groups || !groups.length) return statements || [];
  const byKey = new Map();
  const leftovers = [];
  (statements || []).forEach((s) => {
    const hit = groupForName(groups, s.payee, statementType)
      || (s.lines || []).map((l) => groupForName(groups, l.writing_agent || l.agent_name, statementType)).find(Boolean);
    if (!hit) {
      leftovers.push({
        ...s,
        lineCount: (s.lines || []).length,
      });
      return;
    }
    if (!byKey.has(hit.groupKey)) {
      byKey.set(hit.groupKey, {
        payee: hit.displayName,
        payeeGroupKey: hit.groupKey,
        total: 0,
        lines: [],
      });
    }
    const bucket = byKey.get(hit.groupKey);
    bucket.total += Number(s.total) || 0;
    bucket.lines = bucket.lines.concat(s.lines || []);
  });
  const merged = [...byKey.values()].map((s) => ({
    ...s,
    total: Math.round(s.total * 100) / 100,
    lineCount: s.lines.length,
  }));
  return merged.concat(leftovers).sort((a, b) => b.total - a.total);
}

function groupsFromIntegrityPayees(payees) {
  return Object.keys(payees || {}).map((key) => {
    const p = payees[key];
    return {
      groupKey: p.key || key,
      statementType: 'integrity',
      displayName: p.displayName,
      members: (p.match || []).slice(),
    };
  });
}

/** Badge: "Sent to commissions MM.YYYY" plus the sent calendar date when known. */
function sentToCommissionsBadge(period, sentDate, periodToMmYyyy) {
  const month = (periodToMmYyyy && periodToMmYyyy(period)) || String(period || '');
  const raw = String(sentDate || '').slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const datePart = m ? `${m[2]}/${m[3]}/${m[1]}` : raw;
  if (datePart) return `Sent to commissions ${month} · ${datePart}`;
  return `Sent to commissions ${month}`;
}

/** Distinct lock key so a house statement does not share an agent statement's lock. */
function houseLockName(statementType, payee) {
  return `House · ${String(statementType || '').trim()} · ${String(payee || '').trim()}`;
}

/** Locks are monthly (YYYYMM). House cycles like 20261015 lock the calendar month. */
function lockPeriod(period) {
  const s = String(period || '');
  return /^\d{6}/.test(s) ? s.slice(0, 6) : s;
}

module.exports = {
  groupForName,
  mergePayeeBuckets,
  groupsFromIntegrityPayees,
  sentToCommissionsBadge,
  houseLockName,
  lockPeriod,
};

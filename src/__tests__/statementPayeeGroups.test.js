'use strict';

const {
  mergePayeeBuckets,
  groupsFromIntegrityPayees,
  sentToCommissionsBadge,
  houseLockName,
  lockPeriod,
} = require('../statementPayeeGroups');
const { periodToMmYyyy } = require('../periodFormat');

function bucket(payee, writingAgent, amount) {
  return {
    payee,
    total: amount,
    lines: [{ writing_agent: writingAgent, agent_name: writingAgent, amount }],
  };
}

describe('mergePayeeBuckets', () => {
  const groups = [
    {
      groupKey: 'group-primary',
      statementType: 'integrity',
      displayName: 'Grouped Payee',
      members: ['producer a', 'agency entity'],
    },
  ];

  test('combines linked payee ids into one statement; other producer stays separate', () => {
    const out = mergePayeeBuckets([
      bucket('Producer A', 'Producer A', 10),
      bucket('Agency Entity', 'Agency Entity', 5),
      bucket('Producer B', 'Producer B', 7),
    ], groups, 'integrity');
    expect(out).toHaveLength(2);
    const grouped = out.find((s) => s.payeeGroupKey === 'group-primary');
    const other = out.find((s) => s.payee === 'Producer B');
    expect(grouped.payee).toBe('Grouped Payee');
    expect(grouped.total).toBe(15);
    expect(grouped.lineCount).toBe(2);
    expect(grouped.lines.map((l) => l.writing_agent).sort()).toEqual(['Agency Entity', 'Producer A']);
    expect(other.total).toBe(7);
    expect(other.lineCount).toBe(1);
  });

  test('no groups → buckets unchanged', () => {
    const src = [bucket('Producer A', 'Producer A', 10)];
    expect(mergePayeeBuckets(src, [], 'integrity')).toEqual(src);
  });

  test('groupsFromIntegrityPayees is a key/match projection (no extra literals)', () => {
    const registry = {
      'payee-one': { key: 'payee-one', displayName: 'Payee One', match: ['producer a', 'agency entity'] },
      'payee-two': { key: 'payee-two', displayName: 'Payee Two', match: ['producer b'] },
    };
    const g = groupsFromIntegrityPayees(registry);
    expect(g).toHaveLength(2);
    expect(g[0]).toEqual({
      groupKey: 'payee-one',
      statementType: 'integrity',
      displayName: 'Payee One',
      members: ['producer a', 'agency entity'],
    });
  });
});

describe('sentToCommissionsBadge', () => {
  test('uses MM.YYYY for the statement month and the sent calendar date', () => {
    expect(sentToCommissionsBadge('202610', '2026-10-26', periodToMmYyyy))
      .toBe('Sent to commissions 10.2026 · 10/26/2026');
    expect(sentToCommissionsBadge('202610', null, periodToMmYyyy))
      .toBe('Sent to commissions 10.2026');
  });
});

describe('house lock identity', () => {
  test('house lock name is distinct from the payee display name', () => {
    expect(houseLockName('integrity', 'Grouped Payee')).toBe('House · integrity · Grouped Payee');
    expect(houseLockName('integrity', 'Grouped Payee')).not.toBe('Grouped Payee');
  });

  test('lock period uses the calendar month of a longer cycle id', () => {
    expect(lockPeriod('20261015')).toBe('202610');
    expect(lockPeriod('202610')).toBe('202610');
  });
});

'use strict';

const {
  batchDedupeKey,
  findInternalDuplicates,
  collapseInternalDuplicates,
} = require('../uploadBatchDedupe');

describe('uploadBatchDedupe', () => {
  const base = {
    client: 'Maria Garcia',
    carrier: 'Humana',
    effectiveDate: '01/01/2025',
    period: '202607',
    classification: 'Renewal',
    commission: 50,
    policyNumber: 'P1',
    agent: 'Katy Robles',
  };

  test('batchDedupeKey is stable for same logical row', () => {
    expect(batchDedupeKey(base)).toBe(batchDedupeKey({ ...base }));
  });

  test('different commission amounts are not duplicates', () => {
    const rows = [base, { ...base, commission: -50 }];
    expect(findInternalDuplicates(rows)).toHaveLength(0);
    expect(collapseInternalDuplicates(rows).removedCount).toBe(0);
    expect(collapseInternalDuplicates(rows).records).toHaveLength(2);
  });

  test('exact within-batch duplicates collapse to first', () => {
    const rows = [base, { ...base }, { ...base, client: 'Other Person', policyNumber: 'P2' }];
    const dups = findInternalDuplicates(rows);
    expect(dups).toHaveLength(1);
    const collapsed = collapseInternalDuplicates(rows);
    expect(collapsed.removedCount).toBe(1);
    expect(collapsed.records).toHaveLength(2);
    expect(collapsed.records[0].client).toBe('Maria Garcia');
    expect(collapsed.records[1].client).toBe('Other Person');
  });

  test('different policy numbers are kept', () => {
    const rows = [base, { ...base, policyNumber: 'P2' }];
    expect(collapseInternalDuplicates(rows).removedCount).toBe(0);
  });
});

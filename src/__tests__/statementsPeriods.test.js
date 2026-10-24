const { statementsMonth, houseCycleOptions } = require('../utils/statementsPeriods');

describe('statementsMonth', () => {
  test('defaults to the newest YYYYMM period, skipping other formats', () => {
    expect(statementsMonth(['09/2026', '202608', '202609', '202607'])).toBe('202609');
  });
  test('uses the requested month when it exists', () => {
    expect(statementsMonth(['202609', '202608'], '202608')).toBe('202608');
  });
  test('ignores a requested month that is not in the list', () => {
    expect(statementsMonth(['202609', '202608'], '202501')).toBe('202609');
    expect(statementsMonth(['202609'], 'all')).toBe('202609');
  });
  test('empty list gives empty string', () => {
    expect(statementsMonth([])).toBe('');
    expect(statementsMonth(undefined)).toBe('');
  });
});

describe('houseCycleOptions', () => {
  test('month only when there are no pay cycles', () => {
    expect(houseCycleOptions('202609', [{ period: '202609' }, { period: '202608' }]))
      .toEqual([{ value: '202609', label: '09.2026 (month)' }]);
  });
  test('adds the NHP pay cycles inside that month, oldest first, no duplicates', () => {
    const opts = houseCycleOptions('202606', [
      { period: '20260615' }, { period: '20260530' }, { period: '20260601' }, '20260615', { period: '202606' },
    ]);
    expect(opts.map((o) => o.value)).toEqual(['202606', '20260601', '20260615']);
    expect(opts[2].label).toBe('06.2026 · cycle 15');
  });
  test('not a month gives no options', () => {
    expect(houseCycleOptions('all', [{ period: '20260615' }])).toEqual([]);
  });
});

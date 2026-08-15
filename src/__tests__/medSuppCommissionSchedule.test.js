'use strict';

const {
  lookupMedSuppYear1,
  normPlan,
  YEAR1_BY_STATE_PLAN,
} = require('../medSuppCommissionSchedule');

describe('medSuppCommissionSchedule', () => {
  test('normPlan extracts letter and Select/HDG', () => {
    expect(normPlan('Plan G')).toBe('G');
    expect(normPlan('AARP Medicare Supplement Select G')).toBe('SELECT G');
    expect(normPlan('High-Deductible G')).toBe('HIGH-DEDUCTIBLE G');
  });

  test('FL Area 1 Plan G Year 1 is $582', () => {
    expect(YEAR1_BY_STATE_PLAN['FL-1'].G).toBe(582);
    const hit = lookupMedSuppYear1({
      plan_name: 'Plan G',
      state: 'FL',
      area: 1,
    });
    expect(hit.amount).toBe(582);
    expect(hit.tableKey).toBe('FL-1');
  });

  test('defaults to FL-1 when state missing', () => {
    const hit = lookupMedSuppYear1({ plan_name: 'Plan N' });
    expect(hit.tableKey).toBe('FL-1');
    expect(hit.amount).toBe(397.5);
    expect(hit.usedDefaultFlState).toBe(true);
  });
});

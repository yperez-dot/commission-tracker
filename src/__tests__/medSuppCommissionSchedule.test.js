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

  test('HealthSpring Mushkin-style Plan G uses AgentView-derived Year-1', () => {
    const silvia = lookupMedSuppYear1({
      carrier: 'HealthSpring',
      plan_name: 'HNHIC MEDSUP STD PLAN G (ISSUE AGE)',
      state: 'FL',
      monthly_premium: 118,
    });
    expect(silvia.source).toBe('healthspring_agentview_derived');
    expect(silvia.amount).toBeCloseTo(55.59 * 12, 1);
    expect(silvia.monthlyCommission).toBeCloseTo(55.59, 1);

    const julius = lookupMedSuppYear1({
      carrier: 'CNHIC',
      plan_name: 'Plan G',
      // no premium → default $118 book rate from statement
    });
    expect(julius.amount).toBeCloseTo(55.59 * 12, 1);
  });

  test('HealthSpring is not confused with UHC AARP $582', () => {
    const hs = lookupMedSuppYear1({
      carrier: 'Cigna',
      policy_type: 'Medicare Supplement',
      plan_name: 'Plan G',
      monthly_premium: 118,
    });
    expect(hs.amount).not.toBe(582);
    expect(hs.amount).toBeCloseTo(667.08, 0);
  });
});

'use strict';

const { lobCardMetrics } = require('../lobCardMetrics');

describe('lobCardMetrics', () => {
  test('Medicare agent view uses agent_production (commission + payable coalesce), not small agent_payable alone', () => {
    const m = lobCardMetrics(
      {
        agent_payable: 9369,
        total: 85000,
        agent_production: 94369,
        count: 1127,
      },
      'MA',
      'agent'
    );
    expect(m.amount).toBe(94369);
    expect(m.count).toBe(1127);
  });

  test('Medicare agent view falls back to commission total when agent_production missing', () => {
    const m = lobCardMetrics(
      { agent_payable: 9369, total: 85000, count: 100 },
      'MA',
      'agent'
    );
    expect(m.amount).toBe(85000);
  });

  test('ACA agent view stays on producer_payable only', () => {
    const m = lobCardMetrics(
      {
        agent_payable: 243,
        total: 5000,
        agent_production: 5243,
        thei_total: 5000,
        count: 30,
      },
      'ACA',
      'agent'
    );
    expect(m.amount).toBe(243);
  });

  test('Medicare agency view prefers thei_share', () => {
    const m = lobCardMetrics(
      { thei_total: 12000, total: 15000, agent_payable: 100, count: 10 },
      'MA',
      'agency'
    );
    expect(m.amount).toBe(12000);
  });
});

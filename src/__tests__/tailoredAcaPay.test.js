'use strict';

const {
  isTailoredInsuranceAgent,
  resolveTailoredAcaPay,
} = require('../tailoredAcaPay');

describe('tailoredAcaPay', () => {
  test('detects Tailored Insurance agent names', () => {
    expect(isTailoredInsuranceAgent('Tailored Insurance Solutions')).toBe(true);
    expect(isTailoredInsuranceAgent('TAILORED INSURANCE SOLUTIONS INC')).toBe(true);
    expect(isTailoredInsuranceAgent('Yahoska Perez')).toBe(false);
  });

  test('Tailored ACA override column still pays agent, not THEI house', () => {
    const hit = resolveTailoredAcaPay({ commissionAmount: 0, overrideAmount: 54 });
    expect(hit.theiShare).toBe(0);
    expect(hit.producerPayable).toBe(54);
    expect(hit.recordType).toBe('ACA Agent Commission');
  });

  test('Tailored ACA commission column pays agent', () => {
    const hit = resolveTailoredAcaPay({ commissionAmount: 27, overrideAmount: 0 });
    expect(hit.producerPayable).toBe(27);
    expect(hit.theiShare).toBe(0);
  });

  test('negative Tailored ACA is chargeback to agent', () => {
    const hit = resolveTailoredAcaPay({ commissionAmount: 0, overrideAmount: -27 });
    expect(hit.producerPayable).toBe(-27);
    expect(hit.recordType).toBe('ACA Agent Chargeback');
  });
});

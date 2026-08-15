'use strict';

const {
  isTailoredAgency,
  isTailoredAcaPassThrough,
  resolveTailoredAcaPay,
  extractTailoredStatementMeta,
} = require('../tailoredAcaPay');

describe('tailoredAcaPay', () => {
  test('detects Tailored in agency / title (Jill Taylor is writing agent)', () => {
    expect(
      isTailoredAgency('The Health Experts Insurance-Tailored Insurance Solutions Agency')
    ).toBe(true);
    expect(
      isTailoredAgency(
        'THE HEALTH EXPERST INSURANCE - TAILORED INSURANCE SOLUTIONS AGCY - JILL TAYLOR'
      )
    ).toBe(true);
    expect(isTailoredAgency('The Health Experts Insurance')).toBe(false);
  });

  test('pass-through uses agency column even when agent is Jill Taylor', () => {
    expect(
      isTailoredAcaPassThrough({
        agentName: 'Jill Taylor',
        agency: 'The Health Experts Insurance-Tailored Insurance Solutions Agency',
      })
    ).toBe(true);
    expect(
      isTailoredAcaPassThrough({
        agentName: 'Jill Taylor',
        agency: 'The Health Experts Insurance',
      })
    ).toBe(false);
  });

  test('Tailored ACA commission pays writing agent, not THEI house', () => {
    const hit = resolveTailoredAcaPay({ commissionAmount: 27, overrideAmount: 0 });
    expect(hit.theiShare).toBe(0);
    expect(hit.producerPayable).toBe(27);
    expect(hit.recordType).toBe('ACA Agent Commission');
    expect(hit.mga).toBe('Tailored Insurance Solutions');
  });

  test('extracts JUN 15TH payment/statement date from preamble', () => {
    const meta = extractTailoredStatementMeta([
      ['THE HEALTH EXPERST INSURANCE - TAILORED INSURANCE SOLUTIONS AGCY - JILL TAYLOR'],
      [''],
      ['PAYMENT/STATEMENT DATE:  JUN 15TH, 2026'],
      [''],
      ['Molina ACA - March 2026', 162],
    ]);
    expect(meta.isTailoredStatement).toBe(true);
    expect(meta.paymentStatementDate).toMatch(/Jun\s+15,?\s+2026/i);
  });
});

'use strict';

const {
  extractPeriodFromStatementMonth,
  extractCycleFromFilename,
  resolveNhpPaymentPeriod,
  formatNhpCyclePeriodLabel,
} = require('../nhpPeriod');

describe('nhpPeriod', () => {
  test('extracts coverage month from carrier-statement month (audit only)', () => {
    expect(extractPeriodFromStatementMonth('Cigna - April 2026')).toBe('202604');
    expect(extractPeriodFromStatementMonth('UnitedHealthcare - May 2026')).toBe('202605');
    expect(extractPeriodFromStatementMonth('Humana - Sep 2025')).toBe('202509');
    expect(extractPeriodFromStatementMonth('Oscar Health - September 2025')).toBe('202509');
    expect(extractPeriodFromStatementMonth('Doctors - March 2026')).toBe('202603');
  });

  test('handles numeric month forms for coverage', () => {
    expect(extractPeriodFromStatementMonth('Cigna - 04/2026')).toBe('202604');
    expect(extractPeriodFromStatementMonth('Carrier - 2026-04')).toBe('202604');
  });

  test('returns null when month or year missing', () => {
    expect(extractPeriodFromStatementMonth('')).toBeNull();
    expect(extractPeriodFromStatementMonth(null)).toBeNull();
    expect(extractPeriodFromStatementMonth('Cigna')).toBeNull();
    expect(extractPeriodFromStatementMonth('Cigna - April')).toBeNull();
  });

  test('payment cycle ignores coverage month (legacy args)', () => {
    // Coverage "April" must NOT become the house period — cycle/upload wins.
    expect(resolveNhpPaymentPeriod('Cigna - April 2026', '202606')).toBe('202606');
    expect(resolveNhpPaymentPeriod('Cigna', '202608')).toBe('202608');
    expect(resolveNhpPaymentPeriod(null, null)).toBe('Unknown');
  });

  test('resolves NHP email payment cycles from opts / filename', () => {
    expect(
      resolveNhpPaymentPeriod({ cycleDate: 'May 30, 2026', uploadPeriod: '202608' })
    ).toBe('20260530');
    expect(
      resolveNhpPaymentPeriod({ cycleDate: 'June 15, 2026', uploadPeriod: '202608' })
    ).toBe('20260615');
    expect(
      resolveNhpPaymentPeriod({
        filename: 'The_Health_Experts_Insurance_Statement_2026-06-15.xlsx',
        uploadPeriod: '202608',
      })
    ).toBe('20260615');
    expect(extractCycleFromFilename('NHP_Statement_05-30-2026.pdf')).toBe('20260530');
  });

  test('formats cycle labels for house picker', () => {
    expect(formatNhpCyclePeriodLabel('202606')).toBe('Jun 2026');
    expect(formatNhpCyclePeriodLabel('20260615')).toBe('Jun 15, 2026 cycle');
    expect(formatNhpCyclePeriodLabel('20260530')).toBe('May 30, 2026 cycle');
  });
});

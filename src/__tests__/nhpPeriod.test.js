'use strict';

const {
  extractPeriodFromStatementMonth,
  resolveNhpPaymentPeriod,
} = require('../nhpPeriod');

describe('nhpPeriod', () => {
  test('extracts month name + year from carrier-statement month', () => {
    expect(extractPeriodFromStatementMonth('Cigna - April 2026')).toBe('202604');
    expect(extractPeriodFromStatementMonth('UnitedHealthcare - May 2026')).toBe('202605');
    expect(extractPeriodFromStatementMonth('Humana - Sep 2025')).toBe('202509');
    expect(extractPeriodFromStatementMonth('Oscar Health - September 2025')).toBe('202509');
    expect(extractPeriodFromStatementMonth('Doctors - March 2026')).toBe('202603');
  });

  test('handles numeric month forms', () => {
    expect(extractPeriodFromStatementMonth('Cigna - 04/2026')).toBe('202604');
    expect(extractPeriodFromStatementMonth('Carrier - 2026-04')).toBe('202604');
  });

  test('returns null when month or year missing', () => {
    expect(extractPeriodFromStatementMonth('')).toBeNull();
    expect(extractPeriodFromStatementMonth(null)).toBeNull();
    expect(extractPeriodFromStatementMonth('Cigna')).toBeNull();
    expect(extractPeriodFromStatementMonth('Cigna - April')).toBeNull();
  });

  test('resolve falls back to upload period', () => {
    expect(resolveNhpPaymentPeriod('Cigna - April 2026', '202608')).toBe('202604');
    expect(resolveNhpPaymentPeriod('Cigna', '202608')).toBe('202608');
    expect(resolveNhpPaymentPeriod(null, null)).toBe('Unknown');
  });
});

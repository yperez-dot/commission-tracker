const {
  periodToMmYyyy, formatPeriodLabel, parsePeriodInput, normalizePeriodInput, formatPeriodsInText,
} = require('../periodFormat');

describe('periodFormat — MM.YYYY everywhere', () => {
  test('stored formats → MM.YYYY', () => {
    expect(periodToMmYyyy('202609')).toBe('09.2026');
    expect(periodToMmYyyy('09/2026')).toBe('09.2026');
    expect(periodToMmYyyy('9/2026')).toBe('09.2026');
    expect(periodToMmYyyy('09/15/2026')).toBe('09.2026');
    expect(periodToMmYyyy('2026-09')).toBe('09.2026');
    expect(periodToMmYyyy('09-2026')).toBe('09.2026');
    expect(periodToMmYyyy('09.2026')).toBe('09.2026');
  });
  test('NHP pay cycles keep their day', () => {
    expect(periodToMmYyyy('20260615')).toBe('06.2026 · cycle 15');
  });
  test('not a period', () => {
    expect(periodToMmYyyy('202613')).toBeNull();
    expect(periodToMmYyyy('all')).toBeNull();
    expect(periodToMmYyyy('')).toBeNull();
    expect(periodToMmYyyy(null)).toBeNull();
    expect(formatPeriodLabel('Unknown')).toBe('Unknown');
    expect(formatPeriodLabel('all', 'All periods')).toBe('All periods');
  });
  test('typed input accepts MM.YYYY and friends', () => {
    expect(parsePeriodInput('09.2026')).toBe('202609');
    expect(parsePeriodInput('9.2026')).toBe('202609');
    expect(parsePeriodInput('09/2026')).toBe('202609');
    expect(parsePeriodInput('09-2026')).toBe('202609');
    expect(parsePeriodInput('202609')).toBe('202609');
    expect(parsePeriodInput('2026-09')).toBe('202609');
    expect(parsePeriodInput('13.2026')).toBeNull();
    expect(normalizePeriodInput(' 09.2026 ')).toBe('202609');
    expect(normalizePeriodInput('abc')).toBe('abc');
  });
  test('YYYYMM tokens in free text', () => {
    expect(formatPeriodsInText('Locked Agent A 202609 (marked paid)')).toBe('Locked Agent A 09.2026 (marked paid)');
    expect(formatPeriodsInText('Deleted record #202609')).toBe('Deleted record #202609');
    expect(formatPeriodsInText('Paid $202609.00')).toBe('Paid $202609.00');
    expect(formatPeriodsInText('id 12026090')).toBe('id 12026090');
    expect(formatPeriodsInText(null)).toBe('');
  });
});

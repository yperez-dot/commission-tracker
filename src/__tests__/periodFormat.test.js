const {
  periodToMmYyyy, formatPeriodLabel, parsePeriodInput, normalizePeriodInput, formatPeriodsInText,
  periodFromFilename, periodFromStatementDate, resolveBsiRowPeriod,
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
    expect(parsePeriodInput('10.26')).toBe('202610');
    expect(parsePeriodInput('10-26')).toBe('202610');
    expect(normalizePeriodInput(' 09.2026 ')).toBe('202609');
    expect(normalizePeriodInput('abc')).toBe('abc');
  });
  test('filename MM.YY / MM.YYYY / YYYY-MM-DD', () => {
    expect(periodFromFilename('BSI.UHC.10.26.xlsx')).toBe('202610');
    expect(periodFromFilename('BSI_UHC_09.2026.xlsx')).toBe('202609');
    expect(periodFromFilename('UHC_BSI_STATEMENT_2026-05-01.xlsx')).toBe('202605');
    expect(periodFromFilename('devoted_2026-09.xlsx')).toBe('202609');
    expect(periodFromFilename('BSI UHC October 2026.xlsx')).toBe('202610');
  });

  test('Statement Date and Payment Period resolve a UHC row period', () => {
    expect(periodFromStatementDate('10/06/2026')).toBe('202610');
    expect(periodFromStatementDate(new Date(Date.UTC(2026, 9, 16)))).toBe('202610');
    expect(resolveBsiRowPeriod({ 'Payment Period': 202610, 'Statement Date': '09/01/2026' }, null)).toBe('202610');
    expect(resolveBsiRowPeriod({ 'Payment Period': '', 'Statement Date': '10/06/2026' }, null)).toBe('202610');
    expect(resolveBsiRowPeriod({ 'Payment Period': '', 'Statement Date': '' }, '202610')).toBe('202610');
    expect(resolveBsiRowPeriod({ 'Payment Period': '', 'Statement Date': '' }, null)).toBe('');
  });

  test('YYYYMM tokens in free text', () => {
    expect(formatPeriodsInText('Locked Agent A 202609 (marked paid)')).toBe('Locked Agent A 09.2026 (marked paid)');
    expect(formatPeriodsInText('Deleted record #202609')).toBe('Deleted record #202609');
    expect(formatPeriodsInText('Paid $202609.00')).toBe('Paid $202609.00');
    expect(formatPeriodsInText('id 12026090')).toBe('id 12026090');
    expect(formatPeriodsInText(null)).toBe('');
  });
});

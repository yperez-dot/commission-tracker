import { formatDate, formatPeriod } from '../utils/dateFormat';

describe('formatDate', () => {
  test('keeps olicomm MM-DD-YYYY and slash dates', () => {
    expect(formatDate('01-01-2026')).toBe('01-01-2026');
    expect(formatDate('1/5/2024')).toBe('01-05-2024');
    expect(formatDate('2024-01-15')).toBe('01-15-2024');
  });

  test('formats Doctors Healthcare compact YYYYMMDD dates', () => {
    expect(formatDate('20240101')).toBe('01-01-2024');
    expect(formatDate(20240101)).toBe('01-01-2024');
    expect(formatDate('20260615')).toBe('06-15-2026');
  });

  test('formats statement periods like other olicomm pages', () => {
    expect(formatDate('202606')).toBe('Jun 2026');
    expect(formatPeriod('202606')).toBe('Jun 2026');
    expect(formatPeriod('01/2026')).toBe('Jan 2026');
  });

  test('leaves unknown and empty values alone', () => {
    expect(formatDate('')).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('Unknown')).toBe('Unknown');
    expect(formatDate('20241399')).toBe('20241399');
  });
});

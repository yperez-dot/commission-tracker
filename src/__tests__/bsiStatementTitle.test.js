const {
  buildBsiStatementTitle,
  bsiUploadTitle,
  carrierDisplayName,
  monthsFromText,
  monthsFromPeriods,
  normalizePeriodToYm,
  cleanManualTitle,
  normalizeAutoTitle,
  formatMonth,
  compareBsiUploadsByTitle,
} = require('../bsiStatementTitle');
const { periodCountsFromRecords, planBsiTitles } = require('../bsiStatementTitleDb');

const title = (filename, extra = {}) => buildBsiStatementTitle({ filename, ...extra }).title;

describe('BSI statement titles — filenames seen in production', () => {
  test.each([
    ['BSI UHC 09.2026.xlsx', 'UnitedHealthcare', 'BSI · UHC · 09-2026'],
    ['BSI-Freedom.09.2026.xlsx', 'Freedom Health', 'BSI · Freedom · 09-2026'],
    ['BSI-Devoted.09.2026.csv', 'Devoted', 'BSI · Devoted · 09-2026'],
    ['BSI.Humana.09.2026.csv', 'Humana', 'BSI · Humana · 09-2026'],
    ['BSI_DEVOTED_STATEMENTS_JULY_2026.csv', 'Devoted', 'BSI · Devoted · 07-2026'],
    ['BSI_UHC_STATEMENT_AUGUST_2026-08-01.xlsx', 'UnitedHealthcare', 'BSI · UHC · 08-2026'],
    ['AETNA_BSI_STATEMENT_202512.csv', 'Aetna', 'BSI · Aetna · 12-2025'],
    ['Humana_BSI_11.25_12.25.CSV', 'Humana', 'BSI · Humana · 11-2025 to 12-2025'],
    ['BSI_UHC_08.01.26.xlsx', '', 'BSI · UHC · 08-2026'],
    ['UHC_BSI_STATEMENT_2026-01-01.xlsx', '', 'BSI · UHC · 01-2026'],
    ['BSI_HUMANA_2026-09.csv', '', 'BSI · Humana · 09-2026'],
    ['BSI_HUMANA_2025-11_to_2025-12.csv', '', 'BSI · Humana · 11-2025 to 12-2025'],
    ['Devoted BSI Sept 2026.xlsx', '', 'BSI · Devoted · 09-2026'],
  ])('%s → %s', (filename, carrier, expected) => {
    expect(title(filename, { carrier })).toBe(expected);
  });
});

describe('statement period from parsed rows wins', () => {
  test('uses the rows period even when filename has none', () => {
    const r = buildBsiStatementTitle({
      filename: 'BSI UHC.xlsx',
      periods: [{ period: '202609', count: 60 }, { period: '202605', count: 3 }],
    });
    expect(r.title).toBe('BSI · UHC · 09-2026');
    expect(r.source).toBe('data');
    expect(r.confidence).toBe('high');
  });

  test('stray chargeback months (<20%) do not widen the range', () => {
    expect(monthsFromPeriods([{ period: '202609', count: 50 }, { period: '202601', count: 2 }]))
      .toMatchObject({ start: '2026-09', end: '2026-09' });
  });

  test('two real months → range', () => {
    const r = buildBsiStatementTitle({
      filename: 'Humana_BSI_11.25_12.25.CSV',
      periods: [{ period: '202511', count: 40 }, { period: '202512', count: 35 }],
    });
    expect(r.title).toBe('BSI · Humana · 11-2025 to 12-2025');
    expect(r.confidence).toBe('high');
  });

  test('data vs filename disagreement is flagged low confidence', () => {
    const r = buildBsiStatementTitle({
      filename: 'BSI-Devoted.09.2026.csv',
      periods: [{ period: '202608', count: 20 }],
    });
    expect(r.title).toBe('BSI · Devoted · 08-2026');
    expect(r.confidence).toBe('low');
    expect(r.notes.join(' ')).toMatch(/filename says 09-2026/);
  });

  test('Unknown periods fall back to filename', () => {
    const r = buildBsiStatementTitle({
      filename: 'AETNA_BSI_STATEMENT_202512.csv',
      periods: [{ period: 'Unknown', count: 10 }],
    });
    expect(r.title).toBe('BSI · Aetna · 12-2025');
    expect(r.source).toBe('filename');
  });

  test('fallback title is last resort', () => {
    const r = buildBsiStatementTitle({ filename: 'BSI Humana.csv', fallbackTitle: 'Humana Sept 2026' });
    expect(r.title).toBe('BSI · Humana · 09-2026');
    expect(r.source).toBe('title');
  });

  test('no month anywhere → flagged, carrier only', () => {
    const r = buildBsiStatementTitle({ filename: 'BSI Humana.csv' });
    expect(r.title).toBe('BSI · Humana');
    expect(r.notes).toContain('statement month could not be determined');
  });

  test('month name without year infers year from upload date (low confidence)', () => {
    const r = buildBsiStatementTitle({ filename: 'Humana_BSI_December.xlsx', uploadedAt: '2026-01-10T00:00:00Z' });
    expect(r.title).toBe('BSI · Humana · 12-2025');
    expect(r.confidence).toBe('low');
  });
});

describe('helpers', () => {
  test('carrierDisplayName', () => {
    expect(carrierDisplayName('UnitedHealthcare')).toBe('UHC');
    expect(carrierDisplayName('Humana Healthspring')).toBe('Humana');
    expect(carrierDisplayName('BSI-Freedom.09.2026')).toBe('Freedom');
    expect(carrierDisplayName('random')).toBe('');
  });

  test('normalizePeriodToYm', () => {
    expect(normalizePeriodToYm('202609')).toBe('2026-09');
    expect(normalizePeriodToYm('20260915')).toBe('2026-09');
    expect(normalizePeriodToYm('2026-09-01')).toBe('2026-09');
    expect(normalizePeriodToYm('09/2026')).toBe('2026-09');
    expect(normalizePeriodToYm('09/15/2026')).toBe('2026-09');
    expect(normalizePeriodToYm('Unknown')).toBeNull();
  });

  test('monthsFromText does not mistake day/month in ISO dates', () => {
    expect(monthsFromText('X_2026-08-01')).toEqual({ start: '2026-08', end: '2026-08' });
  });

  test('periodCountsFromRecords', () => {
    expect(periodCountsFromRecords([{ period: '202609' }, { period: '202609' }, { period: '' }]))
      .toEqual([{ period: '202609', count: 2 }]);
  });

  test('bsiUploadTitle prefers stored title', () => {
    expect(bsiUploadTitle({ display_title: 'BSI · UHC · 2026-09', original_name: 'whatever.xlsx' })).toBe('BSI · UHC · 09-2026');
    expect(bsiUploadTitle({ original_name: 'BSI UHC 09.2026.xlsx', carrier: 'UnitedHealthcare' })).toBe('BSI · UHC · 09-2026');
  });

  test('cleanManualTitle', () => {
    expect(cleanManualTitle('  BSI  ·  UHC ')).toBe('BSI · UHC');
    expect(cleanManualTitle('')).toBe('');
    expect(cleanManualTitle('x'.repeat(500))).toHaveLength(120);
  });
});

describe('planBsiTitles (backfill dry run)', () => {
  function fakePool({ withCols = true, uploads, periods }) {
    return {
      query: jest.fn(async (sql) => {
        if (/information_schema/.test(sql)) {
          return { rows: withCols ? [{ column_name: 'display_title' }, { column_name: 'display_title_source' }] : [] };
        }
        if (/FROM uploads/.test(sql)) return { rows: uploads };
        if (/FROM commission_records/.test(sql)) return { rows: periods };
        if (/^\s*(UPDATE|ALTER|INSERT|DELETE)/i.test(sql)) throw new Error('dry run must not write');
        return { rows: [] };
      }),
    };
  }

  test('computes old → new, keeps manual titles, flags duplicates, never writes', async () => {
    const pool = fakePool({
      uploads: [
        { id: 1, original_name: 'BSI UHC 09.2026.xlsx', carrier: 'UnitedHealthcare', display_title: null, display_title_source: null },
        { id: 2, original_name: 'BSI_UHC_SEP.xlsx', carrier: 'UnitedHealthcare', display_title: null, display_title_source: null },
        { id: 3, original_name: 'BSI-Devoted.09.2026.csv', carrier: 'Devoted', display_title: 'Devoted Sept (fixed)', display_title_source: 'manual' },
      ],
      periods: [
        { upload_id: 1, period: '202609', count: 63 },
        { upload_id: 2, period: '202609', count: 10 },
      ],
    });
    const plan = await planBsiTitles(pool, { oldTitleOf: () => 'legacy' });
    expect(plan.map((p) => p.new_title)).toEqual(['BSI · UHC · 09-2026', 'BSI · UHC · 09-2026', 'Devoted Sept (fixed)']);
    expect(plan[0].old_title).toBe('legacy');
    expect(plan[0].notes.join(' ')).toMatch(/same title/);
    expect(plan[2].changed).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => /^\s*(UPDATE|ALTER)/i.test(sql))).toBe(false);
  });

  test('works before the display_title column exists', async () => {
    const pool = fakePool({
      withCols: false,
      uploads: [{ id: 9, original_name: 'AETNA_BSI_STATEMENT_202512.csv', carrier: 'Aetna' }],
      periods: [],
    });
    const plan = await planBsiTitles(pool);
    expect(plan[0]).toMatchObject({ new_title: 'BSI · Aetna · 12-2025', changed: true, old_title: 'AETNA_BSI_STATEMENT_202512.csv' });
  });
});

describe('month-first titles (MM-YYYY)', () => {
  test('formatMonth flips YYYY-MM', () => {
    expect(formatMonth('2026-09')).toBe('09-2026');
    expect(formatMonth('junk')).toBe('junk');
  });

  test('old auto titles are flipped; other text is left alone', () => {
    expect(normalizeAutoTitle('BSI · UHC · 2026-09')).toBe('BSI · UHC · 09-2026');
    expect(normalizeAutoTitle('BSI · Humana · 2025-11 to 2025-12')).toBe('BSI · Humana · 11-2025 to 12-2025');
    expect(normalizeAutoTitle('BSI · UHC · 09-2026')).toBe('BSI · UHC · 09-2026');
    expect(normalizeAutoTitle('Devoted Sept (fixed)')).toBe('Devoted Sept (fixed)');
    expect(normalizeAutoTitle('Notes 2026-09')).toBe('Notes 2026-09');
  });

  test('bsiUploadTitle flips stored auto titles but keeps manual ones as typed', () => {
    expect(bsiUploadTitle({ display_title: 'BSI · UHC · 2026-09', display_title_source: 'auto' })).toBe('BSI · UHC · 09-2026');
    expect(bsiUploadTitle({ display_title: 'BSI · UHC · 2026-09', display_title_source: null })).toBe('BSI · UHC · 09-2026');
    expect(bsiUploadTitle({ display_title: 'BSI · UHC · 2026-09', display_title_source: 'manual' })).toBe('BSI · UHC · 2026-09');
  });

  test('parser reads both the new and the old title forms', () => {
    expect(monthsFromText('BSI · UHC · 09-2026')).toEqual({ start: '2026-09', end: '2026-09' });
    expect(monthsFromText('BSI · UHC · 2026-09')).toEqual({ start: '2026-09', end: '2026-09' });
    expect(monthsFromText('BSI · Humana · 11-2025 to 12-2025')).toEqual({ start: '2025-11', end: '2025-12' });
    expect(monthsFromText('BSI · Humana · 2025-11 to 2025-12')).toEqual({ start: '2025-11', end: '2025-12' });
    expect(monthsFromText('BSI_HUMANA_2025-11_to_2025-12.csv')).toEqual({ start: '2025-11', end: '2025-12' });
  });

  test('a new title used as fallback still yields the same month', () => {
    expect(title('no-date.xlsx', { carrier: 'Humana', fallbackTitle: 'BSI · Humana · 11-2025 to 12-2025' }))
      .toBe('BSI · Humana · 11-2025 to 12-2025');
  });

  test('title sort is carrier, then statement month — not alphabetical text', () => {
    const ups = [
      { id: 1, display_title: 'BSI · UHC · 01-2026', display_title_source: 'auto' },
      { id: 2, display_title: 'BSI · Humana · 2026-09', display_title_source: 'auto' },
      { id: 3, display_title: 'BSI · UHC · 09-2025', display_title_source: 'auto' },
      { id: 4, display_title: 'BSI · Humana · 11-2025 to 12-2025', display_title_source: 'auto' },
    ];
    expect([...ups].sort(compareBsiUploadsByTitle).map((u) => u.id)).toEqual([4, 2, 3, 1]);
  });

  test('backfill plan marks old-form auto titles as changed and leaves manual ones', async () => {
    const pool = {
      query: jest.fn(async (sql) => {
        if (/information_schema/.test(sql)) return { rows: [{ column_name: 'display_title' }, { column_name: 'display_title_source' }] };
        if (/FROM uploads/.test(sql)) {
          return { rows: [
            { id: 1, original_name: 'BSI UHC 09.2026.xlsx', carrier: 'UnitedHealthcare', display_title: 'BSI · UHC · 2026-09', display_title_source: 'auto' },
            { id: 2, original_name: 'BSI UHC 08.2026.xlsx', carrier: 'UnitedHealthcare', display_title: 'BSI · UHC · 2026-08', display_title_source: 'manual' },
          ] };
        }
        if (/FROM commission_records/.test(sql)) return { rows: [{ upload_id: 1, period: '202609', count: 5 }] };
        return { rows: [] };
      }),
    };
    const plan = await planBsiTitles(pool);
    expect(plan[0]).toMatchObject({ new_title: 'BSI · UHC · 09-2026', changed: true });
    expect(plan[1]).toMatchObject({ new_title: 'BSI · UHC · 2026-08', changed: false, manual: true });
  });
});

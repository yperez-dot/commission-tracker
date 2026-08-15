'use strict';

const { fetchAllPages, truncationMessage, summarize } = require('../fetchAllPages');

describe('fetchAllPages', () => {
  test('summarize flags truncation when fetched < total', () => {
    const s = summarize([1, 2, 3], 10, 1, false);
    expect(s.truncated).toBe(true);
    expect(s.warning).toMatch(/3 of 10/);
  });

  test('summarize clear when complete', () => {
    const s = summarize([1, 2, 3], 3, 1, false);
    expect(s.truncated).toBe(false);
    expect(s.warning).toBeNull();
  });

  test('pages until total reached', async () => {
    const pages = {
      0: { records: [1, 2], total: 5 },
      2: { records: [3, 4], total: 5 },
      4: { records: [5], total: 5 },
    };
    const fetchFn = async (path) => {
      const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset'));
      return pages[offset] || { records: [], total: 5 };
    };
    const result = await fetchAllPages('/records', { pageSize: 2 }, fetchFn);
    expect(result.items).toEqual([1, 2, 3, 4, 5]);
    expect(result.truncated).toBe(false);
    expect(result.pages).toBe(3);
  });

  test('respects maxRows safety cap', async () => {
    const fetchFn = async (path) => {
      const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset'));
      return { records: [offset, offset + 1], total: 100 };
    };
    const result = await fetchAllPages('/records', { pageSize: 2, maxRows: 4 }, fetchFn);
    expect(result.items).toHaveLength(4);
    expect(result.truncated).toBe(true);
    expect(result.capped).toBe(true);
  });

  test('truncationMessage joins parts', () => {
    expect(truncationMessage([null, 'A', '', 'B'])).toBe('A B');
    expect(truncationMessage([])).toBeNull();
  });
});

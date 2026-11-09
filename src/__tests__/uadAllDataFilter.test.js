'use strict';

const path = require('path');
const XLSX = require('xlsx');
const {
  wantsUadPaymentsView,
  initialListModeForFilters,
  uadAmountSignSql,
  UAD_CLASSIFICATION,
} = require('../uadAllDataFilter');
const { parseUHCRows, uadTotals } = require('../uhcCommissionParse');

const SEPT = path.join(__dirname, 'fixtures', 'UHC_THEI_09.2026_sample.xlsx');
const OCT = path.join(__dirname, 'fixtures', 'UHC_THEI_10.2026.xlsx');

describe('uadAllDataFilter', () => {
  test('amountSign=uad deep-link opens By payment (not By client)', () => {
    expect(wantsUadPaymentsView({ amountSign: 'uad' })).toBe(true);
    expect(initialListModeForFilters({ amountSign: 'uad' })).toBe('payments');
    expect(initialListModeForFilters({ classification: UAD_CLASSIFICATION })).toBe('payments');
    expect(initialListModeForFilters({})).toBe('clients');
  });

  test('SQL predicate matches nonzero uad_activity', () => {
    expect(uadAmountSignSql('cr')).toBe('COALESCE(cr.uad_activity, 0) <> 0');
    expect(uadAmountSignSql('')).toBe('COALESCE(uad_activity, 0) <> 0');
  });

  test('THEI 09+10: 9 UAD payment lines / -$311.03, but only 7 unique clients', () => {
    const sept = parseUHCRows(XLSX.readFile(SEPT), 'UHC_THEI_09.2026.xlsx');
    const oct = parseUHCRows(XLSX.readFile(OCT), 'UHC_THEI_10.2026.xlsx');
    const septUad = sept.filter((r) => Number(r.uadActivity) !== 0);
    const octUad = oct.filter((r) => Number(r.uadActivity) !== 0);
    expect(septUad).toHaveLength(7);
    expect(uadTotals(sept).uadActivity).toBeCloseTo(-250.73, 2);
    expect(octUad).toHaveLength(2);
    expect(uadTotals(oct).uadActivity).toBeCloseTo(-60.3, 2);

    const all = [...septUad, ...octUad];
    expect(all).toHaveLength(9);
    const sum = Math.round(all.reduce((s, r) => s + r.uadActivity, 0) * 100) / 100;
    expect(sum).toBeCloseTo(-311.03, 2);

    // Same members recur in Oct (Cheung / Willsromero) — By client collapses to 7.
    const uniqueClients = new Set(all.map((r) => String(r.client || '').toUpperCase().trim()));
    expect(uniqueClients.size).toBe(7);
    expect([...uniqueClients]).toEqual(expect.arrayContaining([
      'CHEUNG, CHITING',
      'WILLSROMERO, PATRICIO',
    ]));
  });
});

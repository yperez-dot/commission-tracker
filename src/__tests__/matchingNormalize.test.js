'use strict';

const {
  normName,
  normalizeCarrier,
  carriersMatch,
  normalizeCarrierKey,
  nameVariants,
} = require('../matchingNormalize.cjs');

describe('matchingNormalize', () => {
  test('normName strips middle initial on comma path', () => {
    expect(normName('GARCIA, MARIA L.')).toBe('Maria Garcia');
    expect(normName('Maria Garcia')).toBe('Maria Garcia');
  });

  test('normName strips trailing MI and Jr on non-comma path', () => {
    expect(normName('Maria L. Garcia')).toBe('Maria Garcia');
    expect(normName('Robert Jones Jr')).toBe('Robert Jones');
  });

  test('United of Omaha does not collapse to UHC', () => {
    expect(normalizeCarrier('United of Omaha')).toBe('united of omaha');
    expect(normalizeCarrier('Mutual of Omaha')).toBe('mutual of omaha');
    expect(normalizeCarrier('UnitedHealthcare')).toBe('unitedhealthcare');
    expect(normalizeCarrier('UHC')).toBe('unitedhealthcare');
  });

  test('carriersMatch rejects empty carrier (JS includes trap)', () => {
    expect('humana'.includes('')).toBe(true); // language footgun
    expect(carriersMatch('Humana', '')).toBe(false);
    expect(carriersMatch('', 'Humana')).toBe(false);
    expect(carriersMatch('Humana', 'HUMANA INC')).toBe(true);
    expect(carriersMatch('United of Omaha', 'UnitedHealthcare')).toBe(false);
  });

  test('normalizeCarrierKey omaha vs uhc', () => {
    expect(normalizeCarrierKey('United of Omaha')).toBe('unitedofomaha');
    expect(normalizeCarrierKey('UHC')).toBe('unitedhealthcare');
  });

  test('nameVariants includes reversed order', () => {
    const v = nameVariants('Hector Proano');
    expect(v).toContain('Hector Proano');
    expect(v).toContain('Proano Hector');
  });
});

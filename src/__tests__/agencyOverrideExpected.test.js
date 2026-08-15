'use strict';

const {
  expectedAgencyOverride,
  expectedOverrideLabel,
  normalizeRateCarrier,
} = require('../utils/agencyOverrideExpected');

describe('agencyOverrideExpected', () => {
  test('maps UnitedHealthcare → UHC National Initial THEI share', () => {
    const meta = expectedAgencyOverride({
      carrier: 'UnitedHealthcare',
      state: 'TX',
      enrollment_type: 'New',
      status: 'Active',
    });
    expect(normalizeRateCarrier('UnitedHealthcare')).toBe('UHC');
    expect(meta.kind).toBe('rate');
    expect(meta.yearType).toBe('Initial');
    // UHC National Initial pot 150 → THEI 75
    expect(meta.pot).toBe(150);
    expect(meta.amount).toBe(75);
    expect(expectedOverrideLabel(meta)).toContain('THEI 50%');
  });

  test('Aetna National Renewal → THEI 22.50', () => {
    const meta = expectedAgencyOverride({
      carrier: 'Aetna',
      state: 'GA',
      raw_data: { 'Sales Event': 'Renewal' },
    });
    expect(meta.kind).toBe('rate');
    expect(meta.yearType).toBe('Renewal');
    expect(meta.pot).toBe(45);
    expect(meta.amount).toBe(22.5);
  });

  test('Humana Active production defaults to Initial (not Renewal $37.50)', () => {
    const meta = expectedAgencyOverride({
      carrier: 'Humana',
      state: 'FL',
      status: 'Active',
      enrollment_type: 'AEP',
      effective_date: '2026-08-01',
      raw_data: { Enrollment_Type: 'AEP', Status: 'Active' },
    });
    expect(meta.yearType).toBe('Initial');
    // Humana National Initial pot 150 → THEI 75
    expect(meta.pot).toBe(150);
    expect(meta.amount).toBe(75);
  });

  test('Humana explicit renewal stays Renewal $37.50', () => {
    const meta = expectedAgencyOverride({
      carrier: 'Humana',
      state: 'TX',
      raw_data: { 'First Year/Renewal': 'Renewal Year' },
    });
    expect(meta.yearType).toBe('Renewal');
    expect(meta.pot).toBe(75);
    expect(meta.amount).toBe(37.5);
  });

  test('Aetna FL HMO plan uses Florida HMO_CSNP Initial', () => {
    const meta = expectedAgencyOverride({
      carrier: 'Aetna',
      state: 'FL',
      plan_name: 'H1609-018 Select',
      enrollment_type: 'New Business',
    });
    expect(meta.kind).toBe('rate');
    expect(meta.stateGroup).toBe('Florida HMO_CSNP');
    expect(meta.pot).toBe(240);
    expect(meta.amount).toBe(120);
  });

  test('unknown carrier returns note', () => {
    const meta = expectedAgencyOverride({ carrier: 'MysteryCarrier', state: 'FL' });
    expect(meta.kind).toBe('unknown');
    expect(meta.amount).toBeNull();
  });
});

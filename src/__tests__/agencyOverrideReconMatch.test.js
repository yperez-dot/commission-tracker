'use strict';

const {
  findOverrideMatch,
  isOverridePaid,
  isAetnaActivePolicy,
} = require('../agencyOverrideReconMatch.cjs');

describe('agencyOverrideReconMatch', () => {
  test('nets override + chargeback so clawed-back cases are not Paid', () => {
    const prod = { client_name: 'Milagros Cambas De Rivas', carrier: 'Aetna' };
    const overrides = [
      { client_full_name: 'CAMBAS DE RIVAS, MILAGROS', carrier: 'Aetna', commission: 80, classification: 'Agency Override' },
      { client_full_name: 'Milagros Cambas De Rivas', carrier: 'Aetna', commission: -80, classification: 'Chargeback' },
    ];
    const match = findOverrideMatch(prod, overrides);
    expect(match).not.toBeNull();
    expect(match.override_net).toBe(0);
    expect(match.matchCount).toBe(2);
    expect(isOverridePaid(match)).toBe(false);
  });

  test('positive net is Paid', () => {
    const prod = { client_name: 'Jane Doe', carrier: 'Aetna' };
    const overrides = [
      { client_full_name: 'Jane Doe', carrier: 'Aetna', commission: 150 },
    ];
    expect(isOverridePaid(findOverrideMatch(prod, overrides))).toBe(true);
  });

  test('Aetna returnee: Active enroll keeps despite Exit Voluntary', () => {
    expect(
      isAetnaActivePolicy({
        Enroll_Status: 'Active',
        Exit_Status: 'VOLUNTARY',
        Term_Status: '',
      })
    ).toBe(true);
  });

  test('Aetna cancelled enroll is dropped', () => {
    expect(
      isAetnaActivePolicy({
        Enroll_Status: 'Cancelled',
        Exit_Status: '',
        Term_Status: '',
      })
    ).toBe(false);
  });

  test('Aetna Exit Voluntary alone (no active enroll) is dropped', () => {
    expect(
      isAetnaActivePolicy({
        Enroll_Status: '',
        Exit_Status: 'VOLUNTARY',
        Term_Status: '',
      })
    ).toBe(false);
  });

  test('loose name match still nets returnee clawback', () => {
    const prod = { client_name: 'Milagros Cambas De Rivas', carrier: 'Aetna' };
    const overrides = [
      { client_full_name: 'CAMBAS DE RIVAS, MILAGROS', carrier: 'Aetna', commission: 80 },
      { client_full_name: 'CAMBAS DE RIVAS MILAGROS', carrier: 'Aetna', commission: -80 },
    ];
    const match = findOverrideMatch(prod, overrides);
    expect(match.override_net).toBe(0);
    expect(isOverridePaid(match)).toBe(false);
  });
});

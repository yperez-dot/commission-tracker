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

  test('lifecycle expands paid + chargeback + missing for returnee', () => {
    const { expandOverrideLifecycle } = require('../agencyOverrideReconMatch.cjs');
    const prod = { id: 42, client_name: 'Milagros Cambas De Rivas', carrier: 'Aetna' };
    const overrides = [
      { id: 1, client_full_name: 'Milagros Cambas De Rivas', carrier: 'Aetna', commission: 80 },
      { id: 2, client_full_name: 'Milagros Cambas De Rivas', carrier: 'Aetna', commission: -80 },
    ];
    const rows = expandOverrideLifecycle(prod, overrides);
    expect(rows.map((r) => r.lifecycle).sort()).toEqual(['chargeback', 'missing', 'paid']);
    expect(rows.find((r) => r.lifecycle === 'paid').override.override_net).toBe(80);
    expect(rows.find((r) => r.lifecycle === 'chargeback').override.override_net).toBe(-80);
    expect(rows.find((r) => r.lifecycle === 'missing').override.override_net).toBe(0);
    expect(rows.find((r) => r.lifecycle === 'paid').categoryHint).toBe('paid');
    expect(rows.find((r) => r.lifecycle === 'chargeback').categoryHint).toBe('cancelled');
    expect(rows.find((r) => r.lifecycle === 'missing').categoryHint).toBe('missing');
  });

  test('lifecycle currently-paid does not also emit Missing', () => {
    const { expandOverrideLifecycle } = require('../agencyOverrideReconMatch.cjs');
    const prod = { id: 7, client_name: 'Jane Doe', carrier: 'Aetna' };
    const overrides = [
      { id: 9, client_full_name: 'Jane Doe', carrier: 'Aetna', commission: 150 },
    ];
    const rows = expandOverrideLifecycle(prod, overrides);
    expect(rows).toHaveLength(1);
    expect(rows[0].lifecycle).toBe('paid');
  });

  test('rolling production duplicates collapse to one sale', () => {
    const { dedupeProductionSales, productionSaleKey } = require('../agencyOverrideReconMatch.cjs');
    const rows = dedupeProductionSales([
      {
        id: 1,
        client_name: 'RONALDO BALBOA',
        carrier: 'Devoted Health',
        effective_date: '2026-05-01',
        policy_number: 'DEV123',
        upload_date: '2026-06-01',
      },
      {
        id: 2,
        client_name: 'Balboa, Ronaldo',
        carrier: 'Devoted',
        effective_date: '2026-05-01',
        policy_number: 'DEV123',
        upload_date: '2026-08-01',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(2);
    expect(productionSaleKey(rows[0])).toContain('2026-05-01');
  });

  test('different eff dates stay as separate sales', () => {
    const { dedupeProductionSales } = require('../agencyOverrideReconMatch.cjs');
    const rows = dedupeProductionSales([
      {
        id: 1,
        client_name: 'RONALDO BALBOA',
        carrier: 'Devoted',
        effective_date: '2026-01-01',
        policy_number: 'A',
      },
      {
        id: 2,
        client_name: 'RONALDO BALBOA',
        carrier: 'Devoted',
        effective_date: '2026-05-01',
        policy_number: 'B',
      },
    ]);
    expect(rows).toHaveLength(2);
  });
});

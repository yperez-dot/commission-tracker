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
      { id: 1, client_full_name: 'Milagros Cambas De Rivas', carrier: 'Aetna', commission: 80, classification: 'Agency Override' },
      { id: 2, client_full_name: 'Milagros Cambas De Rivas', carrier: 'Aetna', commission: -80, classification: 'Chargeback' },
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
      { id: 9, client_full_name: 'Jane Doe', carrier: 'Aetna', commission: 150, classification: 'Agency Override' },
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

  test('lifecycle ignores New Business payee=THE rows (crash guard)', () => {
    const { expandOverrideLifecycle, isOverrideStatementRow } = require('../agencyOverrideReconMatch.cjs');
    expect(isOverrideStatementRow({ classification: 'New Business', payee: 'THE' })).toBe(false);
    const prod = { id: 9, client_name: 'Flood Client', carrier: 'Aetna' };
    const overrides = [];
    for (let i = 0; i < 200; i++) {
      overrides.push({
        id: i,
        client_full_name: 'Flood Client',
        carrier: 'Aetna',
        commission: 10,
        classification: 'New Business',
        payee: 'THE',
      });
    }
    overrides.push({
      id: 999,
      client_full_name: 'Flood Client',
      carrier: 'Aetna',
      commission: 80,
      classification: 'Agency Override',
    });
    const rows = expandOverrideLifecycle(prod, overrides);
    // Only the Agency Override expands — not 200 NB lines
    expect(rows).toHaveLength(1);
    expect(rows[0].lifecycle).toBe('paid');
    expect(rows[0].override.override_net).toBe(80);
  });
});

describe('three-way Hector → Carrier→BSI → THEI', () => {
  const {
    getThreeWayOverrideStatus,
    getOverrideReconCategory,
  } = require('../agencyOverrideReconMatch.cjs');

  test('Humana on Hector but not on BSI statements → not_paid_to_bsi / not_on_bsi tab', () => {
    const m = {
      production: { id: 1, client_name: 'Jane Humana', carrier: 'Humana', status: 'Active' },
      override: null,
      carrierBSI: null,
      carrierUploaded: true,
      lifecycle: 'missing',
      categoryHint: 'missing',
    };
    expect(getThreeWayOverrideStatus(m)).toBe('not_paid_to_bsi');
    expect(getOverrideReconCategory(m)).toBe('not_on_bsi');
  });

  test('on Hector + on Carrier→BSI $ + no THEI remittance → chase_bsi / chase tab', () => {
    const m = {
      production: { id: 2, client_name: 'Paid To BSI', carrier: 'Humana', status: 'Active' },
      override: null,
      carrierBSI: { commission: 150, classification: 'New Business' },
      carrierUploaded: true,
      lifecycle: 'missing',
      categoryHint: 'missing',
    };
    expect(getThreeWayOverrideStatus(m)).toBe('chase_bsi');
    expect(getOverrideReconCategory(m)).toBe('chase');
  });

  test('carrier BSI not uploaded yet → pending / missing tab', () => {
    const m = {
      production: { id: 3, client_name: 'No Upload', carrier: 'Humana', status: 'Active' },
      override: null,
      carrierBSI: null,
      carrierUploaded: false,
      lifecycle: 'missing',
      categoryHint: 'missing',
    };
    expect(getThreeWayOverrideStatus(m)).toBe('pending');
    expect(getOverrideReconCategory(m)).toBe('missing');
  });
});

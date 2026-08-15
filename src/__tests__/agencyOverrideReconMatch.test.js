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
      { client_full_name: 'Milagros Cambas De Rivas', carrier: 'Aetna', commission: -80, classification: 'Agency Override Chargeback' },
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
      { id: 2, client_full_name: 'Milagros Cambas De Rivas', carrier: 'Aetna', commission: -80, classification: 'Agency Override Chargeback' },
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

  test('Karl Brown: agent Chargeback does not pull house override net negative / false Chase', () => {
    const {
      isOverrideStatementRow,
      findOverrideMatch,
      isOverridePaid,
      getThreeWayOverrideStatus,
    } = require('../agencyOverrideReconMatch.cjs');
    const agentCb = {
      classification: 'Chargeback',
      commission: -347,
      upload_name: 'KR_UHC STATEMENT_FEBRUARY_2026.xlsx',
      client_full_name: 'Karl P. Brown',
      carrier: 'UnitedHealthcare',
    };
    const houseRows = [
      { id: 1, classification: 'Agency Override', commission: 75, upload_name: 'Statement-health experts (4).pdf', client_full_name: 'Karl P. Brown', carrier: 'UnitedHealthcare' },
      { id: 2, classification: 'Chargeback', commission: -75, upload_name: 'Medicare Statement -THE-March (3).pdf', client_full_name: 'Karl P. Brown', carrier: 'UnitedHealthcare' },
      { id: 3, classification: 'Agency Override', commission: 34.38, upload_name: 'Medicare Statement -THE-March (3).pdf', client_full_name: 'Karl P. Brown', carrier: 'UnitedHealthcare' },
      { id: 4, classification: 'Chargeback', commission: -21.88, upload_name: 'thei_statement_BSI_06.2026.csv', client_full_name: 'Karl P. Brown', carrier: 'UnitedHealthcare' },
    ];
    expect(isOverrideStatementRow(agentCb)).toBe(false);
    expect(houseRows.every(isOverrideStatementRow)).toBe(true);

    const prod = { id: 99, client_name: 'KARL BROWN', carrier: 'UnitedHealthcare', status: 'COMPLETED' };
    const wrongNet = findOverrideMatch(prod, [agentCb, ...houseRows]);
    expect(wrongNet.override_net).toBeCloseTo(-334.5, 1); // old bug: agent CB included

    const houseOnly = [agentCb, ...houseRows].filter(isOverrideStatementRow);
    const match = findOverrideMatch(prod, houseOnly);
    // House net = 75 - 75 + 34.38 - 21.88 = +12.50 → Paid, not Chase
    expect(match.override_net).toBeCloseTo(12.5, 2);
    expect(isOverridePaid(match)).toBe(true);
    const status = getThreeWayOverrideStatus({
      production: prod,
      override: match,
      lifecycle: 'missing',
      carrierBSI: { commission: 175 },
      carrierUploaded: true,
    });
    expect(status).toBe('paid');
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

  test('Humana on Hector but not on BSI statements → not_paid_to_bsi tag / Missing tab', () => {
    const m = {
      production: { id: 1, client_name: 'Jane Humana', carrier: 'Humana', status: 'Active' },
      override: null,
      carrierBSI: null,
      carrierUploaded: true,
      lifecycle: 'missing',
      categoryHint: 'missing',
    };
    expect(getThreeWayOverrideStatus(m)).toBe('not_paid_to_bsi');
    expect(getOverrideReconCategory(m)).toBe('missing');
  });

  test('on Hector + on Carrier→BSI $ + no THEI remittance → chase_bsi tag / Missing tab', () => {
    const m = {
      production: { id: 2, client_name: 'Paid To BSI', carrier: 'Humana', status: 'Active' },
      override: null,
      carrierBSI: { commission: 150, classification: 'New Business' },
      carrierUploaded: true,
      lifecycle: 'missing',
      categoryHint: 'missing',
    };
    expect(getThreeWayOverrideStatus(m)).toBe('chase_bsi');
    expect(getOverrideReconCategory(m)).toBe('missing');
  });

  test('carrier BSI not uploaded yet → pending / Missing tab', () => {
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

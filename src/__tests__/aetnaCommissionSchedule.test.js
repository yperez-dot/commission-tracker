'use strict';

const {
  AETNA_2027_MA,
  AETNA_2027_PDP,
  lookupAetnaMaRate,
  lookupAetnaPdpRate,
  resolveMaStateGroup,
  isAetnaCarrier,
} = require('../aetnaCommissionSchedule');

const { getCmsFmvCap } = require('../cmsFmvCaps');

const {
  expectedSaleCommission,
  resolveSalePaymentStatus,
} = require('../utils/salesReconPayment');

describe('aetnaCommissionSchedule 2027 Agent 4', () => {
  test('National AG4 matches the Highspot PDF', () => {
    const n = AETNA_2027_MA.National.AG4;
    expect(n).toEqual({ cmsNew: 725, base: 363, renewal: 363 });
  });

  test('CT/PA/DC and CA/NJ AG4 match the Highspot PDF', () => {
    expect(AETNA_2027_MA.CT_PA_DC.AG4).toEqual({ cmsNew: 816, base: 408, renewal: 408 });
    expect(AETNA_2027_MA.CA_NJ.AG4).toEqual({ cmsNew: 902, base: 451, renewal: 451 });
  });

  test('hierarchy steps down AG4 → AG1 on National', () => {
    expect(AETNA_2027_MA.National.AG3).toEqual({ cmsNew: 660, base: 330, renewal: 330 });
    expect(AETNA_2027_MA.National.AG2).toEqual({ cmsNew: 602, base: 301, renewal: 301 });
    expect(AETNA_2027_MA.National.AG1).toEqual({ cmsNew: 529, base: 265, renewal: 265 });
    expect(AETNA_2027_MA.National.LOA).toEqual({ cmsNew: 0, base: 0, renewal: 0 });
  });

  test('state groups', () => {
    expect(resolveMaStateGroup('FL')).toBe('National');
    expect(resolveMaStateGroup('TX')).toBe('National');
    expect(resolveMaStateGroup('CT')).toBe('CT_PA_DC');
    expect(resolveMaStateGroup('PA')).toBe('CT_PA_DC');
    expect(resolveMaStateGroup('DC')).toBe('CT_PA_DC');
    expect(resolveMaStateGroup('CA')).toBe('CA_NJ');
    expect(resolveMaStateGroup('NJ')).toBe('CA_NJ');
  });

  test('lookup is 2027-only', () => {
    expect(lookupAetnaMaRate({ planYear: 2026, state: 'FL' }).found).toBe(false);
    const hit = lookupAetnaMaRate({ effectiveDate: '2027-01-01', state: 'GA' });
    expect(hit.found).toBe(true);
    expect(hit.stateGroup).toBe('National');
    expect(hit.cmsNew).toBe(725);
    expect(hit.base).toBe(363);
  });

  test('new 2027 PDP is non-commissionable; 2024 persistency still pays', () => {
    const nb = lookupAetnaPdpRate({ effectiveDate: '2027-01-01' });
    expect(nb.nonCommissionable).toBe(true);
    expect(nb.cmsNew).toBe(0);
    expect(nb.renewal).toBe(0);

    const persist = lookupAetnaPdpRate({ effectiveDate: '2024-01-01' });
    expect(persist.found).toBe(true);
    expect(persist.renewal).toBe(52);
    expect(AETNA_2027_PDP.AG4.renewal2023).toBe(48);
    expect(AETNA_2027_PDP.AG4.renewal2020_2022).toBe(46);
  });

  test('isAetnaCarrier', () => {
    expect(isAetnaCarrier('Aetna')).toBe(true);
    expect(isAetnaCarrier('Aetna MAPD')).toBe(true);
    expect(isAetnaCarrier('UHC')).toBe(false);
  });
});

describe('cmsFmvCaps year-aware', () => {
  test('2026 National / CA unchanged', () => {
    expect(getCmsFmvCap('TX', 'initial', '2026-01-01')).toBe(694);
    expect(getCmsFmvCap('TX', 'renewal', 2026)).toBe(347);
    expect(getCmsFmvCap('CA', 'initial', 2026)).toBe(864);
  });

  test('2027 uses Agent 4 AG4 as CMS FMV', () => {
    expect(getCmsFmvCap('FL', 'initial', '2027-01-01')).toBe(725);
    expect(getCmsFmvCap('FL', 'renewal', '2027-01-01')).toBe(363);
    expect(getCmsFmvCap('CT', 'initial', 2027)).toBe(816);
    expect(getCmsFmvCap('CA', 'initial', 2027)).toBe(902);
    expect(getCmsFmvCap('NJ', 'renewal', 2027)).toBe(451);
  });
});

describe('salesReconPayment Aetna 2027', () => {
  test('2026 MA (any carrier) still uses $347', () => {
    expect(expectedSaleCommission({ effective_date: '2026-01-01', carrier: 'Aetna' }).amount).toBe(347);
    expect(expectedSaleCommission({ effective_date: '2026-07-01', policy_type: 'Medicare Advantage' }).amount).toBe(173.5);
  });

  test('2027 Aetna National Jan NB expected = Base $363, cap = CMS New $725', () => {
    const nb = expectedSaleCommission({
      effective_date: '2027-01-01',
      carrier: 'Aetna',
      policy_type: 'Medicare Advantage',
      state: 'FL',
    });
    expect(nb.amount).toBe(363);
    expect(nb.fullYear).toBe(725);
    expect(nb.aetna.stateGroup).toBe('National');
    expect(resolveSalePaymentStatus({ expected: nb.amount, actualNet: 363, fullYear: nb.fullYear }).id).toBe('paid');
    expect(resolveSalePaymentStatus({ expected: nb.amount, actualNet: 725, fullYear: nb.fullYear }).id).toBe('paid');
    expect(resolveSalePaymentStatus({ expected: nb.amount, actualNet: 727, fullYear: nb.fullYear }).id).toBe('overpaid');
  });

  test('2027 Aetna CA Jan NB uses CA/NJ Base $451', () => {
    const nb = expectedSaleCommission({
      effective_date: '2027-01-01',
      carrier: 'Aetna',
      policy_type: 'MAPD',
      state: 'CA',
    });
    expect(nb.amount).toBe(451);
    expect(nb.fullYear).toBe(902);
  });

  test('2027 Aetna National July NB prorates Base $363', () => {
    const nb = expectedSaleCommission({
      effective_date: '2027-07-01',
      carrier: 'Aetna',
      policy_type: 'Medicare Advantage',
      state: 'TX',
    });
    expect(nb.amount).toBe(181.5);
    expect(nb.prorated).toBe(true);
    expect(nb.fullYear).toBe(725);
  });

  test('2027 Aetna new PDP is $0', () => {
    const pdp = expectedSaleCommission({
      effective_date: '2027-01-01',
      carrier: 'Aetna',
      policy_type: 'PDP',
    });
    expect(pdp.kind).toBe('pdp');
    expect(pdp.amount).toBe(0);
    expect(pdp.note).toMatch(/non-commissionable/i);
  });
});

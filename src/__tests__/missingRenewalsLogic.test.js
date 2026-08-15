'use strict';

const {
  normName,
  normCarrier,
  nameVariants,
  namesLooseMatch,
  buildMissingRenewalRows,
  buildMissingRenewalsPeriodOptions,
  monthsBetweenPeriods,
  isTheiPrincipalAgent,
} = require('../missingRenewalsLogic');

describe('missingRenewalsLogic', () => {
  test('normName handles LAST, FIRST and trailing initial', () => {
    expect(normName('GARCIA, MARIA L.')).toBe('Maria Garcia');
    expect(normName('Maria Garcia')).toBe('Maria Garcia');
  });

  test('nameVariants includes reversed order', () => {
    const v = nameVariants('Hector Proano');
    expect(v).toContain('Hector Proano');
    expect(v).toContain('Proano Hector');
  });

  test('namesLooseMatch requires 2 shared tokens (not last-name-only)', () => {
    expect(namesLooseMatch('Maria Garcia', 'Jose Garcia')).toBe(false);
    expect(namesLooseMatch('Maria Garcia Lopez', 'Garcia, Maria')).toBe(true);
    expect(namesLooseMatch('Hector Proano', 'Proano Hector')).toBe(true);
  });

  test('normCarrier families', () => {
    expect(normCarrier('UnitedHealthcare')).toBe('unitedhealthcare');
    expect(normCarrier('UHC')).toBe('unitedhealthcare');
    expect(normCarrier('Doctors HealthCare Plans')).toBe('doctors healthcare');
  });

  test('monthsBetweenPeriods', () => {
    expect(monthsBetweenPeriods('202501', '202603')).toBe(14);
    expect(monthsBetweenPeriods('202603', '202601')).toBe(0);
  });

  test('isTheiPrincipalAgent', () => {
    expect(isTheiPrincipalAgent('Yahoska Perez')).toBe(true);
    expect(isTheiPrincipalAgent('Katy Robles')).toBe(true);
    expect(isTheiPrincipalAgent('Alan Elchami')).toBe(false);
  });

  test('buildMissingRenewalRows marks missing vs paid and skips first-year', () => {
    const bobClients = [
      {
        id: 1,
        client_full_name: 'Alice Example',
        agent_name: 'Yahoska Perez',
        carrier: 'UnitedHealthcare',
        effective_date: '2024-01-01',
        last_commission_date: '202512',
        last_commission_amount: 50,
        months_missing: 0,
      },
      {
        id: 2,
        client_full_name: 'Bob Missing',
        agent_name: 'Katy Robles',
        carrier: 'Humana',
        effective_date: '2024-01-01',
        last_commission_date: '202511',
        last_commission_amount: 40,
        months_missing: 1,
      },
      {
        id: 3,
        client_full_name: 'New Enrollee',
        agent_name: 'Yahoska Perez',
        carrier: 'Aetna',
        effective_date: '2026-01-01',
        last_commission_date: null,
        last_commission_amount: 0,
        months_missing: 0,
      },
    ];
    const periodRecords = [
      {
        id: 10,
        client_full_name: 'Example, Alice',
        carrier: 'UHC',
        commission: 50,
        classification: 'Renewal',
        lob: 'MA',
        payment_period: '202601',
      },
    ];
    const result = buildMissingRenewalRows({
      bobClients,
      periodRecords,
      period: '202601',
      heldKeySet: new Set(),
      policyStatusMap: {},
    });
    expect(result.rows).toHaveLength(2); // new enrollee skipped (<12 mo)
    const alice = result.rows.find((r) => r.client === 'Alice Example');
    const bob = result.rows.find((r) => r.client === 'Bob Missing');
    expect(alice.isMissing).toBe(false);
    expect(alice.commission).toBe(50);
    expect(bob.isMissing).toBe(true);
    expect(bob.monthsMissing).toBe(2); // 202511 → 202601
  });

  test('Held-only match stays missing/held, not paid', () => {
    const bobClients = [
      {
        id: 1,
        client_full_name: 'Held Client',
        agent_name: 'Yahoska Perez',
        carrier: 'UnitedHealthcare',
        effective_date: '2024-01-01',
        last_commission_date: '202512',
        last_commission_amount: 50,
      },
    ];
    const periodRecords = [
      {
        id: 1,
        client_full_name: 'Held Client',
        carrier: 'UnitedHealthcare',
        commission: 0,
        classification: 'Held',
        lob: 'MA',
        payment_period: '202601',
      },
    ];
    const result = buildMissingRenewalRows({
      bobClients,
      periodRecords,
      period: '202601',
      heldKeySet: new Set([`${normName('Held Client')}|${normCarrier('UnitedHealthcare')}`]),
      policyStatusMap: {},
    });
    expect(result.rows[0].isMissing).toBe(true);
    expect(result.rows[0].isHeld).toBe(true);
  });

  test('buildMissingRenewalsPeriodOptions skips stub months for default', () => {
    const { periods, defaultPeriod } = buildMissingRenewalsPeriodOptions([
      { payment_period: '202609', record_count: 2 },
      { payment_period: '202608', record_count: 1 },
      { payment_period: '202607', record_count: 570 },
      { payment_period: '202606', record_count: 744 },
    ]);
    expect(defaultPeriod).toBe('202607');
    expect(periods.find((p) => p.period === '202609').viable).toBe(false);
    expect(periods.find((p) => p.period === '202607').viable).toBe(true);
  });
});

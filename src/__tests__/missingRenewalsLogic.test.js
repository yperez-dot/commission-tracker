'use strict';

const {
  normName,
  normCarrier,
  nameVariants,
  namesLooseMatch,
  buildMissingRenewalRows,
  buildMissingRenewalsPeriodOptions,
  buildLastPaidLookup,
  monthsBetweenPeriods,
  isTheiPrincipalAgent,
  normPeriod,
  countsAsRenewalPaid,
  clientCarrierKey,
  heldIdentityKey,
  dedupeBobClients,
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

  test('normPeriod accepts YYYYMM, slash, ISO date, and named months', () => {
    expect(normPeriod('202605')).toBe('202605');
    expect(normPeriod('05/2026')).toBe('202605');
    expect(normPeriod('2026-04-01')).toBe('202604');
    expect(normPeriod('May 2026')).toBe('202605');
    expect(normPeriod(new Date(Date.UTC(2026, 3, 1)))).toBe('202604');
  });

  test('monthsBetweenPeriods', () => {
    expect(monthsBetweenPeriods('202501', '202603')).toBe(14);
    expect(monthsBetweenPeriods('202603', '202601')).toBe(0);
    expect(monthsBetweenPeriods('2026-04-01', '202605')).toBe(1);
  });

  test('isTheiPrincipalAgent', () => {
    expect(isTheiPrincipalAgent('Yahoska Perez')).toBe(true);
    expect(isTheiPrincipalAgent('Katy Robles')).toBe(true);
    expect(isTheiPrincipalAgent('Alan Elchami')).toBe(false);
  });

  test('countsAsRenewalPaid excludes Override / Chargeback / Held', () => {
    expect(countsAsRenewalPaid('Renewal')).toBe(true);
    expect(countsAsRenewalPaid('Held')).toBe(false);
    expect(countsAsRenewalPaid('Agency Override')).toBe(false);
    expect(countsAsRenewalPaid('Chargeback')).toBe(false);
    expect(countsAsRenewalPaid('Agent Chargeback')).toBe(false);
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
    expect(bob.lastKnownCommission).toBe(40);
    expect(result.summary.estimatedMissing).toBe(40);
    expect(result.summary.paidCommission).toBe(50);
  });

  test('clientNameKey matches LAST, FIRST ↔ FIRST LAST for period pay', () => {
    const bobClients = [
      {
        id: 1,
        client_full_name: 'BEVERLY SWITZ',
        agent_name: 'Yahoska Perez',
        carrier: 'UnitedHealthcare',
        effective_date: '2023-09-01',
        last_commission_date: null,
        last_commission_amount: 0,
      },
    ];
    const periodRecords = [
      {
        id: 99,
        client_full_name: 'SWITZ, BEVERLY',
        carrier: 'UnitedHealthcare',
        commission: 32.34,
        classification: 'Renewal',
        lob: 'MedSupp',
        payment_period: '202605',
      },
    ];
    const result = buildMissingRenewalRows({
      bobClients,
      periodRecords,
      period: '202605',
      heldKeySet: new Set(),
      policyStatusMap: {},
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].isMissing).toBe(false);
    expect(result.rows[0].commission).toBe(32.34);
  });

  test('later-month BOB last paid does NOT clear an earlier unpaid month', () => {
    const bobClients = [
      {
        id: 1,
        client_full_name: 'BEVERLY SWITZ',
        agent_name: 'Yahoska Perez',
        carrier: 'UnitedHealthcare',
        effective_date: '2023-09-01',
        last_commission_date: '202607',
        last_commission_amount: 36.63,
      },
    ];
    const result = buildMissingRenewalRows({
      bobClients,
      periodRecords: [],
      period: '202605',
      heldKeySet: new Set(),
      policyStatusMap: {},
    });
    expect(result.rows[0].isMissing).toBe(true);
    expect(result.rows[0].lastPaidPeriod).toBe('202607');
    // months missing is 0 because last paid is after the check month
    expect(result.rows[0].monthsMissing).toBe(0);
  });

  test('live lastPaidByKey enriches New badge data without clearing May gap', () => {
    const bobClients = [
      {
        id: 1,
        client_full_name: 'BEVERLY SWITZ',
        agent_name: 'Yahoska Perez',
        carrier: 'UnitedHealthcare',
        effective_date: '2023-09-01',
        last_commission_date: null,
        last_commission_amount: 0,
      },
    ];
    const lastPaidByKey = buildLastPaidLookup([
      {
        client_full_name: 'SWITZ, BEVERLY',
        carrier: 'UnitedHealthcare',
        payment_period: '202606',
        commission: 32.34,
        classification: 'Renewal',
      },
      {
        client_full_name: 'SWITZ, BEVERLY',
        carrier: 'UnitedHealthcare',
        payment_period: '202606',
        commission: 4.29,
        classification: 'Renewal',
      },
      {
        client_full_name: 'SWITZ, BEVERLY',
        carrier: 'UnitedHealthcare',
        payment_period: '202607',
        commission: 32.34,
        classification: 'Renewal',
      },
    ]);
    const result = buildMissingRenewalRows({
      bobClients,
      periodRecords: [],
      period: '202605',
      heldKeySet: new Set(),
      policyStatusMap: {},
      lastPaidByKey,
    });
    expect(result.rows[0].isMissing).toBe(true);
    expect(result.rows[0].lastPaidPeriod).toBe('202607');
    expect(result.rows[0].lastKnownCommission).toBe(32.34);
    expect(result.summary.estimatedMissing).toBe(32.34);
  });

  test('Agency Override alone does not count as renewal paid', () => {
    const bobClients = [
      {
        id: 1,
        client_full_name: 'Darren Rodgers',
        agent_name: 'Yahoska Perez',
        carrier: 'UnitedHealthcare',
        effective_date: '2023-01-01',
        last_commission_date: '202604',
        last_commission_amount: 4,
      },
    ];
    const periodRecords = [
      {
        id: 1,
        client_full_name: 'Darren Rodgers',
        carrier: 'UnitedHealthcare',
        commission: 4,
        classification: 'Agency Override',
        payment_period: '202605',
      },
    ];
    const result = buildMissingRenewalRows({
      bobClients,
      periodRecords,
      period: '202605',
      heldKeySet: new Set(),
      policyStatusMap: {},
    });
    expect(result.rows[0].isMissing).toBe(true);
  });

  test('Held key matches across LAST, FIRST formats via clientNameKey', () => {
    const bobClients = [
      {
        id: 1,
        client_full_name: 'WOODCOCK TIM M',
        agent_name: 'Yahoska Perez',
        carrier: 'Humana',
        effective_date: '2023-03-01',
        last_commission_date: '202604',
        last_commission_amount: 28.91,
      },
    ];
    const heldKey = heldIdentityKey('WOODCOCK, TIM M', 'Humana');
    const result = buildMissingRenewalRows({
      bobClients,
      periodRecords: [],
      period: '202605',
      heldKeySet: new Set([heldKey]),
      policyStatusMap: {},
    });
    expect(result.rows[0].isMissing).toBe(true);
    expect(result.rows[0].isHeld).toBe(true);
  });

  test('dedupeBobClients collapses WOODCOCK TIM M / TIM WOODCOCK', () => {
    const { clients, collapsedDuplicates } = dedupeBobClients([
      {
        id: 1,
        client_full_name: 'WOODCOCK TIM M',
        carrier: 'Humana',
        effective_date: '2023-03-01',
        last_commission_date: '202604',
        last_commission_amount: 28.91,
      },
      {
        id: 2,
        client_full_name: 'TIM WOODCOCK',
        carrier: 'Humana',
        effective_date: '2025-04-01',
        last_commission_date: null,
        last_commission_amount: 0,
      },
    ]);
    expect(collapsedDuplicates).toBe(1);
    expect(clients).toHaveLength(1);
    expect(clients[0].id).toBe(1);
    expect(clientCarrierKey('WOODCOCK TIM M', 'Humana')).toBe(
      clientCarrierKey('TIM WOODCOCK', 'Humana')
    );
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
      heldKeySet: new Set([heldIdentityKey('Held Client', 'UnitedHealthcare')]),
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

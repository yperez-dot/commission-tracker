'use strict';

const {
  PAYMENT_TOLERANCE,
  buildDepositTimeline,
  expectedSaleCommission,
  resolveSalePaymentStatus,
  sumCommissionNet,
  groupClientDeposits,
  countSplitDepositClients,
} = require('../utils/salesReconPayment');

describe('salesReconPayment', () => {
  test('sumCommissionNet ignores override rows by default', () => {
    const rows = [
      { commission: 55, classification: 'New Business' },
      { commission: 292, classification: 'Renewal' },
      { commission: 100, classification: 'Agency Override' },
    ];
    expect(sumCommissionNet(rows)).toBe(347);
  });

  test('buildDepositTimeline lists periods', () => {
    const tl = buildDepositTimeline([
      { commission: 55, payment_period: '202607', classification: 'New Business' },
      { commission: 292, payment_period: '202608', classification: 'Renewal' },
    ]);
    expect(tl).toHaveLength(2);
    expect(tl[0].period).toBe('202607');
    expect(tl[1].amount).toBe(292);
  });

  test('Med Supp uses UHC AARP Year-1 schedule — not $347 MA', () => {
    const ms = expectedSaleCommission({
      effective_date: '2026-07-01',
      policy_type: 'Medicare Supplement',
      plan_name: 'Plan G',
      state: 'FL',
    });
    expect(ms.kind).toBe('med_supp');
    expect(ms.amount).toBe(582);
    expect(ms.fullYear).toBe(582);
    expect(ms.medSupp.tableKey).toBe('FL-1');
    expect(resolveSalePaymentStatus({ expected: ms.amount, actualNet: 55, fullYear: ms.fullYear }).id).toBe('partial');
    expect(resolveSalePaymentStatus({ expected: ms.amount, actualNet: 582, fullYear: ms.fullYear }).id).toBe('paid');
  });

  test('Med Supp Plan N FL Area 2', () => {
    const ms = expectedSaleCommission({
      policy_type: 'Medicare Supplement',
      plan_name: 'AARP Med Supp Plan N',
      state: 'FL',
      area: 2,
    });
    expect(ms.amount).toBe(320.5);
  });

  test('Med Supp without plan letter stays null (Received)', () => {
    const ms = expectedSaleCommission({
      effective_date: '2026-07-01',
      policy_type: 'Medicare Supplement',
    });
    expect(ms.kind).toBe('med_supp');
    expect(ms.amount).toBeNull();
    expect(resolveSalePaymentStatus({ expected: ms.amount, actualNet: 55 }).label).toBe('Received');
  });

  test('MA July still prorates $347', () => {
    const ma = expectedSaleCommission({
      effective_date: '2026-07-01',
      policy_type: 'Medicare Advantage',
    });
    expect(ma.amount).toBe(173.5);
    const jul = expectedSaleCommission({ effective_date: '2026-07-01' });
    expect(jul.amount).toBe(173.5);
    expect(jul.remainingMonths).toBe(6);
    expect(jul.prorated).toBe(true);
    expect(expectedSaleCommission({ effective_date: '2026-01-01' }).amount).toBe(347);
    expect(expectedSaleCommission({ effective_date: '2026-12-01' }).amount).toBe(28.92);
  });

  test('July $55 is partial vs prorated $173.50 — not vs $347', () => {
    const expected = expectedSaleCommission({ effective_date: '2026-07-01' }).amount;
    const st = resolveSalePaymentStatus({ expected, actualNet: 55, fullYear: 347 });
    expect(st.id).toBe('partial');
    expect(st.remaining).toBeCloseTo(118.5, 1);
  });

  test('July paid at prorated amount is paid in full (not short vs $347)', () => {
    const expected = expectedSaleCommission({ effective_date: '2026-07-01' }).amount;
    expect(resolveSalePaymentStatus({ expected, actualNet: 173.5, fullYear: 347 }).id).toBe('paid');
    expect(resolveSalePaymentStatus({ expected, actualNet: 347, fullYear: 347 }).id).toBe('paid');
  });

  test('resolveSalePaymentStatus generic unpaid/partial/paid', () => {
    expect(resolveSalePaymentStatus({ expected: 347, actualNet: 0 }).id).toBe('unpaid');
    expect(resolveSalePaymentStatus({ expected: 347, actualNet: 55 }).id).toBe('partial');
    expect(resolveSalePaymentStatus({ expected: 347, actualNet: 55 }).remaining).toBeCloseTo(292, 0);
    expect(resolveSalePaymentStatus({ expected: 347, actualNet: 347 }).id).toBe('paid');
    expect(resolveSalePaymentStatus({ expected: 347, actualNet: 346.5 }).id).toBe('paid');
    expect(resolveSalePaymentStatus({ expected: 347, actualNet: 346.5 - PAYMENT_TOLERANCE }).id).toBe('partial');
  });

  test('groupClientDeposits for Lina-style multi-period pay', () => {
    const groups = groupClientDeposits(
      [
        { client_full_name: 'Jane Doe', policy_number: 'P1', payment_period: '202607', producer_payable: 40 },
        { client_full_name: 'Jane Doe', policy_number: 'P1', payment_period: '202608', producer_payable: 307 },
      ],
      (r) => parseFloat(r.producer_payable)
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].deposits).toHaveLength(2);
    expect(groups[0].total).toBe(347);
    expect(countSplitDepositClients(
      [
        { client_full_name: 'Jane Doe', policy_number: 'P1', payment_period: '202607', producer_payable: 40 },
        { client_full_name: 'Jane Doe', policy_number: 'P1', payment_period: '202608', producer_payable: 307 },
      ],
      (r) => parseFloat(r.producer_payable)
    )).toBe(1);
  });
});

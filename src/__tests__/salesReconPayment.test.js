'use strict';

const {
  PAYMENT_TOLERANCE,
  buildDepositTimeline,
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

  test('resolveSalePaymentStatus partial vs paid in full', () => {
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

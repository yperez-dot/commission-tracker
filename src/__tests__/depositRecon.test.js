const { reconcileDeposits, validateDeposit, depositWarnings } = require('../depositRecon');

describe('deposit reconciliation', () => {
  const expected = [{ payer: 'BSI', expected: 500 }, { payer: 'Aetna', expected: 120 }];

  test('matches deposits to payers for the period', () => {
    const r = reconcileDeposits({
      period: '202609', expected,
      deposits: [
        { id: 1, payer: 'BSI', amount: 300, allocations: [{ payment_period: '202609', amount: 300 }] },
        { id: 2, payer: 'BSI', amount: 200, allocations: [{ payment_period: '202609', amount: 200 }] },
        { id: 3, payer: 'Aetna', amount: 100, allocations: [{ payment_period: '202609', amount: 100 }] },
      ],
    });
    const bsi = r.rows.find((x) => x.payer === 'BSI');
    expect(bsi).toMatchObject({ expected: 500, received: 500, difference: 0, ok: true });
    const aetna = r.rows.find((x) => x.payer === 'Aetna');
    expect(aetna).toMatchObject({ received: 100, difference: -20, ok: false });
    expect(depositWarnings(r).map((w) => w.payer)).toEqual(['Aetna']);
  });

  test('one deposit split across two periods', () => {
    const dep = { id: 1, payer: 'BSI', amount: 800, allocations: [{ payment_period: '202608', amount: 300 }, { payment_period: '202609', amount: 500 }] };
    const sep = reconcileDeposits({ period: '202609', expected, deposits: [dep] });
    expect(sep.rows.find((x) => x.payer === 'BSI').received).toBe(500);
    const aug = reconcileDeposits({ period: '202608', expected: [{ payer: 'BSI', expected: 300 }], deposits: [dep] });
    expect(aug.rows[0].ok).toBe(true);
    expect(sep.unmatched).toEqual([]);
  });

  test('unallocated deposits are listed as unmatched', () => {
    const r = reconcileDeposits({
      period: '202609', expected,
      deposits: [
        { id: 7, payer: 'Other', payer_other: 'Test Carrier', amount: 50, allocations: [] },
        { id: 8, payer: 'BSI', amount: 600, allocations: [{ payment_period: '202609', amount: 500 }] },
      ],
    });
    expect(r.unmatched.map((u) => [u.id, u.unallocated])).toEqual([[7, 50], [8, 100]]);
    expect(r.unmatched[0].payer).toBe('Test Carrier');
  });

  test('payer with a deposit but nothing expected shows a difference', () => {
    const r = reconcileDeposits({
      period: '202609', expected: [],
      deposits: [{ id: 1, payer: 'Humana', amount: 40, allocations: [{ payment_period: '202609', amount: 40 }] }],
    });
    expect(r.rows[0]).toMatchObject({ payer: 'Humana', expected: 0, received: 40, difference: 40, ok: false });
  });

  test('validation', () => {
    const base = { depositDate: '2026-10-05', payer: 'BSI', amount: 100, allocations: [{ period: '202609', amount: 100 }] };
    expect(validateDeposit(base)).toBeNull();
    expect(validateDeposit(Object.assign({}, base, { allocations: [{ period: '202609', amount: 150 }] }))).toMatch(/more than/);
    expect(validateDeposit(Object.assign({}, base, { payer: 'Other' }))).toMatch(/payer name/);
    expect(validateDeposit(Object.assign({}, base, { amount: 0 }))).toMatch(/greater than 0/);
  });
});

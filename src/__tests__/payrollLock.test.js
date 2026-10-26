const {
  computeCarryWithLocks, suggestCorrection, validateAdjustment, adjustmentTotalsByPeriod, lockSnapshot,
  PAYMENT_METHODS, isMethod,
} = require('../payrollLock');

const lockFrom = (c) => Object.assign({ id: 1 }, lockSnapshot(c, { paidAmount: c.payable }));

describe('month lock freezes figures', () => {
  test('locked month reports its snapshot, not recomputed data', () => {
    const data = { '202609': 100 };
    const sep = computeCarryWithLocks(data, {}, {}, '202609', '202609');
    const locks = { '202609': lockFrom(sep) };
    // late rows / re-upload change September's data after it was paid
    const later = computeCarryWithLocks({ '202609': 130 }, {}, locks, '202609', '202609');
    expect(later.locked).toBe(true);
    expect(later.payable).toBe(100);
    expect(later.dataTotal).toBe(100);
    expect(later.liveDataTotal).toBe(130);
    expect(later.dataDrift).toBe(30);
  });

  test('adjustments added after lock do not change the locked month', () => {
    const sep = computeCarryWithLocks({ '202609': 100 }, {}, {}, '202609', '202609');
    const locks = { '202609': lockFrom(sep) };
    expect(computeCarryWithLocks({ '202609': 100 }, { '202609': -40 }, locks, '202609', '202609').payable).toBe(100);
  });
});

describe('carry uses the locked balance', () => {
  test('carry into October comes from September\'s frozen carry-out', () => {
    const sep = computeCarryWithLocks({ '202609': -50 }, {}, {}, '202609', '202609');
    expect(sep.carryOut).toBe(-50);
    const locks = { '202609': lockFrom(sep) };
    // September data later improves to +20; the locked -50 still carries
    const oct = computeCarryWithLocks({ '202609': 20, '202610': 200 }, {}, locks, '202610', '202609');
    expect(oct.carryIn).toBe(-50);
    expect(oct.payable).toBe(150);
  });

  test('unlocked months still recompute', () => {
    const oct = computeCarryWithLocks({ '202609': 20, '202610': 200 }, {}, {}, '202610', '202609');
    expect(oct.carryIn).toBe(0);
    expect(oct.payable).toBe(200);
  });

  test('adjustments count in totals and carry', () => {
    const r = computeCarryWithLocks({ '202609': 30, '202610': 100 }, { '202609': -80 }, {}, '202610', '202609');
    expect(r.carryIn).toBe(-50);
    expect(r.payable).toBe(50);
    const sep = computeCarryWithLocks({ '202609': 30 }, { '202609': -80 }, {}, '202609', '202609');
    expect(sep).toMatchObject({ dataTotal: 30, adjustmentsTotal: -80, periodTotal: -50, payable: 0, carryOut: -50 });
  });

  test('matches the old computeCarry when nothing is locked or adjusted', () => {
    const { computeCarry } = require('../payeeCarryForward');
    const t = { '202609': -30, '202610': -20, '202611': 100 };
    const a = computeCarry(t, '202611', '202609');
    const b = computeCarryWithLocks(t, {}, {}, '202611', '202609');
    expect(b.carryIn).toBe(a.carryIn);
    expect(b.payable).toBe(a.payable);
    expect(b.carryOut).toBe(a.carryOut);
  });
});

describe('prior-period correction suggestion', () => {
  test('difference between live and locked, minus corrections already posted', () => {
    expect(suggestCorrection(100, 130, [])).toBe(30);
    expect(suggestCorrection(100, 130, [{ amount: 30 }])).toBe(0);
    expect(suggestCorrection(100, 75, [{ amount: -10 }])).toBe(-15);
    expect(suggestCorrection(100, 100, [])).toBe(0);
  });
});

describe('adjustment validation', () => {
  const ok = { period: '202610', agent: 'Test Agent', amount: -25, reason: 'Clawback pending', category: 'clawback_not_on_file' };
  test('valid adjustment passes', () => expect(validateAdjustment(ok, false)).toBeNull());
  test('reason required', () => expect(validateAdjustment(Object.assign({}, ok, { reason: ' ' }), false)).toMatch(/reason/));
  test('category must be known', () => expect(validateAdjustment(Object.assign({}, ok, { category: 'bonus' }), false)).toMatch(/category/));
  test('prior-period correction needs the corrected period', () => {
    expect(validateAdjustment(Object.assign({}, ok, { category: 'prior_period_correction' }), false)).toMatch(/period it corrects/);
    expect(validateAdjustment(Object.assign({}, ok, { category: 'prior_period_correction', correctsPeriod: '202609' }), false)).toBeNull();
  });
  test('locked month refuses new adjustments', () => expect(validateAdjustment(ok, true)).toMatch(/sent or closed/));
  test('voided adjustments are excluded from totals', () => {
    expect(adjustmentTotalsByPeriod([
      { payment_period: '202610', amount: -25 },
      { payment_period: '202610', amount: 10 },
      { payment_period: '202610', amount: 99, status: 'void' },
    ])).toEqual({ '202610': -15 });
  });
});

describe('payment methods', () => {
  test('Sent to commissions is first; Check and ACH remain optional', () => {
    expect(PAYMENT_METHODS[0]).toEqual({ key: 'sent_to_commissions', label: 'Sent to commissions' });
    expect(isMethod('sent_to_commissions')).toBe(true);
    expect(isMethod('check')).toBe(true);
    expect(isMethod('ach')).toBe(true);
    expect(PAYMENT_METHODS.some((m) => m.key === 'check' && m.label === 'Check')).toBe(true);
    expect(PAYMENT_METHODS.some((m) => m.key === 'ach' && m.label === 'ACH')).toBe(true);
  });
});

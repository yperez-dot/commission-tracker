const { computeCarry } = require('../payeeCarryForward');

describe('carry forward', () => {
  test('negative month carries into next month', () => {
    const t = { '202609': -50, '202610': 200 };
    const sep = computeCarry(t, '202609', '202609');
    expect(sep).toMatchObject({ carryIn: 0, net: -50, payable: 0, carryOut: -50 });
    const oct = computeCarry(t, '202610', '202609');
    expect(oct).toMatchObject({ carryIn: -50, periodTotal: 200, net: 150, payable: 150, carryOut: 0 });
  });
  test('positive months never carry', () => {
    const t = { '202609': 100, '202610': 80 };
    expect(computeCarry(t, '202610', '202609').carryIn).toBe(0);
  });
  test('multi-month carry accumulates', () => {
    const t = { '202609': -30, '202610': -20, '202611': 100 };
    expect(computeCarry(t, '202611', '202609')).toMatchObject({ carryIn: -50, payable: 50 });
  });
  test('months before start are ignored', () => {
    const t = { '202607': -500, '202609': 100 };
    expect(computeCarry(t, '202609', '202609').carryIn).toBe(0);
  });
  test('period with no rows still reports carry', () => {
    expect(computeCarry({ '202609': -40 }, '202610', '202609')).toMatchObject({ carryIn: -40, net: -40, payable: 0 });
  });
});

/* Agent statements when a month nets negative ("Balance due from agent"). Synthetic amounts only. */
const {
  bottomLine, validateAdjustment, computeCarryWithLocks, lockSnapshot, adjustmentTotalsByPeriod,
  LABEL_PAYABLE, LABEL_BALANCE_DUE, categoryLabel,
} = require('../payrollLock');
const { attachAdjustments, statementNet } = require('../payrollStatementExtras');
const {
  buildIntegrityStatement, buildIntegrityWorkbook, payeeKeyForAgent,
} = require('../integrityStatement');
const { buildLinaCompensationStatement, buildLinaCompensationWorkbook } = require('../linaCompensationStatement');

const RED = 'FFB91C1C';
const lockFrom = (c) => Object.assign({ id: 1 }, lockSnapshot(c, { paidAmount: c.payable }));

function findRow(ws, text) {
  let hit = null;
  ws.eachRow((row) => { row.eachCell((cell) => { if (!hit && cell.value === text) hit = row; }); });
  return hit;
}

function integrityRow(over) {
  return Object.assign({
    id: 1, agent_name: 'Horacio Mendieta', classification: 'Chargeback', carrier: 'UnitedHealthcare',
    payment_period: '202610', producer_payable: -10, policy_number: 'P1', client_full_name: 'TEST, MEMBER',
  }, over);
}

describe('bottomLine', () => {
  test('negative net -> balance due, positive amount', () => {
    expect(bottomLine(-12.5)).toEqual({ net: -12.5, isBalanceDue: true, label: LABEL_BALANCE_DUE, amount: 12.5 });
    expect(LABEL_BALANCE_DUE).toBe('Balance due from agent');
  });
  test('zero and positive -> amount payable', () => {
    expect(bottomLine(0)).toMatchObject({ isBalanceDue: false, label: LABEL_PAYABLE, amount: 0 });
    expect(bottomLine(40)).toMatchObject({ isBalanceDue: false, label: 'Amount payable to agent', amount: 40 });
  });
});

describe('repayment from agent', () => {
  test('category exists and must be positive', () => {
    expect(categoryLabel('agent_repayment')).toBe('Repayment from agent');
    const base = { period: '202610', agent: 'Horacio Mendieta', category: 'agent_repayment', reason: 'Paid back by check' };
    expect(validateAdjustment(Object.assign({ amount: 10 }, base), false)).toBeNull();
    expect(validateAdjustment(Object.assign({ amount: -10 }, base), false)).toMatch(/positive/);
  });
  test('repayment cannot go into a locked month', () => {
    const r = validateAdjustment({ period: '202610', agent: 'X', category: 'agent_repayment', reason: 'r', amount: 10 }, true);
    expect(r).toBeTruthy();
  });
  test('locked negative month carries; a repayment in the next month clears it without touching the lock', () => {
    const sep = computeCarryWithLocks({ '202609': -30 }, {}, {}, '202609', '202609');
    expect(sep.payable).toBe(0);
    expect(sep.carryOut).toBe(-30);
    const locks = { '202609': lockFrom(sep) };
    // October: no new business, agent repays 30
    const adj = adjustmentTotalsByPeriod([{ payment_period: '202610', amount: 30, category: 'agent_repayment' }]);
    const oct = computeCarryWithLocks({ '202609': -30 }, adj, locks, '202610', '202609');
    expect(oct.carryIn).toBe(-30);
    expect(oct.net).toBe(0);
    expect(oct.carryOut).toBe(0);
    // September still reports its frozen snapshot
    const sepAgain = computeCarryWithLocks({ '202609': -30 }, adj, locks, '202609', '202609');
    expect(sepAgain.locked).toBe(true);
    expect(sepAgain.net).toBe(-30);
  });
  test('without a repayment the balance nets against the next month', () => {
    const sep = computeCarryWithLocks({ '202609': -30 }, {}, {}, '202609', '202609');
    const oct = computeCarryWithLocks({ '202609': -30, '202610': 100 }, {}, { '202609': lockFrom(sep) }, '202610', '202609');
    expect(oct.payable).toBe(70);
    expect(bottomLine(oct.net).label).toBe(LABEL_PAYABLE);
  });
});

describe('Integrity statement with a negative month', () => {
  test('chargeback-only month still builds and prints "Balance due from agent" in red', async () => {
    const st = buildIntegrityStatement([integrityRow({})], 'horacio-mendieta', { period: '202610' });
    expect(st.lineCount).toBe(1);
    attachAdjustments(st, []);
    st.carry = computeCarryWithLocks({ '202610': -10 }, {}, {}, '202610', '202609');
    expect(statementNet(st)).toBe(-10);
    const ws = (await buildIntegrityWorkbook(st)).getWorksheet('Compensation Statement');
    const due = findRow(ws, 'Balance due from agent');
    expect(due).not.toBeNull();
    expect(due.getCell(6).value).toBe(10);
    expect(due.getCell(6).font.color.argb).toBe(RED);
    expect(findRow(ws, 'Amount payable to agent')).toBeNull();
    expect(findRow(ws, 'Negative balance carried to next period').getCell(6).value).toBe(-10);
  });

  test('positive month prints "Amount payable to agent"', async () => {
    const st = buildIntegrityStatement([integrityRow({ classification: 'Agency Override', producer_payable: 50 })],
      'horacio-mendieta', { period: '202610' });
    attachAdjustments(st, []);
    const ws = (await buildIntegrityWorkbook(st)).getWorksheet('Compensation Statement');
    expect(findRow(ws, 'Amount payable to agent').getCell(6).value).toBe(50);
    expect(findRow(ws, 'Balance due from agent')).toBeNull();
  });

  test('zero net prints "Amount payable to agent" $0', async () => {
    const st = buildIntegrityStatement([
      integrityRow({ id: 1, classification: 'Agency Override', producer_payable: 20 }),
      integrityRow({ id: 2, policy_number: 'P2', producer_payable: -20 }),
    ], 'horacio-mendieta', { period: '202610' });
    attachAdjustments(st, []);
    const ws = (await buildIntegrityWorkbook(st)).getWorksheet('Compensation Statement');
    expect(findRow(ws, 'Amount payable to agent').getCell(6).value).toBe(0);
  });

  test('repayment line reduces the balance due on the statement', async () => {
    const st = buildIntegrityStatement([integrityRow({ producer_payable: -25 })], 'horacio-mendieta', { period: '202610' });
    attachAdjustments(st, [{ id: 9, payment_period: '202610', amount: 10, category: 'agent_repayment', reason: 'Partial repayment' }]);
    const ws = (await buildIntegrityWorkbook(st)).getWorksheet('Compensation Statement');
    expect(findRow(ws, 'Partial repayment')).not.toBeNull();
    expect(findRow(ws, 'Balance due from agent').getCell(6).value).toBe(15);
  });

  test('agent name with a middle initial / last-first still maps to the payee', () => {
    expect(payeeKeyForAgent('Horacio J Mendieta')).toBe('horacio-mendieta');
    expect(payeeKeyForAgent('MENDIETA, HORACIO')).toBe('horacio-mendieta');
    expect(payeeKeyForAgent('Christian A. Munoz')).toBe('christian-munoz');
    expect(payeeKeyForAgent('CAM Insurance Solutions Corp')).toBe('christian-munoz');
    expect(payeeKeyForAgent('Someone Else')).toBeNull();
  });
});

describe('Lina statement with a negative month', () => {
  test('summary and main sheet show the balance due', async () => {
    const rows = [{ id: 1, agent_name: 'Alba Hernandez', classification: 'Chargeback', carrier: 'UnitedHealthcare',
      payment_period: '202610', producer_payable: -40, policy_number: 'P1', client_full_name: 'TEST, MEMBER' }];
    const st = attachAdjustments(buildLinaCompensationStatement(rows, { period: '202610' }), []);
    const wb = await buildLinaCompensationWorkbook(st);
    const due = findRow(wb.worksheets[0], 'Balance due from agent');
    expect(due).not.toBeNull();
    expect(due.getCell(6).value).toBe(40);
    expect(findRow(wb.getWorksheet('Summary'), 'Balance due from agent').getCell(2).value).toBe(40);
  });
});

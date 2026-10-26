const {
  buildIntegrityStatement,
  buildIntegrityWorkbook,
  payeeKeyForAgent,
} = require('../integrityStatement');
const { compareStatementTotals } = require('../payeeStatementCompare');

const row = (o) => ({
  id: 1, agent_name: 'Christian Munoz', classification: 'Agency Override',
  carrier: 'UnitedHealthcare', payment_period: '202609', producer_payable: 10,
  policy_number: 'P1', client_full_name: 'A B', effective_date: '2026-01-01', ...o,
});

describe('integrity statements', () => {
  test('maps CAM to Munoz and Mendieta separately', () => {
    expect(payeeKeyForAgent('CAM Insurance Solutions Corp')).toBe('christian-munoz');
    expect(payeeKeyForAgent('Horacio Mendieta')).toBe('horacio-mendieta');
    expect(payeeKeyForAgent('Someone Else')).toBeNull();
  });

  test('sections per carrier, balances, chargebacks, CAM included for Munoz', () => {
    const rows = [
      row({ id: 1, producer_payable: 37.5 }),
      row({ id: 2, policy_number: 'P2', producer_payable: -18.75, classification: 'Chargeback' }),
      row({ id: 3, agent_name: 'CAM Insurance Solutions Corp', policy_number: 'P3', producer_payable: 20 }),
      row({ id: 4, carrier: 'Humana', policy_number: 'P4', producer_payable: 5 }),
      row({ id: 5, agent_name: 'Horacio Mendieta', producer_payable: 99 }),
      row({ id: 6, classification: 'Renewal', producer_payable: 50 }),
      row({ id: 7, payment_period: '202608', producer_payable: 7 }),
    ];
    const s = buildIntegrityStatement(rows, 'christian-munoz', { period: '202609' });
    expect(s.carrierSummary.map((c) => c.carrier)).toEqual(['UNITED HEALTH CARE', 'HUMANA/DEVOTED HEALTH']);
    expect(s.sections[0].balance).toBe(38.75);
    expect(s.sections[1].balance).toBe(5);
    expect(s.balance).toBe(43.75);
    expect(s.chargebacks).toBe(-18.75);
    expect(s.lineCount).toBe(4);
  });

  test('new-sale lines from BSI UHC / Aetna feeds are on the statement; renewals are not', () => {
    const rows = [
      row({ id: 21, classification: 'New Business', producer_payable: 75 }),
      row({ id: 22, policy_number: 'P22', classification: 'Renewal', producer_payable: 0 }),
      row({ id: 23, policy_number: 'P23', classification: 'Chargeback', producer_payable: -75 }),
    ];
    const s = buildIntegrityStatement(rows, 'christian-munoz', { period: '202609' });
    expect(s.lineCount).toBe(2);
    expect(s.balance).toBe(0);
  });

  test('Mendieta statement only has his own rows (not other writing agents)', () => {
    const rows = [
      row({ id: 31, agent_name: 'Horacio Mendieta', classification: 'New Business', producer_payable: 75 }),
      row({ id: 32, agent_name: 'Edgar Piloto', policy_number: 'P32', producer_payable: 5 }),
      row({ id: 33, agent_name: 'Mr. Edgar Piloto', policy_number: 'P33', producer_payable: 5 }),
      row({ id: 34, agent_name: 'Ivan Santiago', policy_number: 'P34', classification: 'Chargeback', producer_payable: -61.88 }),
    ];
    const s = buildIntegrityStatement(rows, 'horacio-mendieta', { period: '202609' });
    expect(s.lineCount).toBe(1);
    expect(s.balance).toBe(75);
    expect(payeeKeyForAgent('Edgar Piloto')).toBeNull();
    expect(payeeKeyForAgent('Ivan Santiago')).toBeNull();
  });

  test('exact duplicate ids are collapsed', () => {
    const r = row({ id: 9 });
    const s = buildIntegrityStatement([r, { ...r }], 'christian-munoz', { period: '202609' });
    expect(s.lineCount).toBe(1);
  });

  test('Integrity workbook does not use the agent-facing internal note lines', async () => {
    const s = buildIntegrityStatement([row({})], 'christian-munoz', { period: '202609' });
    const ws = (await buildIntegrityWorkbook(s)).getWorksheet('Compensation Statement');
    const texts = [];
    ws.eachRow((r) => r.eachCell((c) => { if (c.value != null) texts.push(String(c.value)); }));
    expect(texts.some((t) => /Same agent pay schedule as BSI/.test(t))).toBe(false);
    expect(texts.some((t) => /Agency Override and BSI licensing/.test(t))).toBe(false);
    expect(texts.some((t) => /not part of .+ statement/.test(t))).toBe(false);
    expect(texts).toContain('Total Payable');
    expect(texts).toContain('TOTAL');
  });
});

describe('statement comparison', () => {
  test('flags stale issued and BSI variance', () => {
    const c = compareStatementTotals({ liveTotal: 120, issuedTotal: 100, receivedTotal: 100 });
    expect(c.issuedStale).toBe(true);
    expect(c.staleBy).toBe(20);
    expect(c.matchesBsi).toBe(true);
    const d = compareStatementTotals({ liveTotal: 100, issuedTotal: null, receivedTotal: 90 });
    expect(d.varianceVsBsi).toBe(10);
    expect(d.matchesBsi).toBe(false);
  });
});

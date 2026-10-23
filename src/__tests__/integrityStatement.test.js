const {
  buildIntegrityStatement,
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
      row({ id: 6, classification: 'New Business', producer_payable: 50 }),
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

  test('exact duplicate ids are collapsed', () => {
    const r = row({ id: 9 });
    const s = buildIntegrityStatement([r, { ...r }], 'christian-munoz', { period: '202609' });
    expect(s.lineCount).toBe(1);
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

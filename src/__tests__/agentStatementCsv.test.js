'use strict';

const {
  buildAgentStatementCsv,
  statementFilename,
  isValidEmail,
} = require('../agentStatementCsv');

describe('agentStatementCsv', () => {
  test('builds CSV with net total and escapes quotes', () => {
    const csv = buildAgentStatementCsv('Patsy Pernia', [
      {
        policy_number: 'P1',
        client_full_name: 'Garcia, "Maria"',
        carrier: 'Humana',
        members: 1,
        effective_date: '2025-01-01',
        producer_payable: 50,
        classification: 'ACA Agent Commission',
      },
      {
        policy_number: 'P2',
        client_full_name: 'Other',
        carrier: 'Cigna',
        producer_payable: -10,
        classification: 'Chargeback',
      },
    ], 'Jul 2026');
    expect(csv).toContain('*** AGENT: Patsy Pernia ***');
    expect(csv).toContain('Period: Jul 2026');
    expect(csv).toContain('Garcia, ""Maria""');
    expect(csv).toContain('NET TOTAL');
    expect(csv).toContain('$40.00');
  });

  test('statementFilename and isValidEmail', () => {
    expect(statementFilename('Katy Robles', 'Jul 2026', false)).toBe(
      'THEI_Statement_Katy_Robles_Jul_2026.csv'
    );
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });
});

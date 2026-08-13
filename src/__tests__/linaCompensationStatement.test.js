'use strict';

const {
  buildLinaCompensationStatement,
  selectLinaAgentRows,
  filenameForLinaStatement,
} = require('../linaCompensationStatement');
const { ALBA_DISPLAY_NAME } = require('../payeeSchedules');

describe('linaCompensationStatement', () => {
  const rows = [
    {
      id: 1,
      agent_name: 'Alba Hernandez',
      client_full_name: 'CLIENT A',
      policy_number: 'P1',
      carrier: 'Humana',
      effective_date: '01/01/2026',
      payment_period: '202607',
      classification: 'New Business',
      producer_payable: 694,
    },
    {
      id: 2,
      agent_name: 'Alba Hernandez',
      client_full_name: 'CLIENT B',
      policy_number: 'P2',
      carrier: 'Aetna',
      effective_date: '12/01/2025',
      payment_period: '202607',
      classification: 'Renewal',
      producer_payable: 36,
    },
    {
      id: 3,
      agent_name: 'Alba Hernandez',
      client_full_name: 'CLIENT C',
      policy_number: 'P3',
      carrier: 'Humana',
      effective_date: '01/01/2026',
      payment_period: '202607',
      classification: 'Chargeback',
      producer_payable: -60,
    },
    {
      id: 4,
      agent_name: 'Alba Hernandez',
      client_full_name: 'CLIENT D',
      policy_number: 'P4',
      carrier: 'Humana',
      payment_period: '202607',
      classification: 'Agency Override',
      producer_payable: 180,
    },
    {
      id: 5,
      agent_name: 'Someone Else',
      classification: 'New Business',
      producer_payable: 100,
      payment_period: '202607',
    },
    {
      id: 6,
      agent_name: 'Lina Hernandez',
      client_full_name: 'CLIENT E',
      policy_number: 'P5',
      carrier: 'UnitedHealthcare',
      effective_date: '07/01/2026',
      payment_period: '202606',
      classification: 'New Business',
      producer_payable: 195.5,
    },
  ];

  it('selects Lina/Alba agent production only (excludes overrides and other agents)', () => {
    const selected = selectLinaAgentRows(rows, '202607');
    expect(selected.map((r) => r.id).sort()).toEqual([1, 2, 3]);
  });

  it('builds statement with report date, balance, and Lina payee', () => {
    const stmt = buildLinaCompensationStatement(rows, {
      period: '202607',
      reportDate: '08/13/2026',
    });
    expect(stmt.payee).toBe(ALBA_DISPLAY_NAME);
    expect(stmt.payee).toBe('Lina Hernandez');
    expect(stmt.reportDate).toBe('08/13/2026');
    expect(stmt.periodTitle).toBe('July 2026 Statement');
    expect(stmt.lineCount).toBe(3);
    expect(stmt.gross).toBe(730);
    expect(stmt.chargebacks).toBe(-60);
    expect(stmt.balance).toBe(670);
    expect(stmt.lines.every((l) => l.agency.includes('HEALTH EXPERTS'))).toBe(true);
    expect(stmt.lines.some((l) => l.company === 'UNITED HEALTH CARE')).toBe(false); // not in Jul set
    expect(stmt.lines.find((l) => l.policyNumber === 'P1').company).toBe('HUMANA');
  });

  it('filename uses Lina and period', () => {
    const stmt = buildLinaCompensationStatement(rows, { period: '202607', reportDate: '08/13/2026' });
    expect(filenameForLinaStatement(stmt)).toBe('Lina_Hernandez_Compensation_Statement_202607.xlsx');
  });

  it('includes Lina-named rows in other periods', () => {
    const stmt = buildLinaCompensationStatement(rows, { period: '202606', reportDate: '07/09/2026' });
    expect(stmt.lineCount).toBe(1);
    expect(stmt.balance).toBe(195.5);
    expect(stmt.lines[0].company).toBe('UNITED HEALTH CARE');
  });
});

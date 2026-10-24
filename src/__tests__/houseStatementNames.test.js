const { HOUSE_STATEMENT_NAMES, safeSheetName, houseStatementLabel, houseStatementFilename } = require('../houseStatementNames');
const { STATEMENT_TYPES } = require('../payeeSchedules');
const { filenameFor, statementToCsv, summaryToCsv, buildOverrideStatements } = require('../overrideStatementBuilder');

describe('house statement names', () => {
  test('exact labels, internal ids unchanged', () => {
    expect(houseStatementLabel(STATEMENT_TYPES.THEI_BSI)).toBe('THEI. BSI Statement');
    expect(houseStatementLabel(STATEMENT_TYPES.BSI_OVERRIDE)).toBe('BSI Medicare Overrides');
    expect(houseStatementLabel(STATEMENT_TYPES.THEI_NHP)).toBe('THEI. NHP Statement');
    expect(Object.keys(HOUSE_STATEMENT_NAMES).sort()).toEqual(['bsi_override', 'thei_bsi', 'thei_nhp']);
    expect(houseStatementLabel(STATEMENT_TYPES.MARCO)).toBeNull();
    expect(houseStatementLabel(STATEMENT_TYPES.INTEGRITY)).toBeNull();
  });

  test('file names are safe slugs', () => {
    expect(houseStatementFilename('thei_bsi', '202609')).toBe('THEI_BSI_Statement_202609.xlsx');
    expect(houseStatementFilename('bsi_override', '202609')).toBe('BSI_Medicare_Overrides_202609.xlsx');
    expect(houseStatementFilename('thei_nhp', '20260615')).toBe('THEI_NHP_Statement_20260615.xlsx');
    expect(houseStatementFilename('thei_nhp', 'all')).toBe('THEI_NHP_Statement_ALL.xlsx');
    expect(houseStatementFilename('marco', '202609')).toBeNull();
    for (const n of Object.values(HOUSE_STATEMENT_NAMES)) expect(n.slug).toMatch(/^[A-Za-z0-9_]+$/);
  });

  test('sheet names fit Excel rules', () => {
    for (const n of Object.values(HOUSE_STATEMENT_NAMES)) {
      expect(safeSheetName(n.label)).toBe(n.label);
      expect(n.label.length).toBeLessThanOrEqual(31);
      expect(n.label).not.toMatch(/[:\\/?*[\]]/);
    }
    expect(safeSheetName('A/B:C*D?E[F]G\\H')).toBe('A B C D E F G H');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
    expect(safeSheetName("'quoted'")).toBe('quoted');
    expect(safeSheetName('')).toBe('Statement');
  });

  test('CSV exports use the new names', () => {
    const rows = [{
      id: 1, agent_name: 'Agent A', client_full_name: 'CLIENT A', policy_number: 'P1', carrier: 'Humana',
      effective_date: '01/01/2026', payment_period: '202601', classification: 'Agency Override', source: 'BSI',
      commission: 100, thei_share: 50, bsi_share: 50, producer_payable: 0, sub_agent_override: 0,
    }];
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.BSI_OVERRIDE, { period: '202601' });
    expect(filenameFor(bundle, 'SUMMARY')).toBe('BSI_Medicare_Overrides_Summary_202601.csv');
    expect(filenameFor(bundle, bundle.statements[0].payee)).toBe('BSI_Medicare_Overrides_202601.csv');
    expect(statementToCsv(bundle, bundle.statements[0]).split('\n')[0]).toContain('BSI Medicare Overrides');
    expect(summaryToCsv(bundle).split('\n')[0]).toContain('BSI Medicare Overrides');
  });
});

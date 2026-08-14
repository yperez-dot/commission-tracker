'use strict';

const { STATEMENT_TYPES } = require('../payeeSchedules');
const { buildOverrideStatements } = require('../overrideStatementBuilder');
const {
  buildOverrideExcelWorkbook,
  filenameForOverrideExcel,
  titleFor,
} = require('../overrideExcelStatement');

const rows = [
  {
    id: 1,
    agent_name: 'Alba Hernandez',
    client_full_name: 'CLIENT A',
    policy_number: 'P1',
    carrier: 'Humana',
    effective_date: '01/01/2026',
    payment_period: '202601',
    classification: 'Agency Override',
    commission: 150,
    thei_share: 75,
    bsi_share: 75,
    producer_payable: 0,
    sub_agent_override: 0,
  },
  {
    id: 2,
    agent_name: 'Kelly Carpenter',
    client_full_name: 'CLIENT B',
    policy_number: 'P2',
    carrier: 'Humana',
    effective_date: '2026-07-01T00:00:00.000Z',
    payment_period: '202607',
    classification: 'Agency Override',
    commission: 100,
    thei_share: 45,
    bsi_share: 45,
    producer_payable: 0,
    sub_agent_override: 10,
  },
  {
    id: 3,
    agent_name: 'Christian Munoz',
    client_full_name: 'CLIENT C',
    policy_number: 'P3',
    carrier: 'UHC',
    effective_date: new Date(Date.UTC(2026, 0, 15)),
    payment_period: '202601',
    classification: 'Agency Override',
    commission: 200,
    thei_share: 50,
    bsi_share: 50,
    producer_payable: 100,
    sub_agent_override: 0,
  },
];

describe('overrideExcelStatement', () => {
  it('builds THEI workbook with formatted Effective column', async () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_OVERRIDE, {
      period: '202601',
    });
    expect(titleFor(bundle.type)).toMatch(/THEI/i);
    const stmt = bundle.statements[0];
    const wb = await buildOverrideExcelWorkbook(bundle, stmt, {
      reportDate: '08/13/2026',
    });
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Override Statement',
      'Summary',
    ]);
    expect(filenameForOverrideExcel(bundle, stmt.payee)).toBe(
      'THEI_Override_Statement_202601.xlsx'
    );
    const ws = wb.getWorksheet('Override Statement');
    expect(ws.getRow(11).getCell(5).value).toBe('Effective');
    expect(ws.getRow(12).getCell(5).value).toBe('01-01-2026');
  });

  it('builds Marco and Integrity Excel with effective dates', async () => {
    const marcoBundle = buildOverrideStatements(rows, STATEMENT_TYPES.MARCO, {
      period: '202607',
    });
    const marcoStmt = marcoBundle.statements[0];
    const marcoWb = await buildOverrideExcelWorkbook(marcoBundle, marcoStmt, {
      reportDate: '08/14/2026',
    });
    expect(titleFor(marcoBundle.type)).toMatch(/Marco/i);
    expect(filenameForOverrideExcel(marcoBundle, marcoStmt.payee)).toBe(
      'Marco_Override_Statement_202607.xlsx'
    );
    expect(marcoWb.getWorksheet('Override Statement').getRow(12).getCell(5).value).toBe(
      '07-01-2026'
    );

    const intBundle = buildOverrideStatements(rows, STATEMENT_TYPES.INTEGRITY, {
      period: '202601',
    });
    const intStmt = intBundle.statements[0];
    const intWb = await buildOverrideExcelWorkbook(intBundle, intStmt, {
      reportDate: '08/14/2026',
    });
    expect(titleFor(intBundle.type)).toMatch(/Integrity/i);
    expect(filenameForOverrideExcel(intBundle, intStmt.payee)).toBe(
      'Christian_Munoz_Override_Statement_202601.xlsx'
    );
    expect(intWb.getWorksheet('Override Statement').getRow(12).getCell(5).value).toBe(
      '01-15-2026'
    );
  });
});

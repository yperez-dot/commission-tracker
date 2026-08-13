'use strict';

const { STATEMENT_TYPES } = require('../payeeSchedules');
const { buildOverrideStatements } = require('../overrideStatementBuilder');
const {
  buildOverrideExcelWorkbook,
  filenameForOverrideExcel,
  titleFor,
} = require('../overrideExcelStatement');

describe('overrideExcelStatement', () => {
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
  ];

  it('builds THEI workbook and filename', async () => {
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
  });
});

'use strict';

const { buildAdpCsv } = require('../adpExport');

describe('adpExport', () => {
  test('buildAdpCsv escapes quotes and formats amounts', () => {
    const csv = buildAdpCsv([
      { name: 'Patsy "Pat" Pernia', total_payable: 10.5, record_count: 2 },
    ]);
    expect(csv).toContain('Agent,Total Payable,Record Count');
    expect(csv).toContain('"Patsy ""Pat"" Pernia",10.50,2');
  });
});

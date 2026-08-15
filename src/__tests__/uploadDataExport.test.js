'use strict';

/**
 * @jest-environment node
 */

const {
  exportFilename,
  rowsToCsv,
  rowsToXlsxBuffer,
  COMMISSION_EXPORT_COLUMNS,
} = require('../uploadDataExport');
const XLSX = require('xlsx');

describe('uploadDataExport', () => {
  test('exportFilename sanitizes and adds suffix', () => {
    expect(exportFilename('Agency Statement (1).pdf', 'xlsx')).toBe('Agency_Statement_1_export.xlsx');
    expect(exportFilename('a/b\\c.csv', 'csv')).toBe('a_b_c_export.csv');
  });

  test('rowsToCsv escapes commas and quotes', () => {
    const csv = rowsToCsv(
      [{ agent_name: 'Doe, Jane', carrier: 'Oscar "ACA"' }],
      [
        { key: 'agent_name', header: 'Agent' },
        { key: 'carrier', header: 'Carrier' },
      ]
    );
    expect(csv).toBe('Agent,Carrier\n"Doe, Jane","Oscar ""ACA"""');
  });

  test('rowsToXlsxBuffer writes commission columns', () => {
    const buf = rowsToXlsxBuffer(
      [
        {
          agent_name: 'Jill Taylor',
          carrier: 'Molina',
          lob: 'ACA',
          producer_payable: 27,
        },
      ],
      COMMISSION_EXPORT_COLUMNS,
      'Upload'
    );
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    expect(rows[0][0]).toBe('Agent');
    expect(rows[1][0]).toBe('Jill Taylor');
    expect(rows[1][3]).toBe('ACA');
  });
});

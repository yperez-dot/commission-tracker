'use strict';

const path = require('path');
const XLSX = require('xlsx');
const { extractTailoredStatementMeta } = require('../tailoredAcaPay');
const { resolveNhpPaymentPeriod } = require('../nhpPeriod');

/**
 * Regression: Tailored Jill Taylor NHP CSVs have no Override column.
 * Header must still be found via LOB + Agent Name / Comm Class.
 */
describe('Tailored Jill Taylor NHP CSV fixture', () => {
  const fixture = path.join(
    __dirname,
    '../../fixtures/tailored-jill-taylor-nhp-jun15-2026.csv'
  );

  test('finds LOB header without Override column and Jun 15 cycle', () => {
    const wb = XLSX.readFile(fixture, { raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const range = XLSX.utils.decode_range(ws['!ref']);

    let overrideHeader = -1;
    let lobHeader = -1;
    for (let r = range.s.r; r <= Math.min(range.s.r + 40, range.e.r); r++) {
      let hasOverride = false;
      let hasLob = false;
      let hasAgentName = false;
      let hasCommClass = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const h = String(cell?.v || '').toLowerCase().trim();
        if (h === 'override') hasOverride = true;
        if (h === 'lob') hasLob = true;
        if (h.includes('agent name')) hasAgentName = true;
        if (h.includes('comm class')) hasCommClass = true;
      }
      if (hasOverride) overrideHeader = r;
      if (hasLob && (hasAgentName || hasCommClass)) lobHeader = r;
    }
    expect(overrideHeader).toBe(-1);
    expect(lobHeader).toBeGreaterThanOrEqual(0);

    const preamble = XLSX.utils.sheet_to_json(ws, {
      raw: false,
      defval: '',
      header: 1,
      range: 0,
    }).slice(0, 30);
    const meta = extractTailoredStatementMeta(preamble);
    expect(meta.isTailoredStatement).toBe(true);
    expect(
      resolveNhpPaymentPeriod({
        statementDate: meta.paymentStatementDate,
        uploadPeriod: '202608',
      })
    ).toBe('20260615');

    const rawRows = XLSX.utils.sheet_to_json(ws, {
      raw: true,
      defval: null,
      range: lobHeader,
      header: 1,
    });
    const dataRows = rawRows.slice(1).filter((r) => String(r[0] || '').toUpperCase() === 'ACA');
    expect(dataRows).toHaveLength(6);
    expect(String(dataRows[0][4])).toMatch(/Jill Taylor/i);
  });
});

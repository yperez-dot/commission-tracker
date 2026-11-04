'use strict';

const {
  parseEffectiveYmd,
  isEffectiveOnOrAfter,
  normalizePayeeKey,
  holdPayeeKeyForType,
  applyHoldToStatement,
  applyHoldsToBundle,
  defaultHoldNote,
  formatHoldMoney,
} = require('../paymentHold');
const { STATEMENT_TYPES, buildOverrideStatements, statementToCsv } = require('../overrideStatementBuilder');
const { buildOverrideExcelWorkbook } = require('../overrideExcelStatement');

function houseRow(id, opts) {
  return {
    id,
    agent_name: opts.agent || 'Agent House',
    client_full_name: opts.client || ('CLIENT ' + id),
    policy_number: opts.policy || ('SYN-' + String(id).padStart(4, '0')),
    carrier: opts.carrier || 'Humana',
    effective_date: opts.effective,
    payment_period: opts.period || '202610',
    classification: opts.classification || 'Agency Override',
    commission: (Number(opts.thei) || 0) + (Number(opts.bsi) || 0),
    thei_share: opts.thei,
    bsi_share: opts.bsi,
    producer_payable: opts.producer || 0,
    sub_agent_override: opts.marco || 0,
    source: opts.source || 'BSI',
  };
}

/**
 * Synthetic 10.2026 house-hold fixture.
 * Encodes the production acceptance shape without client names or policy numbers:
 *   THEI payable 683.63 / held 1,924.92
 *   BSI  payable 683.58 / held 1,924.91
 *   38 held line items across 37 policies
 *   Dec-2026 and Nov-2026 effective rows stay payable
 *   One 2027 policy has a +68 / −68 pair, both held
 */
function october2026HoldFixture() {
  const rows = [];
  let id = 1;
  for (let i = 1; i <= 35; i += 1) {
    rows.push(houseRow(id, {
      client: 'Held Member ' + i,
      policy: 'SYN-H' + String(i).padStart(3, '0'),
      effective: i % 2 ? '2027-01-01' : '01/15/2027',
      thei: 53.47,
      bsi: 53.47,
    }));
    id += 1;
  }
  rows.push(houseRow(id, {
    client: 'Held Member 36',
    policy: 'SYN-H036',
    effective: '2027-01-01T00:00:00.000Z',
    thei: 53.47,
    bsi: 53.46,
  }));
  id += 1;
  rows.push(houseRow(id, {
    client: 'Pair Member',
    policy: 'SYN-H037',
    effective: '01-01-2027',
    thei: 68,
    bsi: 68,
  }));
  id += 1;
  rows.push(houseRow(id, {
    client: 'Pair Member',
    policy: 'SYN-H037',
    effective: '01-01-2027',
    classification: 'Agency Override',
    thei: -68,
    bsi: -68,
  }));
  id += 1;
  rows.push(houseRow(id, {
    client: 'Member Dec',
    policy: 'SYN-P001',
    effective: '12-01-2026',
    thei: 100.13,
    bsi: 100.10,
  }));
  id += 1;
  for (let i = 1; i <= 10; i += 1) {
    rows.push(houseRow(id, {
      client: 'Member Nov ' + i,
      policy: 'SYN-P' + String(i + 1).padStart(3, '0'),
      effective: '11/01/2026',
      thei: 50,
      bsi: 50,
    }));
    id += 1;
  }
  rows.push(houseRow(id, {
    client: 'Member Nov Extra',
    policy: 'SYN-P012',
    effective: '11.2026',
    thei: 83.50,
    bsi: 83.48,
  }));
  return rows;
}

const HOLD_2027 = { payeeKey: 'thei', effectiveOnOrAfter: '2027-01-01' };
const HOLD_BSI = { payeeKey: 'bsi', effectiveOnOrAfter: '2027-01-01' };

describe('paymentHold dates and keys', () => {
  test('parses ISO, US, MM.YYYY, and Date values to YYYY-MM-DD', () => {
    expect(parseEffectiveYmd('2027-01-01')).toBe('2027-01-01');
    expect(parseEffectiveYmd('2027-01-01T00:00:00.000Z')).toBe('2027-01-01');
    expect(parseEffectiveYmd('01/01/2027')).toBe('2027-01-01');
    expect(parseEffectiveYmd('01-01-2027')).toBe('2027-01-01');
    expect(parseEffectiveYmd('01.2027')).toBe('2027-01-01');
    expect(parseEffectiveYmd('2027-01')).toBe('2027-01-01');
    expect(parseEffectiveYmd(new Date(Date.UTC(2027, 0, 1)))).toBe('2027-01-01');
    expect(parseEffectiveYmd('12-01-2026')).toBe('2026-12-01');
  });

  test('on-or-after compares across those formats', () => {
    expect(isEffectiveOnOrAfter('01/01/2027', '2027-01-01')).toBe(true);
    expect(isEffectiveOnOrAfter('01.2027', '2027-01-01')).toBe(true);
    expect(isEffectiveOnOrAfter('12-01-2026', '01.2027')).toBe(false);
    expect(isEffectiveOnOrAfter('11/01/2026', '2027-01-01')).toBe(false);
    expect(isEffectiveOnOrAfter('', '2027-01-01')).toBe(false);
  });

  test('normalizes THEI / BSI aliases and maps statement types', () => {
    expect(normalizePayeeKey('THEI')).toBe('thei');
    expect(normalizePayeeKey('The Health Experts Insurance')).toBe('thei');
    expect(normalizePayeeKey('BSI')).toBe('bsi');
    expect(normalizePayeeKey('Broker Society Insurance')).toBe('bsi');
    expect(holdPayeeKeyForType(STATEMENT_TYPES.THEI_BSI)).toBe('thei');
    expect(holdPayeeKeyForType(STATEMENT_TYPES.BSI_OVERRIDE)).toBe('bsi');
    expect(holdPayeeKeyForType(STATEMENT_TYPES.MARCO)).toBe('');
    expect(holdPayeeKeyForType(STATEMENT_TYPES.INTEGRITY)).toBe('');
    expect(holdPayeeKeyForType(STATEMENT_TYPES.ALBA)).toBe('');
  });
});

describe('synthetic 10.2026 THEI / BSI hold acceptance', () => {
  const rows = october2026HoldFixture();

  test('THEI payable 683.63 held 1,924.92 — 38 lines / 37 policies', () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_BSI, {
      period: '202610',
      holds: [HOLD_2027],
    });
    expect(bundle.statements).toHaveLength(1);
    const s = bundle.statements[0];
    expect(s.total).toBe(683.63);
    expect(s.hold.heldTotal).toBe(1924.92);
    expect(s.hold.heldLineCount).toBe(38);
    expect(s.hold.heldPolicyCount).toBe(37);
    expect(s.lines.every((l) => !isEffectiveOnOrAfter(l.effective_date, '2027-01-01'))).toBe(true);
    expect(s.lines.some((l) => l.client_full_name === 'Member Dec')).toBe(true);
    expect(s.lines.filter((l) => String(l.effective_date).indexOf('11') !== -1).length).toBeGreaterThan(0);
    expect(s.heldLines.some((l) => l.amount === 68)).toBe(true);
    expect(s.heldLines.some((l) => l.amount === -68)).toBe(true);
    expect(s.hold.note).toContain('38 line items across 37 policies, $1,924.92');
    expect(s.hold.note).toContain('12.2026 or 01.2027');
    expect(bundle.grandTotal).toBe(683.63);
  });

  test('BSI payable 683.58 held 1,924.91 — same 38 / 37', () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.BSI_OVERRIDE, {
      period: '202610',
      holds: [HOLD_BSI],
    });
    const s = bundle.statements[0];
    expect(s.total).toBe(683.58);
    expect(s.hold.heldTotal).toBe(1924.91);
    expect(s.hold.heldLineCount).toBe(38);
    expect(s.hold.heldPolicyCount).toBe(37);
    expect(s.lines.some((l) => l.client_full_name === 'Member Dec')).toBe(true);
  });

  test('release (no active hold) puts lines back on the original period', () => {
    const held = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_BSI, {
      period: '202610',
      holds: [HOLD_2027],
    });
    const released = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_BSI, {
      period: '202610',
      holds: [{ payeeKey: 'thei', effectiveOnOrAfter: '2027-01-01', releasedAt: '2026-12-01T00:00:00.000Z' }],
    });
    const never = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_BSI, { period: '202610' });
    expect(held.grandTotal).toBe(683.63);
    expect(released.grandTotal).toBe(2608.55);
    expect(never.grandTotal).toBe(2608.55);
    expect(released.statements[0].lineCount).toBe(held.statements[0].lineCount + 38);
    expect(released.statements[0].hold).toBeNull();
  });

  test('a THEI hold does not change Marco, Integrity, or Lina statements', () => {
    const marcoRows = [
      houseRow(1, {
        agent: 'Kelly Carpenter',
        effective: '2027-01-01',
        thei: 45,
        bsi: 45,
        marco: 10,
        period: '202610',
      }),
    ];
    const marco = buildOverrideStatements(marcoRows, STATEMENT_TYPES.MARCO, {
      period: '202610',
      holds: [HOLD_2027, HOLD_BSI],
    });
    expect(marco.grandTotal).toBe(10);
    expect(marco.statements[0].lineCount).toBe(1);

    const integrityRows = [
      houseRow(2, {
        agent: 'Christian Munoz',
        effective: '2027-01-01',
        thei: 50,
        bsi: 50,
        producer: 100,
      }),
    ];
    const integrity = buildOverrideStatements(integrityRows, STATEMENT_TYPES.INTEGRITY, {
      period: '202610',
      holds: [HOLD_2027, HOLD_BSI],
    });
    expect(integrity.grandTotal).toBe(100);

    const linaRows = [{
      id: 3,
      agent_name: 'Alba Hernandez',
      client_full_name: 'Lina Client',
      policy_number: 'SYN-LINA-1',
      carrier: 'Humana',
      effective_date: '2027-01-01',
      payment_period: '202610',
      classification: 'New Business',
      commission: 200,
      thei_share: 0,
      bsi_share: 0,
      producer_payable: 200,
      sub_agent_override: 0,
      source: 'BSI',
    }];
    const lina = buildOverrideStatements(linaRows, STATEMENT_TYPES.ALBA, {
      period: '202610',
      holds: [HOLD_2027, HOLD_BSI],
    });
    expect(lina.grandTotal).toBe(200);
    expect(lina.statements[0].lineCount).toBe(1);
  });

  test('saved note text is used; default note names MM.YYYY and money', () => {
    const custom = applyHoldToStatement(
      { payee: 'THEI', total: 10, lines: [{ effective_date: '2027-01-01', amount: 5, policy_number: 'A' }] },
      { payeeKey: 'thei', effectiveOnOrAfter: '2027-01-01', note: 'Custom hold wording.' }
    );
    expect(custom.hold.note).toBe('Custom hold wording.');
    expect(defaultHoldNote({ lineCount: 38, policyCount: 37, heldTotal: 1924.92, holdYmd: '2027-01-01' }))
      .toBe('Hold: 2027-effective overrides (38 line items across 37 policies, $1,924.92) are being held and will be paid in 12.2026 or 01.2027. They are not included in this statement.');
    expect(formatHoldMoney(1924.92)).toBe('$1,924.92');
  });
});

describe('THEI / BSI exports with a hold', () => {
  const rows = october2026HoldFixture();

  test('Excel drops held lines from TOTAL / Gross / Balance due and adds hold note', async () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_BSI, {
      period: '202610',
      holds: [HOLD_2027],
    });
    const stmt = bundle.statements[0];
    const wb = await buildOverrideExcelWorkbook(bundle, stmt, { reportDate: '10/15/2026' });
    const ws = wb.worksheets[0];
    const texts = [];
    ws.eachRow((row) => row.eachCell((cell) => {
      if (cell.value != null) texts.push(String(cell.value));
    }));
    expect(texts.some((t) => /Generated by OliComm/.test(t))).toBe(false);
    expect(texts.some((t) => /Unless repaid/.test(t))).toBe(false);
    expect(texts.some((t) => t.indexOf('held (not included above)') !== -1)).toBe(true);
    expect(texts.some((t) => t.indexOf('38 line items across 37 policies') !== -1)).toBe(true);
    expect(texts).not.toContain('SYN-H001');
    expect(texts).toContain('SYN-P001');

    let totalRow = null;
    let balanceRow = null;
    let heldRow = null;
    ws.eachRow((row, n) => {
      if (row.getCell(1).value === 'TOTAL') totalRow = n;
      if (row.getCell(1).value === 'Balance due payee') balanceRow = n;
      if (row.getCell(1).value === 'held (not included above)') heldRow = n;
    });
    expect(ws.getRow(totalRow).getCell(8).value).toBeCloseTo(683.63, 2);
    expect(ws.getRow(balanceRow).getCell(8).value).toBeCloseTo(683.63, 2);
    expect(ws.getRow(heldRow).getCell(8).value).toBeCloseTo(1924.92, 2);
    expect(ws.getRow(heldRow).getCell(1).font.italic).toBe(true);

    const sum = wb.getWorksheet('Summary');
    const sumTexts = [];
    sum.eachRow((row) => row.eachCell((cell) => { if (cell.value != null) sumTexts.push(String(cell.value)); }));
    expect(sumTexts).toContain('Held');
    expect(sumTexts).toContain('Hold note');
    expect(sum.getCell('B11').value).toBeCloseTo(1924.92, 2);
  });

  test('CSV omits the OliComm footer and lists the held amount', () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.BSI_OVERRIDE, {
      period: '202610',
      holds: [HOLD_BSI],
    });
    const csv = statementToCsv(bundle, bundle.statements[0]);
    expect(csv).not.toMatch(/Generated by OliComm/);
    expect(csv).toContain('held (not included above)');
    expect(csv).toContain('$683.58');
    expect(csv).toContain('$1,924.91');
    expect(csv).not.toContain('SYN-H001');
    expect(csv).toContain('SYN-P001');
  });

  test('applyHoldsToBundle is a no-op when the hold is for another payee', () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_BSI, { period: '202610' });
    const filtered = applyHoldsToBundle(bundle, [{ payeeKey: 'marco', effectiveOnOrAfter: '2027-01-01' }]);
    expect(filtered.grandTotal).toBe(bundle.grandTotal);
  });
});

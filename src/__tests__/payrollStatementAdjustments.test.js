const { buildIntegrityStatement, buildIntegrityWorkbook } = require('../integrityStatement');
const { buildLinaCompensationStatement, buildLinaCompensationWorkbook } = require('../linaCompensationStatement');
const { attachAdjustments } = require('../payrollStatementExtras');

const RED = 'FFB91C1C';
const adjustments = [
  { id: 1, payment_period: '202610', amount: -40, category: 'clawback_not_on_file', reason: 'Clawback expected next file', created_at: '2026-10-20T12:00:00Z' },
  { id: 2, payment_period: '202610', amount: 15, category: 'correction', reason: 'Rate fix', created_at: '2026-10-21T12:00:00Z' },
  { id: 3, payment_period: '202610', amount: 999, category: 'other', reason: 'Voided', status: 'void' },
];

function findRow(ws, text) {
  let hit = null;
  ws.eachRow((row) => { row.eachCell((cell) => { if (!hit && cell.value === text) hit = row; }); });
  return hit;
}

describe('adjustment lines on statements', () => {
  test('Integrity statement: own section, total, negatives red', async () => {
    const rows = [{ id: 1, agent_name: 'Christian Munoz', classification: 'Agency Override', carrier: 'UnitedHealthcare',
      payment_period: '202610', producer_payable: 100, policy_number: 'P1', client_full_name: 'TEST, MEMBER' }];
    const st = attachAdjustments(buildIntegrityStatement(rows, 'christian-munoz', { period: '202610' }), adjustments);
    expect(st.adjustments).toHaveLength(2);
    expect(st.adjustmentsTotal).toBe(-25);
    expect(st.balanceAfterAdjustments).toBe(75);
    const ws = (await buildIntegrityWorkbook(st)).getWorksheet('Compensation Statement');
    expect(findRow(ws, 'ADJUSTMENTS')).not.toBeNull();
    const claw = findRow(ws, 'Clawback expected next file');
    expect(claw.getCell(6).value).toBe(-40);
    expect(claw.getCell(6).font.color.argb).toBe(RED);
    expect(findRow(ws, 'Balance after adjustments').getCell(6).value).toBe(75);
  });

  test('Lina statement: adjustments section printed', async () => {
    const rows = [{ id: 1, agent_name: 'Alba Hernandez', classification: 'New Business', carrier: 'UnitedHealthcare',
      payment_period: '202610', producer_payable: 150, policy_number: 'P1', client_full_name: 'TEST, MEMBER' }];
    const st = attachAdjustments(buildLinaCompensationStatement(rows, { period: '202610' }), adjustments);
    const wb = await buildLinaCompensationWorkbook(st);
    const ws = wb.worksheets[0];
    expect(findRow(ws, 'ADJUSTMENTS')).not.toBeNull();
    expect(findRow(ws, 'Clawback expected next file').getCell(6).font.color.argb).toBe(RED);
    expect(findRow(ws, 'Balance after adjustments').getCell(6).value).toBe(125);
  });

  test('no adjustments -> no section', async () => {
    const st = attachAdjustments(buildIntegrityStatement([], 'horacio-mendieta', { period: '202610' }), []);
    const ws = (await buildIntegrityWorkbook(st)).getWorksheet('Compensation Statement');
    expect(findRow(ws, 'ADJUSTMENTS')).toBeNull();
  });
});

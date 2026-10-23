'use strict';

const {
  classifyBsiNonMemberRow,
  sumSummaryActivity,
  reconcileToSummary,
} = require('../bsiNonMemberRows');
const { applyBsiBookAgentProduction, ALBA_DB_AGENT } = require('../bsiBookAttribution');
const { buildLinaCompensationStatement } = require('../linaCompensationStatement');

const HA_ROW = {
  'Commission Action':
    'HA payment for agent ID 6661553 for member SALVADOR TREVINO MBI *****1GH03 policy number 951906631',
  'Payment Period': 202609,
  Commission: 50,
};
const FEE_ROW = {
  'Commission Action':
    'LA Appointment Renewal Fee Collection for Required Entity: UnitedHealthcare Insurance Company-LA',
  'Payment Period': 202609,
  Commission: -100,
};

describe('bsiNonMemberRows', () => {
  it('HA payment → HRA/Bonus paid to Lina, no splits', () => {
    const r = classifyBsiNonMemberRow(HA_ROW, { period: '202609' });
    expect(r.classification).toBe('HRA/Bonus');
    expect(r.agent).toBe(ALBA_DB_AGENT);
    expect(r.client).toBe('SALVADOR TREVINO');
    expect(r.policyNumber).toBe('951906631');
    expect(r.commission).toBe(50);
    expect(r.producerPayable).toBe(50);
    expect(r.theiShare).toBe(0);
    expect(r.bsiShare).toBe(0);
    expect(r.period).toBe('202609');
  });

  it('appointment fee → BSI Fee, $0 to Lina/THEI/BSI shares', () => {
    const r = classifyBsiNonMemberRow(FEE_ROW, { period: '202609' });
    expect(r.classification).toBe('BSI Fee');
    expect(r.commission).toBe(-100);
    expect(r.producerPayable).toBe(0);
    expect(r.theiShare).toBe(0);
    expect(r.bsiShare).toBe(0);
    expect(r.agent).not.toBe(ALBA_DB_AGENT);
    expect(r.client).toMatch(/LA Renewal/);
  });

  it('unknown blank-member rows and zero amounts return null', () => {
    expect(classifyBsiNonMemberRow({ 'Commission Action': 'Something else', Commission: 5 })).toBeNull();
    expect(classifyBsiNonMemberRow({ ...HA_ROW, Commission: 0 })).toBeNull();
  });

  it('attribution leaves HRA and BSI Fee rows untouched (no peel, no remap)', () => {
    const records = [
      classifyBsiNonMemberRow(HA_ROW, { period: '202609' }),
      classifyBsiNonMemberRow(FEE_ROW, { period: '202609' }),
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(50);
    expect(records[0].theiShare).toBe(0);
    expect(records[1].agent).toBe('Broker Society Insurance');
    expect(records[1].producerPayable).toBe(0);
  });

  it("Lina's statement includes HRA but never BSI fees", () => {
    const rows = [
      { id: 1, agent_name: 'Alba Hernandez', classification: 'HRA/Bonus', producer_payable: 50, payment_period: '202609', carrier: 'UnitedHealthcare' },
      { id: 2, agent_name: 'Broker Society Insurance', classification: 'BSI Fee', producer_payable: 0, commission: -100, payment_period: '202609', carrier: 'UnitedHealthcare' },
      { id: 3, agent_name: 'Alba Hernandez', classification: 'BSI Fee', producer_payable: 0, payment_period: '202609', carrier: 'UnitedHealthcare' },
    ];
    const st = buildLinaCompensationStatement(rows, { period: '202609' });
    expect(st.lineCount).toBe(1);
    expect(st.balance).toBe(50);
  });

  it('reconciles imported total to the carrier Commission Summary', () => {
    const summary = [{ 'Commission Activity': 525.83 }, { 'Commission Activity': 249.45 }, { 'Commission Activity': '' }];
    expect(sumSummaryActivity(summary)).toBe(775.28);
    expect(reconcileToSummary([{ commission: 775.28 }], 775.28).ok).toBe(true);
    const bad = reconcileToSummary([{ commission: 1155.28 }], 775.28);
    expect(bad.ok).toBe(false);
    expect(bad.variance).toBe(380);
    expect(reconcileToSummary([{ commission: 1 }], null).checked).toBe(false);
  });
});

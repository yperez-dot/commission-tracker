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
    // excluded (not stored) BSI fees still tie to the carrier summary
    const withFees = reconcileToSummary([{ commission: 1255.28 }], 775.28, -480);
    expect(withFees.ok).toBe(true);
    expect(withFees.excludedFees).toBe(-480);
  });

  describe('business rule: every HRA row on a BSI statement is paid 100% to Lina', () => {
    const variants = [
      // different writing-agent ID and a member with no prior statement history
      'HA payment for agent ID 1234567 for member MARIA ROJAS MBI *****9XY12 policy number 900000001',
      'HA payment for agent ID 6661553 for member SALVADOR TREVINO MBI *****1GH03 policy number 951906631',
    ];
    it.each(variants)('routes "%s" to Lina by rule, not by member/agent match', (desc) => {
      for (const amt of [50, -50]) {
        const r = classifyBsiNonMemberRow({ 'Commission Action': desc, Commission: amt }, { period: '202609' });
        expect(r.agent).toBe(ALBA_DB_AGENT);
        expect(r.classification).toBe('HRA/Bonus');
        expect(r.producerPayable).toBe(amt);
        expect(r.theiShare).toBe(0);
        expect(r.bsiShare).toBe(0);
        expect(r.splitApplies).toBe(false);
      }
    });

    it('HRA reversal (-$50) nets against the payment on Lina\'s statement', () => {
      const rows = [
        { id: 1, agent_name: 'Alba Hernandez', classification: 'HRA/Bonus', producer_payable: 50, payment_period: '202609', carrier: 'UnitedHealthcare' },
        { id: 2, agent_name: 'Alba Hernandez', classification: 'HRA/Bonus', producer_payable: -50, payment_period: '202609', carrier: 'UnitedHealthcare' },
      ];
      const st = buildLinaCompensationStatement(rows, { period: '202609' });
      expect(st.lineCount).toBe(2);
      expect(st.balance).toBe(0);
    });

    it('override builder Lina (ALBA) statement includes HRA, excludes BSI Fee', () => {
      const { classifyOverrideLine } = require('../overrideStatementBuilder');
      const { STATEMENT_TYPES } = require('../payeeSchedules');
      const hra = classifyOverrideLine(
        { agent_name: 'Alba Hernandez', classification: 'HRA/Bonus', producer_payable: 50, commission: 50 },
        STATEMENT_TYPES.ALBA
      );
      expect(hra && hra.amount).toBe(50);
      const fee = classifyOverrideLine(
        { agent_name: 'Alba Hernandez', classification: 'BSI Fee', producer_payable: 0, commission: -100 },
        STATEMENT_TYPES.ALBA
      );
      expect(fee).toBeNull();
      // THEI / BSI override statements never pick up HRA or fee rows
      for (const t of [STATEMENT_TYPES.THEI_OVERRIDE, STATEMENT_TYPES.BSI_OVERRIDE]) {
        expect(classifyOverrideLine({ agent_name: 'Alba Hernandez', classification: 'HRA/Bonus', producer_payable: 50, commission: 50, thei_share: 0, bsi_share: 0, source: 'BSI' }, t)).toBeNull();
        expect(classifyOverrideLine({ agent_name: 'Broker Society Insurance', classification: 'BSI Fee', producer_payable: 0, commission: -100, thei_share: 0, bsi_share: 0, source: 'BSI' }, t)).toBeNull();
      }
    });
  });

  it('fee/HRA detection does not match ordinary commission wording', () => {
    for (const desc of ['New', 'Renewal', 'Chargeback', 'Commission adjustment', 'Health assessment bonus', 'Appointment']) {
      expect(classifyBsiNonMemberRow({ 'Commission Action': desc, Commission: 25 })).toBeNull();
    }
  });
});

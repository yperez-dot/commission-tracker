'use strict';

// Synthetic data only. Swan/Marco agents are taken from the schedule list, never spelled out.
const {
  applyBsiBookAgentProduction,
  isUnsplitBsiLine,
  isOtherBsiAgent,
  isHouseSplitBsiAgent,
} = require('../bsiBookAttribution');
const { MARCO_AGENTS, STATEMENT_TYPES, isBsiHouseSplitLine, isTheiWritingAgent } = require('../payeeSchedules');
const { buildOverrideStatements } = require('../overrideStatementBuilder');

const tc = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const THEI_VARIANTS = [
  'The Health Experts Insurance',
  'The Health Experts Insurance LLC',
  'THE HEALTH EXPERTS INSURANCE, LLC',
  'Health Experts Insurance Inc',
  'The Health Experts',
];
const uhc = { carrier: 'UnitedHealthcare', period: '202609', payee: 'BSI', client: 'SAMPLE, MEMBER', raw: {} };

describe('THEI as the writing agent on BSI feeds: 50/50 THEI/BSI like other agents', () => {
  it('recognizes THEI name variants', () => {
    for (const n of THEI_VARIANTS) {
      expect(isTheiWritingAgent(n)).toBe(true);
      expect(isHouseSplitBsiAgent(n)).toBe(true);
      expect(isOtherBsiAgent(n)).toBe(false); // not an "other agent" — never Marco
    }
    expect(isTheiWritingAgent('Sample Health Expertise Group')).toBe(false);
  });

  it('new business, renewals and chargebacks: producer 0, THEI/BSI 50/50, no Marco, not flagged', () => {
    const records = THEI_VARIANTS.flatMap((agent, i) => [
      { ...uhc, agent, policyNumber: `H-${i}`, classification: 'New Business', commission: 100 },
      { ...uhc, agent, policyNumber: `H-${i}`, classification: 'Renewal', commission: 25.5 },
      { ...uhc, carrier: 'Aetna', agent, policyNumber: `HA-${i}`, classification: 'New Business', commission: 61 },
      { ...uhc, agent, policyNumber: `H-${i}`, classification: 'Chargeback', commission: -100 },
    ]);
    applyBsiBookAgentProduction(records);
    for (const r of records) {
      expect(r.producerPayable).toBe(0);
      expect(r.subAgentOverride).toBe(0);
      expect(r.theiShare + r.bsiShare).toBeCloseTo(r.commission, 2);
      expect(Math.abs(r.theiShare - r.bsiShare)).toBeLessThanOrEqual(0.011);
      expect(r.splitApplies).toBe(true);
      expect(r.anomaly).toBeFalsy();
      expect(isUnsplitBsiLine(r)).toBe(false);
    }
  });

  it('the guard still flags an unsplit THEI line (e.g. stored before this change)', () => {
    expect(isUnsplitBsiLine({ agent_name: THEI_VARIANTS[1], classification: 'New Business', commission: 100 })).toBe(true);
    expect(isUnsplitBsiLine({ agent_name: THEI_VARIANTS[1], classification: 'New Business', commission: 100, thei_share: 50, bsi_share: 50 })).toBe(false);
  });

  it('House Statements list stored THEI-written lines', () => {
    const row = (id, cls, amount) => ({
      id, agent_name: THEI_VARIANTS[1], policy_number: `P-${id}`, carrier: 'UnitedHealthcare', payment_period: '202609',
      classification: cls, commission: amount, gross_commission: amount, thei_share: amount / 2, bsi_share: amount / 2,
      producer_payable: 0, sub_agent_override: 0, source: 'BSI', split_applies: true,
      client_full_name: 'SAMPLE, MEMBER', lob: 'MA', plan_type: 'Med Adv',
    });
    const rows = [row(1, 'New Business', 100), row(2, 'Renewal', 20), row(3, 'Chargeback', -40)];
    for (const r of rows) expect(isBsiHouseSplitLine(r)).toBe(true);
    for (const type of [STATEMENT_TYPES.THEI_BSI, STATEMENT_TYPES.BSI_OVERRIDE]) {
      const b = buildOverrideStatements(rows, type, { period: '202609' });
      expect(b.statements.flatMap((s) => s.lines).map((l) => l.id).sort()).toEqual([1, 2, 3]);
      expect(b.grandTotal).toBeCloseTo(40, 2);
    }
    const marco = buildOverrideStatements(rows, STATEMENT_TYPES.MARCO, { period: '202609' });
    expect(marco.statements.flatMap((s) => s.lines)).toHaveLength(0);
  });
});

describe('Swan agent with a middle initial on a BSI feed', () => {
  it('gets Marco $10 first on the first line per policy', () => {
    const [f, l] = MARCO_AGENTS[8].split(' ');
    const agent = `${tc(f)} L ${tc(l)}`;
    const records = [
      { ...uhc, agent, policyNumber: 'W-1', classification: 'New Business', commission: 100 },
      { ...uhc, agent, policyNumber: 'W-1', classification: 'Renewal', commission: 20 },
      { ...uhc, agent, policyNumber: 'W-1', classification: 'Chargeback', commission: -100 },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0]).toMatchObject({ subAgentOverride: 10, theiShare: 45, bsiShare: 45, producerPayable: 0 });
    expect(records[1]).toMatchObject({ subAgentOverride: 0, theiShare: 10, bsiShare: 10 });
    expect(records[2]).toMatchObject({ subAgentOverride: -10, theiShare: -45, bsiShare: -45 });
  });
});

'use strict';

// Synthetic data only. Agent names for the "other agent" cases are made up; Swan/Marco and
// Integrity agents are taken from the schedule lists so no names are spelled out here.
const {
  applyBsiBookAgentProduction,
  isUnsplitBsiLine,
  isOtherBsiAgent,
  ALBA_DB_AGENT,
} = require('../bsiBookAttribution');
const {
  MARCO_AGENTS,
  INTEGRITY_AGENTS,
  STATEMENT_TYPES,
  isBsiHouseSplitLine,
} = require('../payeeSchedules');
const { splitFullOverridePot } = require('../overrideSplitMath');
const { buildOverrideStatements } = require('../overrideStatementBuilder');

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const MARCO = titleCase(MARCO_AGENTS[0]);
const INTEGRITY = INTEGRITY_AGENTS.map(titleCase);
const OTHER = 'Sample Writer Alpha';

const uhc = { carrier: 'UnitedHealthcare', period: '202609', payee: 'BSI', client: 'SAMPLE, MEMBER', raw: {} };
const aetna = { ...uhc, carrier: 'Aetna' };

describe('BSI other-agent house split (upload)', () => {
  it('UHC and Aetna other-agent lines: producer 0, THEI/BSI 50/50', () => {
    const records = [
      { ...uhc, agent: OTHER, policyNumber: 'T-1', classification: 'New Business', commission: 100 },
      { ...uhc, agent: OTHER, policyNumber: 'T-2', classification: 'Renewal', commission: 12 },
      { ...uhc, agent: OTHER, policyNumber: 'T-3', classification: 'Agent Commission', commission: 30 },
      { ...aetna, agent: OTHER, policyNumber: 'T-4', classification: 'New Business', commission: 125 },
      { ...aetna, agent: OTHER, policyNumber: 'T-5', classification: 'Renewal', commission: 8.5 },
    ];
    applyBsiBookAgentProduction(records);
    for (const r of records) {
      expect(r.producerPayable).toBe(0);
      expect(r.subAgentOverride).toBe(0);
      expect(r.theiShare).toBeCloseTo(r.commission / 2, 2);
      expect(r.bsiShare).toBeCloseTo(r.commission / 2, 2);
      expect(r.grossCommission).toBe(r.commission);
      expect(r.splitApplies).toBe(true);
      expect(r.source).toBe('BSI');
      expect(r.agent).toBe(OTHER);
      expect(r.anomaly).toBeFalsy();
    }
  });

  it('Swan/Marco agent: Marco $10 first on the first line per policy, then 50/50', () => {
    const records = [
      { ...uhc, agent: MARCO, policyNumber: 'M-1', classification: 'New Business', commission: 100 },
      { ...uhc, agent: MARCO, policyNumber: 'M-1', classification: 'Renewal', commission: 20 },
      { ...aetna, agent: MARCO, policyNumber: 'M-2', classification: 'New Business', commission: 60 },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0]).toMatchObject({ subAgentOverride: 10, theiShare: 45, bsiShare: 45, producerPayable: 0 });
    expect(records[1]).toMatchObject({ subAgentOverride: 0, theiShare: 10, bsiShare: 10 });
    expect(records[2]).toMatchObject({ subAgentOverride: 10, theiShare: 25, bsiShare: 25 });
  });

  it('uses the same Marco math as the Humana/Devoted Agency Override path', () => {
    const r = [{ ...uhc, agent: MARCO, policyNumber: 'M-9', classification: 'New Business', commission: 83.4 }];
    applyBsiBookAgentProduction(r);
    const ref = splitFullOverridePot(83.4, { agentName: MARCO, paymentPeriod: '202609' });
    expect(r[0].theiShare).toBe(ref.theiShare);
    expect(r[0].bsiShare).toBe(ref.bsiShare);
    expect(r[0].subAgentOverride).toBe(ref.subAgentOverride);
  });

  it('no second $10 when an earlier upload already gave Marco his $10 on the policy', () => {
    const records = [{ ...uhc, agent: MARCO, policyNumber: 'M-3', classification: 'Renewal', commission: 40 }];
    applyBsiBookAgentProduction(records, { deductedPolicies: new Set(['M-3']) });
    expect(records[0]).toMatchObject({ subAgentOverride: 0, theiShare: 20, bsiShare: 20 });
  });

  it('other-agent chargebacks on every BSI carrier reverse 50/50', () => {
    const records = ['UnitedHealthcare', 'Aetna', 'Humana', 'Devoted', 'Freedom Health'].map((carrier, i) => ({
      ...uhc, carrier, agent: OTHER, policyNumber: `C-${i}`, classification: 'Chargeback', commission: -61.75,
    }));
    applyBsiBookAgentProduction(records);
    for (const r of records) {
      expect(r.producerPayable).toBe(0);
      expect(r.subAgentOverride).toBe(0);
      expect(r.theiShare).toBeLessThan(0);
      expect(r.bsiShare).toBeLessThan(0);
      expect(r.theiShare + r.bsiShare).toBeCloseTo(-61.75, 2);
      expect(Math.abs(r.theiShare - r.bsiShare)).toBeLessThanOrEqual(0.011);
    }
  });

  it('Marco chargeback: full and partial reverse his $10 in proportion (sale in the same file)', () => {
    const records = [
      { ...uhc, agent: MARCO, policyNumber: 'M-4', classification: 'Chargeback', commission: -50 },
      { ...uhc, agent: MARCO, policyNumber: 'M-4', classification: 'New Business', commission: 100 },
      { ...uhc, agent: MARCO, policyNumber: 'M-5', classification: 'New Business', commission: 100 },
      { ...uhc, agent: MARCO, policyNumber: 'M-5', classification: 'Chargeback', commission: -100 },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0]).toMatchObject({ subAgentOverride: -5, theiShare: -22.5, bsiShare: -22.5, producerPayable: 0 });
    expect(records[3]).toMatchObject({ subAgentOverride: -10, theiShare: -45, bsiShare: -45 });
  });

  it('Marco chargeback against an earlier upload never reverses more than was taken', () => {
    const marcoOriginals = new Map([['m-6', { gross: 100, sub: 10, reversed: 0 }]]);
    const records = [
      { ...aetna, agent: MARCO, policyNumber: 'M-6', classification: 'Chargeback', commission: -80 },
      { ...aetna, agent: MARCO, policyNumber: 'M-6', classification: 'Chargeback', commission: -80 },
    ];
    applyBsiBookAgentProduction(records, { marcoOriginals });
    expect(records[0].subAgentOverride).toBe(-8);
    expect(records[1].subAgentOverride).toBe(-2);
    for (const r of records) expect(r.theiShare + r.bsiShare + r.subAgentOverride).toBeCloseTo(-80, 2);
    // the caller's map is not mutated
    expect(marcoOriginals.get('m-6').reversed).toBe(0);
  });

  it('Marco chargeback with no original found: reverses $10 once and flags it', () => {
    const records = [{ ...uhc, carrier: 'Humana', agent: MARCO, policyNumber: 'M-7', classification: 'Chargeback', commission: -90 }];
    applyBsiBookAgentProduction(records);
    expect(records[0]).toMatchObject({ subAgentOverride: -10, theiShare: -40, bsiShare: -40 });
    expect(records[0].mga).toMatch(/original sale not found/);
  });

  it('Humana/Devoted positive Agency Override rows keep their existing split', () => {
    const hd = { ...uhc, carrier: 'Humana', classification: 'Agency Override' };
    const records = [
      { ...hd, agent: OTHER, policyNumber: 'H-1', commission: 165 },
      { ...hd, agent: MARCO, policyNumber: 'H-2', commission: 165 },
    ];
    // An earlier-upload $10 on H-2 must not change the Agency Override path (file-only, as before).
    applyBsiBookAgentProduction(records, { deductedPolicies: new Set(['H-2']) });
    expect(records[0]).toMatchObject({ theiShare: 82.5, bsiShare: 82.5, producerPayable: 0, subAgentOverride: 0 });
    expect(records[1]).toMatchObject({ theiShare: 77.5, bsiShare: 77.5, subAgentOverride: 10 });
  });

  it('never re-splits a line a parser already split', () => {
    const records = [{ ...uhc, agent: OTHER, classification: 'Chargeback', commission: -40, theiShare: -10, bsiShare: -30, producerPayable: 0 }];
    applyBsiBookAgentProduction(records);
    expect(records[0]).toMatchObject({ theiShare: -10, bsiShare: -30 });
  });
});

describe('Integrity and Lina rows are unaffected by the house split', () => {
  it('Integrity: UHC 2026 fixed $82.50, Aetna 50/25/25, no renewals, chargebacks take back what was paid', () => {
    const [munoz, mendieta, cam] = INTEGRITY;
    const records = [
      { ...uhc, agent: munoz, policyNumber: 'I-1', classification: 'New Business', commission: 150, effectiveDate: '03/01/2026' },
      { ...uhc, agent: munoz, policyNumber: 'I-1', classification: 'Chargeback', commission: -150 },
      { ...aetna, agent: mendieta, policyNumber: 'I-2', classification: 'New Business', commission: 100 },
      { ...aetna, agent: mendieta, policyNumber: 'I-2', classification: 'Chargeback', commission: -100 },
      { ...uhc, agent: cam, policyNumber: 'I-3', classification: 'Renewal', commission: 20 },
      { ...uhc, agent: cam, policyNumber: 'I-4', classification: 'Chargeback', commission: -150, effectiveDate: '04/01/2026' },
      { ...uhc, carrier: 'Humana', agent: mendieta, policyNumber: 'I-5', classification: 'Chargeback', commission: -82.5 },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0]).toMatchObject({ producerPayable: 82.5, bsiShare: 37.5, theiShare: 30 });
    expect(records[1].producerPayable).toBe(-82.5);
    expect(records[2]).toMatchObject({ producerPayable: 50, theiShare: 25, bsiShare: 25 });
    expect(records[3]).toMatchObject({ producerPayable: -50, theiShare: -25, bsiShare: -25 });
    expect(records[4]).toMatchObject({ producerPayable: 0, theiShare: 10, bsiShare: 10 });
    // UHC chargeback with no original found: the $82.50 fixed-rate fallback, flagged
    expect(records[5].producerPayable).toBe(-82.5);
    expect(records[5].mga).toMatch(/original sale not found/);
    expect(records[6]).toMatchObject({ producerPayable: -41.25, theiShare: -20.62, bsiShare: -20.62 });
    for (const r of records) {
      expect(r.subAgentOverride || 0).toBe(0);
      expect(isOtherBsiAgent(r.agent)).toBe(false);
    }
  });

  it('Lina: house-label production is remapped and peeled; HRA stays 100% Lina; her chargebacks keep her rules', () => {
    const records = [
      { ...uhc, agent: 'Broker Society Insurance', policyNumber: 'L-1', classification: 'New Business',
        commission: 323.5, memberState: 'FL', raw: { 'Commission Action': 'New', 'Member State': 'FL' } },
      { ...uhc, agent: ALBA_DB_AGENT, policyNumber: 'L-2', classification: 'HRA/Bonus', commission: 50, producerPayable: 50 },
      { ...uhc, agent: ALBA_DB_AGENT, policyNumber: 'L-3', classification: 'Chargeback', commission: -323.5,
        memberState: 'FL', raw: { 'Commission Action': 'Chargeback', 'Member State': 'FL' } },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0]).toMatchObject({ agent: ALBA_DB_AGENT, producerPayable: 173.5, theiShare: 75, bsiShare: 75 });
    expect(records[1]).toMatchObject({ producerPayable: 50 });
    expect(records[1].theiShare == null || records[1].theiShare === 0).toBe(true);
    expect(records[2].producerPayable).toBeLessThan(0);
    for (const r of records) expect(r.subAgentOverride || 0).toBe(0);
  });
});

describe('unsplit guard', () => {
  it('flags other-agent lines and chargebacks with no THEI/BSI share; not HRA/fees or split rows', () => {
    expect(isUnsplitBsiLine({ agent: OTHER, classification: 'Renewal', commission: 5 })).toBe(true);
    expect(isUnsplitBsiLine({ agent: OTHER, classification: 'Renewal', commission: 5, producerPayable: 5 })).toBe(true);
    expect(isUnsplitBsiLine({ agent_name: ALBA_DB_AGENT, classification: 'Chargeback', commission: -5, producer_payable: -5 })).toBe(true);
    expect(isUnsplitBsiLine({ agent: ALBA_DB_AGENT, classification: 'Renewal', commission: 5, producerPayable: 5 })).toBe(false);
    expect(isUnsplitBsiLine({ agent: ALBA_DB_AGENT, classification: 'HRA/Bonus', commission: 50 })).toBe(false);
    expect(isUnsplitBsiLine({ agent: 'Broker Society Insurance', classification: 'BSI Fee', commission: -40 })).toBe(false);
    expect(isUnsplitBsiLine({ agent: OTHER, classification: 'Chargeback', commission: -5, theiShare: -2.5, bsiShare: -2.5 })).toBe(false);
    expect(isUnsplitBsiLine({ agent: OTHER, classification: 'Renewal', commission: 0 })).toBe(false);
  });

  it('upload marks a line it could not split as an anomaly', () => {
    const records = [{ ...uhc, agent: OTHER, policyNumber: 'G-1', classification: 'Adjustment', commission: 15 }];
    applyBsiBookAgentProduction(records);
    expect(records[0].anomaly).toBe(true);
    expect(records[0].mga).toMatch(/No THEI\/BSI split/);
  });
});

describe('House Statements pick up the stored house split', () => {
  const row = (o) => ({
    id: o.id, agent_name: o.agent, policy_number: o.policy, carrier: 'UnitedHealthcare', payment_period: '202609',
    classification: o.cls, commission: o.amount, gross_commission: o.amount, thei_share: o.thei, bsi_share: o.bsi,
    producer_payable: 0, sub_agent_override: o.sub || 0, source: 'BSI', split_applies: o.applies !== false,
    client_full_name: 'SAMPLE, MEMBER', lob: 'MA', plan_type: 'Med Adv',
  });
  const rows = [
    row({ id: 1, agent: OTHER, policy: 'S-1', cls: 'New Business', amount: 100, thei: 50, bsi: 50 }),
    row({ id: 2, agent: OTHER, policy: 'S-2', cls: 'Chargeback', amount: -60, thei: -30, bsi: -30 }),
    row({ id: 3, agent: MARCO, policy: 'S-3', cls: 'New Business', amount: 100, thei: 45, bsi: 45, sub: 10 }),
    row({ id: 4, agent: MARCO, policy: 'S-3', cls: 'Chargeback', amount: -100, thei: -45, bsi: -45, sub: -10 }),
    // older row without the upload's split marker: never listed
    row({ id: 5, agent: OTHER, policy: 'S-5', cls: 'Renewal', amount: 10, thei: 5, bsi: 5, applies: false }),
    // Integrity rows are not house lines
    row({ id: 6, agent: INTEGRITY[0], policy: 'S-6', cls: 'Renewal', amount: 10, thei: 5, bsi: 5 }),
  ];

  it('THEI BSI remittance and BSI Overrides list them at the stored share (no re-split)', () => {
    for (const [type, field] of [[STATEMENT_TYPES.THEI_BSI, 'thei_share'], [STATEMENT_TYPES.BSI_OVERRIDE, 'bsi_share']]) {
      const b = buildOverrideStatements(rows, type, { period: '202609' });
      const lines = b.statements.flatMap((s) => s.lines);
      expect(lines.map((l) => l.id).sort()).toEqual([1, 2, 3, 4]);
      for (const l of lines) expect(l.amount).toBe(l[field]);
      expect(b.grandTotal).toBeCloseTo(50 - 30 + 45 - 45, 2);
    }
  });

  it('Marco (Swan) statement lists his $10 and its reversal', () => {
    const b = buildOverrideStatements(rows, STATEMENT_TYPES.MARCO, { period: '202609' });
    const lines = b.statements.flatMap((s) => s.lines);
    expect(lines.map((l) => l.amount)).toEqual([10, -10]);
  });

  it('Integrity statement does not pick up house lines', () => {
    const b = buildOverrideStatements(rows, STATEMENT_TYPES.INTEGRITY, { period: '202609' });
    const ids = b.statements.flatMap((s) => s.lines).map((l) => l.id);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(3);
  });

  it('isBsiHouseSplitLine excludes Lina, Integrity, overrides, HRA and non-BSI rows', () => {
    const base = rows[0];
    expect(isBsiHouseSplitLine(base)).toBe(true);
    expect(isBsiHouseSplitLine({ ...base, agent_name: ALBA_DB_AGENT })).toBe(false);
    expect(isBsiHouseSplitLine({ ...base, agent_name: INTEGRITY[1] })).toBe(false);
    expect(isBsiHouseSplitLine({ ...base, classification: 'Agency Override' })).toBe(false);
    expect(isBsiHouseSplitLine({ ...base, classification: 'HRA/Bonus' })).toBe(false);
    expect(isBsiHouseSplitLine({ ...base, source: 'NHP' })).toBe(false);
    expect(isBsiHouseSplitLine({ ...base, thei_share: 0, bsi_share: 0 })).toBe(false);
  });
});

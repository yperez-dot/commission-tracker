'use strict';

const {
  applyBsiBookAgentProduction,
  isBsiHouseAgent,
  peelAlbaProduction,
  normalizeRateCarrier,
  ALBA_DB_AGENT,
  ALBA_NPN,
} = require('../bsiBookAttribution');
const { isAlbaHernandez } = require('../payeeSchedules');

describe('bsiBookAttribution', () => {
  it('peels UHC house NB with rate table: albaComp + THEI/BSI 50/50', () => {
    // UHC National Initial override = $150 → albaComp = 323.50 − 150 = 173.50
    const records = [
      {
        agent: 'Broker Society Insurance',
        classification: 'New Business',
        commission: 323.5,
        carrier: 'UnitedHealthcare',
        memberState: 'FL',
        raw: {
          'Comp Type': 'N',
          'Commission Action': 'New',
          'Member State': 'FL',
        },
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].agent).toBe(ALBA_DB_AGENT);
    expect(records[0].producerPayable).toBe(173.5);
    expect(records[0].theiShare).toBe(75);
    expect(records[0].bsiShare).toBe(75);
    expect(records[0].theiShare + records[0].bsiShare + records[0].producerPayable).toBeCloseTo(
      323.5,
      2
    );
  });

  it('uses Comp Type R for Renewal rate even when Action is New', () => {
    // UHC National Renewal = $75 → albaComp = 211 − 75 = 136
    const records = [
      {
        agent: 'Broker Society Insurance',
        classification: 'New Business',
        commission: 211,
        carrier: 'UnitedHealthcare',
        raw: {
          'Comp Type': 'R',
          'Commission Action': 'New',
          'Member State': 'FL',
        },
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(136);
    expect(records[0].theiShare).toBe(37.5);
    expect(records[0].bsiShare).toBe(37.5);
  });

  it('does NOT remap Agency Override under BSI house (not Lina pay)', () => {
    const records = [
      {
        agent: 'Broker Society Insurance',
        classification: 'Agency Override',
        commission: 75,
        carrier: 'UnitedHealthcare',
      },
      {
        agent: 'Broker Society Insurance',
        classification: 'Held',
        commission: 75,
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].agent).toBe('Broker Society Insurance');
    expect(records[0].producerPayable).toBe(0);
    expect(records[1].agent).toBe('Broker Society Insurance');
    expect(records[1].producerPayable).toBe(0);
  });

  it('peels Alba-named Aetna renewals with state rate', () => {
    // Aetna National Renewal override = $45 → albaComp = 90 − 45 = 45
    const records = [
      {
        agent: 'Alba Hernandez',
        classification: 'Renewal',
        commission: 90,
        carrier: 'Aetna',
        memberState: 'TX',
        raw: { 'Sales Event': 'Renewal', State: 'TX' },
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].agent).toBe(ALBA_DB_AGENT);
    expect(records[0].producerPayable).toBe(45);
    expect(records[0].theiShare).toBe(22.5);
    expect(records[0].bsiShare).toBe(22.5);
  });

  it('signs chargeback peels', () => {
    const records = [
      {
        agent: 'Broker Society Insurance',
        classification: 'Chargeback',
        commission: -175.83,
        carrier: 'UnitedHealthcare',
        raw: {
          'Comp Type': 'R',
          'Member State': 'TX',
        },
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].agent).toBe(ALBA_DB_AGENT);
    expect(records[0].theiShare).toBeLessThan(0);
    expect(records[0].bsiShare).toBeLessThan(0);
    expect(
      records[0].producerPayable + records[0].theiShare + records[0].bsiShare
    ).toBeCloseTo(-175.83, 2);
  });

  it('leaves other individual agents unchanged', () => {
    const records = [
      {
        agent: 'Kelly Carpenter',
        classification: 'New Business',
        commission: 150,
        carrier: 'UnitedHealthcare',
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].agent).toBe('Kelly Carpenter');
    expect(records[0].producerPayable).toBeUndefined();
  });

  it('detects BSI house agent names and normalizes carriers', () => {
    expect(isBsiHouseAgent('Broker Society Insurance')).toBe(true);
    expect(isBsiHouseAgent('BSI')).toBe(true);
    expect(isBsiHouseAgent('Alba Hernandez')).toBe(false);
    expect(isAlbaHernandez(ALBA_DB_AGENT)).toBe(true);
    expect(ALBA_NPN).toBe('21209073');
    expect(normalizeRateCarrier('UnitedHealthcare')).toBe('UHC');
    expect(normalizeRateCarrier('Aetna')).toBe('Aetna');
  });

  it('peelAlbaProduction flags missing year type for review', () => {
    const peel = peelAlbaProduction(
      {
        carrier: 'UHC',
        classification: 'Mystery',
        raw: {},
      },
      100
    );
    // classification Mystery is not used as year fallback in peel input when
    // commissionAction empty and no raw fields — needsReview
    expect(peel.ok).toBe(false);
    expect(peel.producerPayable).toBe(100);
    expect(peel.theiShare).toBe(0);
  });
});

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
    expect(records[0].theiShare).toBe(37.5);
    expect(records[0].bsiShare).toBe(37.5);
    expect(records[0].source).toBe('BSI');
    expect(records[1].agent).toBe('Broker Society Insurance');
    expect(records[1].producerPayable).toBe(0);
    expect(records[1].theiShare).toBeUndefined();
  });

  it('splits Integrity Agency Override 50/25/25 (not 50/50)', () => {
    const records = [
      {
        agent: 'Christian Munoz',
        classification: 'Agency Override',
        commission: 80,
        carrier: 'Humana',
        period: '202608',
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(40);
    expect(records[0].theiShare).toBe(20);
    expect(records[0].bsiShare).toBe(20);
  });

  it('does not overwrite Agency Override shares that were already written', () => {
    const records = [
      {
        agent: 'Christian Munoz',
        classification: 'Agency Override',
        commission: 80,
        theiShare: 20,
        bsiShare: 20,
        producerPayable: 40,
        source: 'BSI',
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].theiShare).toBe(20);
    expect(records[0].bsiShare).toBe(20);
    expect(records[0].producerPayable).toBe(40);
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

describe('chargeback override proration (UHC, Alba book)', () => {
  const { chargebackUnearnedFactor } = require('../bsiBookAttribution');

  // Example member (fictional) — Sept 2026 UHC chargeback of -105.50 on a 01/01/2026 policy termed 09/30/2026.
  // BSI's statement charges Lina -86.75; the $18.75 difference is the $75 renewal override × 3/12.
  const sampleChargeback = (extraRaw = {}, commission = -105.5) => ({
    agent: 'Broker Society Insurance',
    classification: 'Chargeback',
    commission,
    carrier: 'UnitedHealthcare',
    memberState: 'FL',
    effectiveDate: '01/01/2026',
    raw: {
      'Comp Type': 'R',
      'Commission Action': 'New Chargeback',
      'Member State': 'FL',
      Contract: 'H1045',
      PBP: '001',
      'Original Effective Date': '01/01/2026',
      'Term Date': '09/30/2026',
      ...extraRaw,
    },
  });

  it('prorates the override by unearned months: Lina -86.75, override -18.75 split THEI/BSI', () => {
    const records = [sampleChargeback()];
    applyBsiBookAgentProduction(records);
    const r = records[0];
    expect(r.agent).toBe(ALBA_DB_AGENT);
    expect(r.producerPayable).toBe(-86.75);
    expect(r.theiShare + r.bsiShare).toBeCloseTo(-18.75, 2);
    expect(r.producerPayable + r.theiShare + r.bsiShare).toBeCloseTo(-105.5, 2);
    expect(r.mga).toMatch(/prorated 3\/12/);
  });

  it('without a Term Date keeps the previous full-override behavior', () => {
    const records = [sampleChargeback({ 'Term Date': '' })];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(-30.5);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(-75, 2);
  });

  it('leaves positive commissions untouched', () => {
    const records = [sampleChargeback({}, 323.5)];
    records[0].classification = 'New Business';
    records[0].raw['Commission Action'] = 'New';
    records[0].raw['Comp Type'] = 'N';
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(173.5);
    expect(records[0].theiShare).toBe(75);
  });

  it('computes earned/unearned months from effective and term dates', () => {
    expect(chargebackUnearnedFactor(sampleChargeback())).toEqual({ earnedMonths: 9, unearnedMonths: 3, factor: 0.25 });
    // Feb eff, Aug term → 7 earned, 5 unearned (matches the -62.50 chargeback on a $150 override)
    const f = chargebackUnearnedFactor({ raw: { 'Original Effective Date': '02/01/2026', 'Term Date': '08/31/2026' } });
    expect(f.unearnedMonths).toBe(5);
    // Excel serial dates work too (46023 = 01/01/2026, 46295 = 09/30/2026)
    expect(
      chargebackUnearnedFactor({ raw: { 'Original Effective Date': 46023, 'Term Date': 46295 } }).unearnedMonths
    ).toBe(3);
    // older than a policy year or never effective → no proration
    expect(chargebackUnearnedFactor({ raw: { 'Original Effective Date': '10/01/2024', 'Term Date': '09/30/2026' } })).toBeNull();
    expect(chargebackUnearnedFactor({ raw: { 'Original Effective Date': '10/01/2026', 'Term Date': '09/30/2026' } })).toBeNull();
    expect(chargebackUnearnedFactor({ raw: {} })).toBeNull();
  });
});

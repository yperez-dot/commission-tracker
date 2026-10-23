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
    // Aetna National Renewal override = $45 a year. A $90 line is 90 / (347 + 45) of the
    // annual renewal, so only that share of the override comes off: 45 × 90/392 = 10.33.
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
    expect(records[0].producerPayable).toBe(79.67);
    expect(records[0].theiShare).toBe(5.17);
    expect(records[0].bsiShare).toBe(5.16);
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

  it('other individual agents: house split, not remapped (Swan/Marco agent: $10 first)', () => {
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
    expect(records[0].producerPayable).toBe(0);
    expect(records[0].subAgentOverride).toBe(10);
    expect(records[0].theiShare).toBe(70);
    expect(records[0].bsiShare).toBe(70);
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

describe('Integrity chargebacks on BSI feeds', () => {
  const base = {
    carrier: 'UnitedHealthcare',
    client: 'SAMPLE, MEMBER',
    policyNumber: 'TEST-CB-1',
    period: '202609',
    payee: 'BSI',
    raw: {},
  };

  it('splits a -50 Integrity chargeback 50/25/25 (producer -25, THEI -12.50, BSI -12.50)', () => {
    const records = [
      { ...base, agent: 'Christian Munoz', classification: 'Chargeback', commission: -50 },
      { ...base, agent: 'Cam Insurance Solutions Corp', classification: 'Chargeback', commission: -50 },
      { ...base, agent: 'Horacio Mendieta', classification: 'Chargeback', commission: -50 },
    ];
    applyBsiBookAgentProduction(records);
    for (const r of records) {
      expect(r.producerPayable).toBe(-25);
      expect(r.theiShare).toBe(-12.5);
      expect(r.bsiShare).toBe(-12.5);
      expect(r.grossCommission).toBe(-50);
      expect(r.source).toBe('BSI');
      expect(r.agent).not.toBe(ALBA_DB_AGENT);
    }
  });

  it('Integrity renewals: producer 0, amount split 50/50 THEI/BSI', () => {
    const records = [
      { ...base, agent: 'Christian Munoz', classification: 'Renewal', commission: 6 },
      { ...base, agent: 'Cam Insurance Solutions Corp', classification: 'Renewal', commission: 6 },
      { ...base, agent: 'Horacio Mendieta', classification: 'Renewal', commission: 6.25 },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(0);
    expect(records[0].theiShare).toBe(3);
    expect(records[0].bsiShare).toBe(3);
    expect(records[1].producerPayable).toBe(0);
    expect(records[2].producerPayable).toBe(0);
    expect(records[2].theiShare + records[2].bsiShare).toBeCloseTo(6.25, 2);
    for (const r of records) {
      expect(r.grossCommission).toBe(r.commission);
      expect(r.agent).not.toBe(ALBA_DB_AGENT);
    }
  });

  it('Integrity new sales on UHC / Aetna feeds: 50/25/25', () => {
    const records = [
      { ...base, agent: 'Christian Munoz', classification: 'New Business', commission: 150 },
      { ...base, carrier: 'Aetna', agent: 'Horacio Mendieta', classification: 'New Business', commission: 150 },
    ];
    applyBsiBookAgentProduction(records);
    for (const r of records) {
      expect(r.producerPayable).toBe(75);
      expect(r.theiShare).toBe(37.5);
      expect(r.bsiShare).toBe(37.5);
    }
  });

  it('Humana/Devoted: Integrity renewal rows (First Year/Renewal) are not paid; first-year rows are', () => {
    const hd = { ...base, carrier: 'Humana', classification: 'Agency Override', commission: 165 };
    const records = [
      { ...hd, agent: 'Christian Munoz', raw: { 'First Year/Renewal': 'Renewal' } },
      { ...hd, agent: 'Horacio Mendieta', raw: { 'First Year/Renewal': 'First Year' } },
      { ...hd, agent: 'Horacio Mendieta', raw: { 'First Year/Renewal': '' } },
      { ...hd, agent: 'Horacio Mendieta', raw: {} },
      { ...hd, agent: 'Test Agent Example', raw: { 'First Year/Renewal': 'Renewal' } },
      { ...hd, agent: 'Christian Munoz', classification: 'Chargeback', commission: -165,
        raw: { 'First Year/Renewal': 'Renewal' } },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(0);
    expect(records[0].theiShare).toBe(82.5);
    expect(records[0].bsiShare).toBe(82.5);
    // first year / blank / missing column → normal 50/25/25
    for (const r of records.slice(1, 4)) {
      expect(r.producerPayable).toBe(82.5);
      expect(r.theiShare).toBe(41.25);
    }
    // other agents keep the standard 50/50 house split
    expect(records[4].producerPayable).toBe(0);
    expect(records[4].theiShare).toBe(82.5);
    // chargeback of a renewal was never paid → nothing back from the producer
    expect(records[5].producerPayable).toBe(0);
    expect(records[5].theiShare).toBe(-82.5);
    expect(records[5].bsiShare).toBe(-82.5);
  });

  it('Integrity rules never apply to other writing agents (e.g. Piloto, Santiago)', () => {
    const records = [
      { ...base, agent: 'Edgar Piloto', classification: 'New Business', commission: 150 },
      { ...base, agent: 'Ivan Santiago', classification: 'Chargeback', commission: -61.88 },
      { ...base, agent: 'Ivan Santiago', classification: 'Renewal', commission: 6 },
    ];
    applyBsiBookAgentProduction(records);
    // They get the other-agent house split (producer 0, THEI/BSI 50/50), never 50/25/25.
    for (const r of records) {
      expect(r.producerPayable).toBe(0);
      expect(r.theiShare + r.bsiShare).toBeCloseTo(r.commission, 2);
      expect(r.theiShare).toBeCloseTo(r.commission / 2, 2);
    }
  });

  it('non-Integrity renewals and chargebacks get the house split (no agent share)', () => {
    const records = [
      { ...base, agent: 'Test Agent Example', classification: 'Renewal', commission: 6 },
      { ...base, agent: 'Test Agent Example', classification: 'Chargeback', commission: -50 },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0]).toMatchObject({ producerPayable: 0, theiShare: 3, bsiShare: 3 });
    expect(records[1]).toMatchObject({ producerPayable: 0, theiShare: -25, bsiShare: -25 });
  });

  it('does not overwrite a split a parser already set', () => {
    const records = [
      {
        ...base, agent: 'Horacio Mendieta', classification: 'Chargeback', commission: -50,
        producerPayable: 0, theiShare: -25, bsiShare: -25,
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(0);
    expect(records[0].theiShare).toBe(-25);
  });
});

describe('Integrity BSI UHC rate table (plan year 2026 = $82.50 on a full $150 line)', () => {
  const uhc = {
    carrier: 'UnitedHealthcare', client: 'SAMPLE, MEMBER', period: '202609', payee: 'BSI', raw: {},
  };

  it('full $150 2026 line → producer 82.50, BSI 37.50, THEI 30 for Munoz, CAM and Mendieta', () => {
    const records = ['Christian Munoz', 'Cam Insurance Solutions Corp', 'Horacio Mendieta'].map((agent, i) => ({
      ...uhc, agent, policyNumber: `TEST-F${i}`, classification: 'New Business', commission: 150, effectiveDate: '03/01/2026',
    }));
    applyBsiBookAgentProduction(records);
    for (const r of records) {
      expect(r.producerPayable).toBe(82.5);
      expect(r.bsiShare).toBe(37.5);
      expect(r.theiShare).toBe(30);
      expect(r.mga).toMatch(/pending confirmation/);
    }
  });

  it('partial 2026 line stays at 50% and is flagged; other plan years use 50% (no extrapolation)', () => {
    const records = [
      { ...uhc, agent: 'Horacio Mendieta', policyNumber: 'TEST-P1', classification: 'New Business', commission: 37.5, effectiveDate: '06/01/2026' },
      { ...uhc, agent: 'Christian Munoz', policyNumber: 'TEST-P2', classification: 'New Business', commission: 150, effectiveDate: '01/01/2027' },
      { ...uhc, agent: 'Christian Munoz', policyNumber: 'TEST-P3', classification: 'New Business', commission: 150, effectiveDate: '12/01/2025' },
      { ...uhc, carrier: 'Aetna', agent: 'Christian Munoz', policyNumber: 'TEST-P4', classification: 'New Business', commission: 150, effectiveDate: '03/01/2026' },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(18.75);
    expect(records[0].mga).toMatch(/review/);
    for (const r of records.slice(1)) {
      expect(r.producerPayable).toBe(75);
      expect(r.theiShare).toBe(37.5);
      expect(r.bsiShare).toBe(37.5);
    }
  });

  it('chargeback takes back exactly what was paid on the policy (earlier upload or same file)', () => {
    const originals = new Map([['test-c1', { gross: 150, producer: 82.5 }], ['test-c2', { gross: 37.5, producer: 18.75 }]]);
    const records = [
      { ...uhc, agent: 'Horacio Mendieta', policyNumber: 'TEST-C1', classification: 'Chargeback', commission: -150 },
      { ...uhc, agent: 'Christian Munoz', policyNumber: 'TEST-C2', classification: 'Chargeback', commission: -37.5 },
      // chargeback listed before its sale in the same file
      { ...uhc, agent: 'Christian Munoz', policyNumber: 'TEST-C3', classification: 'Chargeback', commission: -150 },
      { ...uhc, agent: 'Christian Munoz', policyNumber: 'TEST-C3', classification: 'New Business', commission: 150, effectiveDate: '02/01/2026' },
      // partial chargeback of a fixed-rate sale → same proportion of what was paid
      { ...uhc, agent: 'Horacio Mendieta', policyNumber: 'TEST-C1', classification: 'Chargeback', commission: -75 },
    ];
    applyBsiBookAgentProduction(records, { integrityOriginalSales: originals });
    expect(records[0].producerPayable).toBe(-82.5);
    expect(records[0].bsiShare).toBe(-37.5);
    expect(records[0].theiShare).toBe(-30);
    expect(records[1].producerPayable).toBe(-18.75);
    expect(records[2].producerPayable).toBe(-82.5);
    expect(records[4].producerPayable).toBe(-41.25);
    for (const r of [records[0], records[1], records[2], records[4]]) {
      expect(r.producerPayable + r.theiShare + r.bsiShare).toBeCloseTo(r.commission, 2);
      expect(r.mga || '').not.toMatch(/not found/);
    }
  });

  it('chargeback with no original, plan year 2026 → fixed $82.50 share of the line, flagged', () => {
    const records = [
      { ...uhc, agent: 'Horacio Mendieta', policyNumber: 'TEST-Y1', classification: 'Chargeback', commission: -150, effectiveDate: '04/01/2026' },
      { ...uhc, agent: 'Cam Insurance Solutions Corp', policyNumber: 'TEST-Y2', classification: 'Chargeback', commission: -75, effectiveDate: '04/01/2026' },
      { ...uhc, agent: 'Christian Munoz', policyNumber: 'TEST-Y3', classification: 'Chargeback', commission: -62.5, effectiveDate: '04/01/2026' },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(-82.5);
    expect(records[0].bsiShare).toBe(-37.5);
    expect(records[0].theiShare).toBe(-30);
    expect(records[1].producerPayable).toBe(-41.25);
    expect(records[1].bsiShare).toBe(-18.75);
    expect(records[1].theiShare).toBe(-15);
    expect(records[2].producerPayable).toBe(-34.38);
    for (const r of records) {
      expect(r.producerPayable + r.theiShare + r.bsiShare).toBeCloseTo(r.commission, 2);
      expect(Math.abs(r.producerPayable)).toBeLessThanOrEqual(Math.abs(r.commission));
      expect(r.mga).toMatch(/not found/);
    }
  });

  it('chargeback with no original and no plan-year entry → 50% of the line, flagged', () => {
    const records = [
      { ...uhc, agent: 'Horacio Mendieta', policyNumber: 'TEST-N1', classification: 'Chargeback', commission: -150 },
      { ...uhc, agent: 'Horacio Mendieta', policyNumber: 'TEST-N2', classification: 'Chargeback', commission: -150, effectiveDate: '12/01/2025' },
    ];
    applyBsiBookAgentProduction(records);
    for (const r of records) {
      expect(r.producerPayable).toBe(-75);
      expect(r.theiShare).toBe(-37.5);
      expect(r.bsiShare).toBe(-37.5);
      expect(r.mga).toMatch(/not found/);
    }
  });

  it('other writing agents never get the Integrity rate', () => {
    const records = [
      { ...uhc, agent: 'Edgar Piloto', policyNumber: 'TEST-O1', classification: 'New Business', commission: 150, effectiveDate: '03/01/2026' },
      { ...uhc, agent: 'Ivan Santiago', policyNumber: 'TEST-O2', classification: 'Chargeback', commission: -150 },
    ];
    applyBsiBookAgentProduction(records, { integrityOriginalSales: new Map([['test-o2', { gross: 150, producer: 82.5 }]]) });
    // house split 50/50, never the fixed $82.50 or a producer share
    expect(records[0]).toMatchObject({ producerPayable: 0, theiShare: 75, bsiShare: 75 });
    expect(records[1]).toMatchObject({ producerPayable: 0, theiShare: -75, bsiShare: -75 });
  });
});

describe('Lina Aetna monthly renewals: override prorated to the line', () => {
  // Made-up lines. Annual renewal amount = CMS renewal FMV for the state + annual override.
  const base = {
    agent: 'Alba Hernandez',
    carrier: 'Aetna',
    classification: 'Renewal',
    policyNumber: 'TEST-R1',
    period: '202609',
    payee: 'BSI',
  };

  it('a 1/12 monthly line gives back 1/12 of the annual override (National: 347 + 45)', () => {
    const line = 32.67; // (347 + 45) / 12
    const records = [{ ...base, commission: line, memberState: 'GA', raw: { 'Sales Event': 'Renewal', 'Member State': 'GA' } }];
    applyBsiBookAgentProduction(records);
    const r = records[0];
    expect(r.theiShare + r.bsiShare).toBeCloseTo(3.75, 2);
    expect(r.producerPayable).toBe(28.92);
    expect(r.producerPayable + r.theiShare + r.bsiShare).toBeCloseTo(line, 2);
    expect(r.mga).toMatch(/prorated to this line/);
  });

  it('uses the state FMV (CA: 432 + 50) and the plan group (FL D-SNP: 347 + 240)', () => {
    const records = [
      { ...base, commission: 40.17, memberState: 'CA', raw: { 'Sales Event': 'Renewal' } },
      { ...base, commission: 48.92, memberState: 'FL', planId: 'H1609-043', raw: { 'Sales Event': 'Renewal', 'Plan ID': 'H1609-043' } },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(4.17, 2);
    expect(records[0].producerPayable).toBe(36);
    expect(records[1].theiShare + records[1].bsiShare).toBeCloseTo(20, 2);
    expect(records[1].producerPayable).toBe(28.92);
  });

  it('a full annual renewal line still gives back the full annual override', () => {
    const records = [{ ...base, commission: 392, memberState: 'GA', raw: { 'Sales Event': 'Renewal' } }];
    applyBsiBookAgentProduction(records);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(45, 2);
    expect(records[0].producerPayable).toBe(347);
  });

  it('no member state → 1/12 of the override, flagged; never negative for Lina', () => {
    const records = [
      { ...base, commission: 30, raw: { 'Sales Event': 'Renewal' } },
      { ...base, policyNumber: 'TEST-R2', commission: 2, raw: { 'Sales Event': 'Renewal' } },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(3.75, 2);
    expect(records[0].producerPayable).toBe(26.25);
    expect(records[0].mga).toMatch(/1\/12/);
    // 1/12 of 45 = 3.75 > the $2 line → capped at the line, Lina 0
    expect(records[1].theiShare + records[1].bsiShare).toBeCloseTo(2, 2);
    expect(records[1].producerPayable).toBe(0);
  });

  it('Aetna new business, UHC renewals and chargebacks keep their existing peel', () => {
    const records = [
      { ...base, classification: 'New Business', commission: 694 + 125, memberState: 'GA', raw: { 'Sales Event': 'New Business' } },
      { ...base, carrier: 'UnitedHealthcare', commission: 211, raw: { 'Comp Type': 'R', 'Commission Action': 'Renewal', 'Member State': 'FL' } },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(125, 2);
    expect(records[0].producerPayable).toBe(694);
    expect(records[1].producerPayable).toBe(136);
  });

  it('Lina CMS Trueup splits like a new sale; the override never exceeds the line', () => {
    const records = [
      // full National initial override paid on its own → all override, Lina 0
      { ...base, policyNumber: 'TEST-T1', classification: 'New Business', commission: 125, memberState: 'GA', raw: { 'Sales Event': 'CMS Trueup' } },
      // smaller trueup → capped at the line, Lina never negative
      { ...base, policyNumber: 'TEST-T2', classification: 'New Business', commission: 41.66, memberState: 'GA', raw: { 'Sales Event': 'CMS Trueup' } },
      // trueup that includes Lina's own commission → normal new-sale peel
      { ...base, policyNumber: 'TEST-T3', classification: 'New Business', commission: 819, memberState: 'GA', raw: { 'Sales Event': 'CMS Trueup' } },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(0);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(125, 2);
    expect(records[1].producerPayable).toBe(0);
    expect(records[1].theiShare + records[1].bsiShare).toBeCloseTo(41.66, 2);
    expect(records[2].producerPayable).toBe(694);
    expect(records[2].theiShare + records[2].bsiShare).toBeCloseTo(125, 2);
  });
});

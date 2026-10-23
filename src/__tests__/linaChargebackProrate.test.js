'use strict';

// Synthetic data only (made-up policies and amounts).
const { applyBsiBookAgentProduction, ALBA_DB_AGENT } = require('../bsiBookAttribution');
const {
  linaProportionalChargeback,
  addLinaOriginal,
  linaPolicyKey,
} = require('../linaChargebackProrate');
const { planBsiHouseSplitBackfill } = require('../bsiHouseSplitBackfill');

const uhc = { carrier: 'UnitedHealthcare', period: '202609', payee: 'BSI', client: 'SAMPLE, MEMBER', raw: {} };
const orig = (o) => new Map([[`uhc|${o.policy.toLowerCase()}`, { gross: o.gross, producer: o.producer, thei: o.thei, bsi: o.bsi }]]);

describe('linaProportionalChargeback', () => {
  it('Lina takes back her share of the original; THEI/BSI split the rest in their original proportion', () => {
    expect(linaProportionalChargeback(-80, { gross: 200, producer: 150, thei: 25, bsi: 25 }))
      .toMatchObject({ producerPayable: -60, theiShare: -10, bsiShare: -10 });
    expect(linaProportionalChargeback(-100, { gross: 200, producer: 100, thei: 60, bsi: 40 }))
      .toMatchObject({ producerPayable: -50, theiShare: -30, bsiShare: -20 });
    // no THEI/BSI on the original → 50/50 of the rest
    expect(linaProportionalChargeback(-50, { gross: 100, producer: 80, thei: 0, bsi: 0 }))
      .toMatchObject({ producerPayable: -40, theiShare: -5, bsiShare: -5 });
  });

  it('shares always add up to the chargeback (rounding goes to BSI)', () => {
    const s = linaProportionalChargeback(-33.33, { gross: 300, producer: 230, thei: 35, bsi: 35 });
    expect(s.producerPayable + s.theiShare + s.bsiShare).toBeCloseTo(-33.33, 2);
  });

  it('no usable original → null (caller keeps current logic)', () => {
    expect(linaProportionalChargeback(-50, null)).toBeNull();
    expect(linaProportionalChargeback(-50, { gross: 0, producer: 0, thei: 0, bsi: 0 })).toBeNull();
    expect(linaProportionalChargeback(50, { gross: 100, producer: 50, thei: 25, bsi: 25 })).toBeNull();
  });

  it('originals: positive Lina lines only, by carrier + policy; HRA / fee / override excluded', () => {
    const m = new Map();
    addLinaOriginal(m, { agent: ALBA_DB_AGENT, carrier: 'UnitedHealthcare', policyNumber: 'Z-1', classification: 'New Business', commission: 100, producerPayable: 70, theiShare: 15, bsiShare: 15 });
    addLinaOriginal(m, { agent: ALBA_DB_AGENT, carrier: 'UnitedHealthcare', policyNumber: 'Z-1', classification: 'Renewal', commission: 20, producerPayable: 18, theiShare: 1, bsiShare: 1 });
    addLinaOriginal(m, { agent: ALBA_DB_AGENT, carrier: 'UnitedHealthcare', policyNumber: 'Z-1', classification: 'HRA/Bonus', commission: 50, producerPayable: 50 });
    addLinaOriginal(m, { agent: ALBA_DB_AGENT, carrier: 'UnitedHealthcare', policyNumber: 'Z-1', classification: 'Chargeback', commission: -20, producerPayable: -18 });
    addLinaOriginal(m, { agent: 'Sample Writer Alpha', carrier: 'UnitedHealthcare', policyNumber: 'Z-1', classification: 'New Business', commission: 100 });
    addLinaOriginal(m, { agent: ALBA_DB_AGENT, carrier: 'Aetna', policyNumber: 'Z-1', classification: 'New Business', commission: 100, producerPayable: 10 });
    expect(m.get('uhc|z-1')).toEqual({ gross: 120, producer: 88, thei: 16, bsi: 16 });
    expect(m.get('aetna|z-1').gross).toBe(100);
    expect(linaPolicyKey({ carrier: 'UnitedHealthcare', policy_number: ' Z-1 ' })).toBe('uhc|z-1');
  });
});

describe('BSI upload: Lina chargebacks in proportion (all BSI carriers)', () => {
  const cb = (o) => ({ ...uhc, agent: ALBA_DB_AGENT, classification: 'Chargeback', memberState: 'FL',
    raw: { 'Commission Action': 'Chargeback', 'Member State': 'FL' }, ...o });

  it('uses the original payment(s) from earlier uploads', () => {
    const records = [cb({ policyNumber: 'L-1', commission: -80 })];
    applyBsiBookAgentProduction(records, { linaOriginalSales: orig({ policy: 'L-1', gross: 200, producer: 150, thei: 25, bsi: 25 }) });
    expect(records[0]).toMatchObject({ agent: ALBA_DB_AGENT, producerPayable: -60, theiShare: -10, bsiShare: -10, grossCommission: -80 });
    expect(records[0].mga).toMatch(/in proportion to the original payment/);
    expect(records[0].mga).not.toMatch(/Alba rate review/);
  });

  it('uses a sale earlier in the same file (after its rate peel)', () => {
    const records = [
      { ...uhc, agent: 'Broker Society Insurance', policyNumber: 'L-2', classification: 'New Business',
        commission: 323.5, memberState: 'FL', raw: { 'Commission Action': 'New', 'Member State': 'FL' } },
      cb({ policyNumber: 'L-2', commission: -100 }),
    ];
    applyBsiBookAgentProduction(records);
    const sale = records[0];
    const frac = sale.producerPayable / sale.commission;
    expect(records[1].producerPayable).toBeCloseTo(-100 * frac, 2);
    expect(records[1].theiShare).toBeCloseTo(records[1].bsiShare, 1);
    expect(records[1].producerPayable + records[1].theiShare + records[1].bsiShare).toBeCloseTo(-100, 2);
  });

  it('Humana / Aetna feeds too (by carrier)', () => {
    for (const carrier of ['Humana', 'Aetna']) {
      const key = new Map([[`${carrier.toLowerCase()}|l-3`, { gross: 100, producer: 60, thei: 20, bsi: 20 }]]);
      const records = [cb({ carrier, policyNumber: 'L-3', commission: -50 })];
      applyBsiBookAgentProduction(records, { linaOriginalSales: key });
      expect(records[0]).toMatchObject({ producerPayable: -30, theiShare: -10, bsiShare: -10 });
    }
  });

  it('no original found (or another carrier\'s policy) → current logic unchanged', () => {
    const plain = [cb({ policyNumber: 'L-4', commission: -323.5 })];
    applyBsiBookAgentProduction(plain);
    const other = [cb({ policyNumber: 'L-4', commission: -323.5 })];
    applyBsiBookAgentProduction(other, { linaOriginalSales: new Map([['aetna|l-4', { gross: 100, producer: 10, thei: 45, bsi: 45 }]]) });
    for (const k of ['producerPayable', 'theiShare', 'bsiShare']) expect(other[0][k]).toBe(plain[0][k]);
    expect(plain[0].mga || '').not.toMatch(/in proportion/);
  });

  it('HRA lines are never re-split; the caller\'s map is not changed', () => {
    const m = orig({ policy: 'L-5', gross: 200, producer: 150, thei: 25, bsi: 25 });
    const records = [{ ...uhc, agent: ALBA_DB_AGENT, policyNumber: 'L-5', classification: 'HRA/Bonus', commission: -50, producerPayable: -50 }];
    applyBsiBookAgentProduction(records, { linaOriginalSales: m });
    expect(records[0].producerPayable).toBe(-50);
    expect(m.get('uhc|l-5')).toEqual({ gross: 200, producer: 150, thei: 25, bsi: 25 });
  });
});

describe('backfill: lina_cb_prorate', () => {
  const row = (o) => ({
    id: o.id, agent_name: ALBA_DB_AGENT, carrier: 'UnitedHealthcare', classification: o.cls || 'Chargeback',
    commission: o.amount, policy_number: o.policy, payment_period: '202609', producer_payable: o.producer,
    thei_share: o.thei, bsi_share: o.bsi, sub_agent_override: 0, split_applies: false,
    mga: o.mga || '', source: 'BSI',
  });

  it('re-splits a stored Lina chargeback whose split differs from the proportional one', () => {
    const rows = [row({ id: 1, policy: 'B-1', amount: -80, producer: -64, thei: -8, bsi: -8, mga: 'Chargeback override prorated 6/12 (x → y)' })];
    const linaOriginals = orig({ policy: 'B-1', gross: 200, producer: 150, thei: 25, bsi: 25 });
    const { updates, summary } = planBsiHouseSplitBackfill(rows, { linaOriginals });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: 1, kind: 'lina_cb_prorate', splitApplies: false, grossCommission: -80 });
    expect(updates[0].before).toMatchObject({ producerPayable: -64, theiShare: -8, bsiShare: -8 });
    expect(updates[0].after).toMatchObject({ producerPayable: -60, theiShare: -10, bsiShare: -10, subAgentOverride: 0 });
    expect(updates[0].mga).toMatch(/^Lina chargeback taken back in proportion/);
    expect(summary).toMatchObject({ linaDelta: 4, theiDelta: -2, bsiDelta: -2 });
  });

  it('leaves rows already proportional, rows with no original, HRA and positive lines', () => {
    const rows = [
      row({ id: 2, policy: 'B-2', amount: -80, producer: -60, thei: -10, bsi: -10 }),
      row({ id: 3, policy: 'B-3', amount: -80, producer: -64, thei: -8, bsi: -8 }),
      row({ id: 4, policy: 'B-2', cls: 'HRA/Bonus', amount: -20, producer: -20, thei: 0, bsi: 0 }),
      row({ id: 5, policy: 'B-2', cls: 'New Business', amount: 200, producer: 150, thei: 25, bsi: 25 }),
    ];
    const linaOriginals = orig({ policy: 'B-2', gross: 200, producer: 150, thei: 25, bsi: 25 });
    expect(planBsiHouseSplitBackfill(rows, { linaOriginals }).updates).toHaveLength(0);
  });
});

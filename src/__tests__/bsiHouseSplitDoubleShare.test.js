'use strict';

// Synthetic data only. Swan/Marco and Integrity agents come from the schedule lists.
const { planBsiHouseSplitBackfill, isOverAllocated, effectiveYear, RECLASS_NOTE } = require('../bsiHouseSplitBackfill');
const { houseFallbackSplit } = require('../houseFallbackSplit');
const { MARCO_AGENTS, INTEGRITY_AGENTS } = require('../payeeSchedules');

const tc = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const SWAN = tc(MARCO_AGENTS[0]);
const INTEGRITY = tc(INTEGRITY_AGENTS[0]);
const OTHER = 'Sample Writer Alpha';
const LINA = 'Alba Hernandez';

let nextId = 1;
const row = (o) => ({
  id: o.id || nextId++, agent_name: o.agent, carrier: o.carrier || 'Humana', classification: o.cls || 'Agency Override',
  commission: o.amount, policy_number: o.policy || `P${nextId}`, payment_period: o.period || '202607',
  gross_commission: o.gross == null ? null : o.gross,
  producer_payable: o.producer == null ? null : o.producer, thei_share: o.thei == null ? null : o.thei,
  bsi_share: o.bsi == null ? null : o.bsi, sub_agent_override: o.sub || 0,
  split_applies: o.applies == null ? true : o.applies, mga: o.mga || '', source: o.source || 'BSI',
  payee: o.payee == null ? 'BSI' : o.payee, effective_date: o.eff || null, upload_id: o.upload || 7,
});
const doubled = (o) => row({ ...o, thei: o.amount, bsi: o.amount, producer: 0, gross: o.amount * 2 });

describe('houseFallbackSplit (no double count)', () => {
  it('mirrors only THE remittance lines', () => {
    expect(houseFallbackSplit(50, { source: 'BSI', payee: 'THE' })).toMatchObject({ grossCommission: 100, theiShare: 50, bsiShare: 50, model: 'half' });
    expect(houseFallbackSplit(50, { source: 'BSI', payee: ' the ' }).model).toBe('half');
  });
  it('splits every other BSI-book line 50/50 of the full pot, whatever the payee says', () => {
    for (const payee of ['Direct', 'Humana', 'Devoted', ' bsi ', '', null]) {
      const s = houseFallbackSplit(63.47, { source: 'BSI', payee });
      expect(s.model).toBe('full_pot');
      expect(s.grossCommission).toBe(63.47);
      expect(s.theiShare + s.bsiShare).toBeCloseTo(63.47, 2);
      expect(s.producerPayable).toBe(0);
    }
  });
  it('keeps the historic half-model for non-BSI sources', () => {
    expect(houseFallbackSplit(20, { source: 'NHP', payee: 'NHP' }).model).toBe('half');
    expect(houseFallbackSplit(20, { source: 'manual', payee: 'Direct' }).model).toBe('half');
  });
});

describe("BSI backfill kind 'double_share_fix'", () => {
  it('resets an override where THEI and BSI each hold the whole line to 50/50', () => {
    const rows = [doubled({ id: 1, agent: OTHER, amount: 100 }), doubled({ id: 2, agent: OTHER, amount: 7.33 })];
    const { updates, summary } = planBsiHouseSplitBackfill(rows, {}, { kinds: ['double_share_fix'] });
    expect(updates.map((u) => u.kind)).toEqual(['double_share_fix', 'double_share_fix']);
    expect(updates[0].after).toEqual({ producerPayable: 0, theiShare: 50, bsiShare: 50, subAgentOverride: 0 });
    // odd cents: BSI gets the remainder, never a cent over the line
    expect(updates[1].after.theiShare + updates[1].after.bsiShare).toBeCloseTo(7.33, 2);
    expect(updates[1].grossCommission).toBe(7.33);
    expect(summary.theiDelta).toBeCloseTo(-(50 + 7.33 - 3.67), 2);
    expect(summary.byUpload['7'].rows).toBe(2);
  });

  it('uses the current schedules: Marco $10 first per policy, Integrity 50/25/25', () => {
    const rows = [
      doubled({ id: 11, agent: SWAN, amount: 40, policy: 'S1' }),
      doubled({ id: 12, agent: INTEGRITY, amount: 80, policy: 'I1' }),
      doubled({ id: 13, agent: SWAN, amount: 40, policy: 'S2' }),
    ];
    const { updates } = planBsiHouseSplitBackfill(rows, { deductedPolicies: new Set(['S2']) });
    const by = Object.fromEntries(updates.map((u) => [u.id, u.after]));
    expect(by[11]).toEqual({ producerPayable: 0, theiShare: 15, bsiShare: 15, subAgentOverride: 10 });
    expect(by[12]).toEqual({ producerPayable: 40, theiShare: 20, bsiShare: 20, subAgentOverride: 0 });
    expect(by[13]).toEqual({ producerPayable: 0, theiShare: 20, bsiShare: 20, subAgentOverride: 0 });
  });

  it('house-split agent production (payee Direct) goes back to the house 50/50', () => {
    const rows = [
      doubled({ id: 21, agent: OTHER, cls: 'New Business', amount: 63.47, payee: 'Direct', carrier: 'UnitedHealthcare' }),
      doubled({ id: 22, agent: OTHER, cls: 'Chargeback', amount: -30, payee: 'Direct', carrier: 'UnitedHealthcare' }),
    ];
    const { updates } = planBsiHouseSplitBackfill(rows, {}, { kinds: ['double_share_fix'] });
    expect(updates).toHaveLength(2);
    expect(updates[0].after.theiShare + updates[0].after.bsiShare).toBeCloseTo(63.47, 2);
    expect(updates[1].after).toEqual({ producerPayable: 0, theiShare: -15, bsiShare: -15, subAgentOverride: 0 });
  });

  it('never touches THE remittance lines, correct splits, Lina, held or HRA lines', () => {
    const rows = [
      doubled({ id: 31, agent: OTHER, amount: 50, payee: 'THE' }),
      row({ id: 32, agent: OTHER, amount: 50, thei: 25, bsi: 25, producer: 0 }),
      row({ id: 33, agent: LINA, amount: 165, thei: 82.5, bsi: 82.5, producer: 15 }),
      doubled({ id: 34, agent: OTHER, amount: 50, cls: 'Held' }),
      doubled({ id: 35, agent: OTHER, amount: 55, cls: 'HRA' }),
    ];
    const { updates, review } = planBsiHouseSplitBackfill(rows, {}, { kinds: ['double_share_fix'] });
    expect(updates).toEqual([]);
    expect(review.map((r) => r.id)).toEqual([33]);
  });

  it('lists over-allocated lines it has no rule for instead of changing them', () => {
    const rows = [doubled({ id: 41, agent: OTHER, cls: 'Bonus', amount: 25 })];
    const { updates, review } = planBsiHouseSplitBackfill(rows, {}, { kinds: ['double_share_fix'] });
    expect(updates).toEqual([]);
    expect(review[0]).toMatchObject({ id: 41, kind: 'double_share_fix' });
  });

  it('is idempotent: a second plan over the fixed rows finds nothing', () => {
    const rows = [doubled({ id: 51, agent: OTHER, amount: 77.77 })];
    const first = planBsiHouseSplitBackfill(rows, {}, { kinds: ['double_share_fix'] });
    const a = first.updates[0].after;
    const fixed = [row({ id: 51, agent: OTHER, amount: 77.77, thei: a.theiShare, bsi: a.bsiShare, producer: a.producerPayable })];
    expect(planBsiHouseSplitBackfill(fixed, {}, { kinds: ['double_share_fix'] }).updates).toEqual([]);
  });

  it('isOverAllocated needs ≥ 2 cents over and a stored split', () => {
    const t = (o) => isOverAllocated({ commission: o.c, theiShare: o.t, bsiShare: o.b, producerPayable: o.p || 0, subAgentOverride: 0 });
    expect(t({ c: 7.33, t: 3.67, b: 3.67 })).toBe(false);
    expect(t({ c: 10, t: 10, b: 10 })).toBe(true);
    expect(t({ c: -10, t: -10, b: -10 })).toBe(true);
    expect(t({ c: 10, t: null, b: null })).toBe(false);
  });
});

describe("BSI backfill kind 'aetna_cb_reclass'", () => {
  const aetna = (o) => row({ carrier: 'Aetna', cls: 'Chargeback', thei: 20, bsi: 20, producer: 0, ...o });
  it('relabels first-year positive Aetna "Chargeback" lines as New Business, label only', () => {
    const rows = [
      aetna({ id: 61, agent: OTHER, amount: 40, eff: '01/01/2026', period: '202601' }),
      aetna({ id: 62, agent: OTHER, amount: -40, eff: '01/01/2026', period: '202601', thei: -20, bsi: -20 }),
    ];
    const { updates, summary } = planBsiHouseSplitBackfill(rows, {}, { kinds: ['aetna_cb_reclass'] });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: 61, kind: 'aetna_cb_reclass', classification: 'Chargeback', newClassification: 'New Business' });
    expect(updates[0].after).toEqual(updates[0].before);
    expect(updates[0].mga).toContain(RECLASS_NOTE);
    expect(summary).toMatchObject({ relabeled: 1, relabeledAmount: 40, theiDelta: 0, bsiDelta: 0 });
  });
  it('sends fee-like or not-first-year positives to review', () => {
    const rows = [aetna({ id: 71, agent: OTHER, amount: 55, eff: '01/01/2022', period: '202510' }),
      aetna({ id: 72, agent: OTHER, amount: 10, eff: null, period: '202604' })];
    const { updates, review } = planBsiHouseSplitBackfill(rows, {}, { kinds: ['aetna_cb_reclass'] });
    expect(updates).toEqual([]);
    expect(review.map((r) => r.id)).toEqual([71, 72]);
  });
  it('is not part of a run limited to other kinds; other carriers are ignored', () => {
    const rows = [aetna({ id: 81, agent: OTHER, amount: 40, eff: '2026-01-01', period: '202601' }),
      row({ id: 82, agent: OTHER, carrier: 'Humana', cls: 'Chargeback', amount: 40, thei: 20, bsi: 20, producer: 0, eff: '01/01/2026', period: '202601' })];
    expect(planBsiHouseSplitBackfill(rows, {}, { kinds: ['double_share_fix'] }).updates).toEqual([]);
    expect(planBsiHouseSplitBackfill(rows).updates.map((u) => u.id)).toEqual([81]);
  });
  it('effectiveYear reads both date styles', () => {
    expect(effectiveYear('09/01/2026')).toBe(2026);
    expect(effectiveYear('2025-10-01')).toBe(2025);
    expect(effectiveYear('')).toBe(null);
  });
});

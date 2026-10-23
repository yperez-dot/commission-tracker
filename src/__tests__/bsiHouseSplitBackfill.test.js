'use strict';

// Synthetic data only. Swan/Marco agents are taken from the schedule list, never spelled out.
const { planBsiHouseSplitBackfill, GUARD_NOTE, stripGuardNote } = require('../bsiHouseSplitBackfill');
const { MARCO_AGENTS, INTEGRITY_AGENTS } = require('../payeeSchedules');

const tc = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const [f, l] = MARCO_AGENTS[8].split(' ');
const SWAN_MI = `${tc(f)} L ${tc(l)}`; // missed by the old matching
const SWAN = tc(MARCO_AGENTS[0]); // matched before too
const THEI = 'The Health Experts Insurance LLC';
const OTHER = 'Sample Writer Alpha';

let nextId = 1;
const row = (o) => ({
  id: o.id || nextId++, agent_name: o.agent, carrier: 'UnitedHealthcare', classification: o.cls || 'New Business',
  commission: o.amount, policy_number: o.policy, payment_period: o.period || '202609',
  producer_payable: o.producer == null ? null : o.producer, thei_share: o.thei == null ? null : o.thei,
  bsi_share: o.bsi == null ? null : o.bsi, sub_agent_override: o.sub || 0,
  split_applies: o.applies == null ? null : o.applies, mga: o.mga || '', source: o.source || 'BSI',
});

describe('BSI house split backfill (planner)', () => {
  it('fills unsplit THEI-written lines 50/50 (new business, renewal, chargeback) and strips the guard note', () => {
    const rows = [
      row({ agent: THEI, policy: 'A', amount: 100, mga: GUARD_NOTE }),
      row({ agent: THEI, policy: 'A', cls: 'Renewal', amount: 12.5 }),
      row({ agent: THEI, policy: 'B', cls: 'Chargeback', amount: -60, mga: `keep me | ${GUARD_NOTE}` }),
    ];
    const { updates, summary } = planBsiHouseSplitBackfill(rows);
    expect(updates).toHaveLength(3);
    for (const u of updates) {
      expect(u.kind).toBe('thei_fill');
      expect(u.after.producerPayable).toBe(0);
      expect(u.after.subAgentOverride).toBe(0);
      expect(u.after.theiShare + u.after.bsiShare).toBeCloseTo(u.commission, 2);
      expect(u.splitApplies).toBe(true);
    }
    expect(updates[0].mga).toBe('');
    expect(updates.find((u) => u.commission === -60).mga).toBe('keep me');
    expect(summary.theiDelta + summary.bsiDelta).toBeCloseTo(100 + 12.5 - 60, 2);
    expect(summary.marcoDelta).toBe(0);
  });

  it('moves $10 to Marco on the first stored plain-50/50 line of a Swan agent the old matching missed', () => {
    const rows = [
      row({ id: 11, agent: SWAN_MI, policy: 'W', amount: 100, thei: 50, bsi: 50, producer: 0, applies: true }),
      row({ id: 12, agent: SWAN_MI, policy: 'W', cls: 'Renewal', amount: 20, thei: 10, bsi: 10, producer: 0, applies: true }),
      row({ id: 13, agent: SWAN_MI, policy: 'W', cls: 'Chargeback', amount: -50, thei: -25, bsi: -25, producer: 0, applies: true }),
    ];
    const { updates, summary } = planBsiHouseSplitBackfill(rows);
    expect(updates.map((u) => [u.id, u.kind])).toEqual([[11, 'marco_fix'], [13, 'marco_fix']]);
    expect(updates[0].after).toEqual({ producerPayable: 0, theiShare: 45, bsiShare: 45, subAgentOverride: 10 });
    expect(updates[1].after).toEqual({ producerPayable: 0, theiShare: -22.5, bsiShare: -22.5, subAgentOverride: -5 });
    expect(summary.marcoDelta).toBe(5);
    expect(summary.theiDelta).toBe(-2.5);
    expect(summary.bsiDelta).toBe(-2.5);
  });

  it('no Marco correction when the policy already gave Marco $10, or the agent was matched before', () => {
    const rows = [
      row({ agent: SWAN_MI, policy: 'X', amount: 100, thei: 50, bsi: 50, producer: 0, applies: true }),
      row({ agent: SWAN, policy: 'Y', amount: 100, thei: 50, bsi: 50, producer: 0, applies: true }),
    ];
    const { updates } = planBsiHouseSplitBackfill(rows, { deductedPolicies: new Set(['X']) });
    expect(updates).toHaveLength(0);
  });

  it('never touches split rows that are not plain 50/50, Lina/Integrity, HRA, fees, held or non-BSI rows', () => {
    const rows = [
      row({ agent: SWAN_MI, policy: 'Q', amount: 100, thei: 30, bsi: 20, producer: 50 }),
      row({ agent: 'Alba Hernandez', policy: 'L', amount: 100 }),
      row({ agent: tc(INTEGRITY_AGENTS[0]), policy: 'I', amount: 100 }),
      row({ agent: THEI, policy: 'H', cls: 'HRA/Bonus', amount: 50 }),
      row({ agent: THEI, policy: 'F', cls: 'BSI Fee', amount: -40 }),
      row({ agent: THEI, policy: 'D', cls: 'Held', amount: 40 }),
      row({ agent: THEI, policy: 'N', amount: 40, source: 'NHP' }),
      row({ agent: THEI, policy: 'S', amount: 40, thei: 20, bsi: 20, producer: 0, applies: true }),
    ];
    expect(planBsiHouseSplitBackfill(rows).updates).toHaveLength(0);
  });

  it('other agents\' unsplit lines in scope are filled too (Swan $10 once per policy)', () => {
    const rows = [
      row({ agent: OTHER, policy: 'O', amount: 80 }),
      row({ agent: SWAN, policy: 'Z', amount: 80 }),
      row({ agent: SWAN, policy: 'Z', cls: 'Renewal', amount: 20 }),
    ];
    const { updates } = planBsiHouseSplitBackfill(rows);
    expect(updates.map((u) => u.after.subAgentOverride)).toEqual([0, 10, 0]);
    expect(updates.every((u) => u.kind === 'other_fill')).toBe(true);
  });

  it('stripGuardNote keeps other notes', () => {
    expect(stripGuardNote(`a | ${GUARD_NOTE} | b`)).toBe('a | b');
  });
});

'use strict';

// Synthetic data only.
const {
  checkUploadChargebacks,
  checkStoredChargebacks,
  summarizeFlags,
  flagNote,
  chargebackFlagRow,
  dayKey,
  lookupKeys,
} = require('../chargebackPaidCheck');
const { applyBsiBookAgentProduction } = require('../bsiBookAttribution');

const base = { carrier: 'Humana', client: 'SAMPLE, MEMBER ONE', effectiveDate: '01/01/2026', period: '202609' };
const stored = (o) => ({
  carrier: o.carrier || 'Humana', policy_number: o.policy, client_full_name: o.client || 'SAMPLE, MEMBER ONE',
  effective_date: o.eff || '2026-01-01', classification: o.cls || 'Agency Override', commission: o.amount,
  payment_period: o.period || '202608', id: o.id,
});

describe('chargeback vs paid — upload', () => {
  it('flags a chargeback larger than everything paid on the policy (earlier uploads + this file)', () => {
    const records = [{ ...base, policyNumber: 'P-1', classification: 'Chargeback', commission: -300 }];
    const flags = checkUploadChargebacks(records, [stored({ policy: 'P-1', amount: 150 }), stored({ policy: 'P-1', amount: 50 })]);
    expect(flags).toHaveLength(1);
    expect(flags[0].flag).toMatchObject({ status: 'exceeds_paid', paid: 200, chargedBack: 300, excess: 100, matchedBy: 'policy' });
    expect(flagNote(flags[0].flag)).toMatch(/exceeds what was paid/);
  });

  it('counts earlier chargebacks too (net of prior chargebacks)', () => {
    const records = [{ ...base, policyNumber: 'P-2', classification: 'Chargeback', commission: -100 }];
    const prior = [stored({ policy: 'P-2', amount: 150 }), stored({ policy: 'P-2', amount: -100 })];
    expect(checkUploadChargebacks(records, prior)[0].flag).toMatchObject({ paid: 150, chargedBack: 200, excess: 50 });
    // within what was paid → no flag
    expect(checkUploadChargebacks([{ ...records[0], commission: -50 }], prior)).toHaveLength(0);
  });

  it('flags a chargeback with no payment found', () => {
    const records = [{ ...base, policyNumber: 'P-3', classification: 'Chargeback', commission: -75 }];
    // A payment on another policy for the same client is not a match (name fallback is
    // only for chargebacks with a blank policy).
    const flags = checkUploadChargebacks(records, [stored({ policy: 'OTHER', amount: 500 })]);
    expect(flags[0].flag).toMatchObject({ status: 'no_payment', paid: 0, chargedBack: 75 });
    expect(summarizeFlags(flags).message).toMatch(/1 chargeback\(s\) with no payment found/);
  });

  it('a sale in the same file counts as paid', () => {
    const records = [
      { ...base, policyNumber: 'P-4', classification: 'Agency Override', commission: 120 },
      { ...base, policyNumber: 'P-4', classification: 'Chargeback', commission: -120 },
    ];
    expect(checkUploadChargebacks(records, [])).toHaveLength(0);
  });

  it('matches by carrier: the same policy on another carrier is not a payment', () => {
    const records = [{ ...base, policyNumber: 'P-5', classification: 'Chargeback', commission: -40 }];
    expect(checkUploadChargebacks(records, [stored({ policy: 'P-5', carrier: 'Aetna', amount: 400 })])[0].flag.status)
      .toBe('no_payment');
    expect(checkUploadChargebacks(records, [stored({ policy: 'p-5 ', carrier: 'HUMANA INC', amount: 400 })])).toHaveLength(0);
  });

  it('falls back to client name + effective date when the policy is blank', () => {
    const records = [{ ...base, policyNumber: '', client: 'Member One Sample', classification: 'Chargeback', commission: -90 }];
    expect(checkUploadChargebacks(records, [stored({ policy: 'P-6', amount: 100 })])).toHaveLength(0);
    expect(checkUploadChargebacks(records, [stored({ policy: 'P-6', amount: 60 })])[0].flag)
      .toMatchObject({ status: 'exceeds_paid', matchedBy: 'client_and_effective_date', paid: 60, chargedBack: 90 });
    // different effective date → not the same policy
    expect(checkUploadChargebacks(records, [stored({ policy: 'P-6', amount: 100, eff: '2025-01-01' })])[0].flag.status)
      .toBe('no_payment');
  });

  it('HRA / bonus / fee / held lines are not payments and are never flagged', () => {
    const records = [
      { ...base, policyNumber: 'P-7', classification: 'Chargeback', commission: -50 },
      { ...base, policyNumber: 'P-8', classification: 'BSI Fee', commission: -40 },
      { ...base, policyNumber: 'P-9', classification: 'HRA/Bonus', commission: -25 },
    ];
    const prior = [stored({ policy: 'P-7', cls: 'HRA/Bonus', amount: 500 }), stored({ policy: 'P-7', cls: 'Held', amount: 500 })];
    const flags = checkUploadChargebacks(records, prior);
    expect(flags.map((x) => x.record.policyNumber)).toEqual(['P-7']);
    expect(flags[0].flag.status).toBe('no_payment');
  });

  it('does not change the split math or the records', () => {
    const records = [
      { ...base, carrier: 'UnitedHealthcare', agent: 'Sample Writer Alpha', policyNumber: 'P-10', classification: 'Chargeback', commission: -80, raw: {} },
    ];
    applyBsiBookAgentProduction(records);
    const before = JSON.stringify(records);
    checkUploadChargebacks(records, []);
    expect(JSON.stringify(records)).toBe(before);
    expect(records[0]).toMatchObject({ theiShare: -40, bsiShare: -40, producerPayable: 0 });
  });

  it('lookupKeys returns the chargebacks\' policies and client keys', () => {
    const k = lookupKeys([
      { ...base, policyNumber: ' P-11 ', commission: -1 },
      { ...base, policyNumber: 'P-12', commission: 10 },
      { ...base, policyNumber: '', client: 'Member Two Sample', commission: -5 },
    ]);
    expect(k.policies).toEqual(['p-11']);
    expect(k.names).toHaveLength(1);
  });
});

describe('chargeback vs paid — stored data', () => {
  const rows = [
    stored({ id: 1, policy: 'S-1', amount: 100, period: '202607' }),
    stored({ id: 2, policy: 'S-1', amount: -100, period: '202608' }),
    stored({ id: 3, policy: 'S-1', amount: -100, period: '202609' }),
    stored({ id: 4, policy: 'S-2', amount: -30, period: '202609' }),
    stored({ id: 5, policy: 'S-3', amount: 50, period: '202609' }),
  ];

  it('lists every flagged chargeback, optionally for one period', () => {
    const all = checkStoredChargebacks(rows).map((x) => x.record.id);
    expect(all).toEqual([2, 3, 4]);
    const sept = checkStoredChargebacks(rows, { period: '202609' });
    expect(sept.map((x) => x.record.id)).toEqual([3, 4]);
    const flat = sept.map(chargebackFlagRow);
    expect(flat[0]).toMatchObject({ id: 3, status: 'exceeds_paid', paid: 100, chargedBack: 200, excess: 100, policy: 'S-1' });
    expect(summarizeFlags(sept)).toMatchObject({ count: 2, exceedsPaid: 1, noPayment: 1, total: -130 });
    expect(summarizeFlags([])).toBeNull();
  });

  it('dayKey normalizes dates', () => {
    expect(dayKey('1/5/2026')).toBe('2026-01-05');
    expect(dayKey('2026-01-05T00:00:00Z')).toBe('2026-01-05');
    expect(dayKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
    expect(dayKey('')).toBe('');
  });
});

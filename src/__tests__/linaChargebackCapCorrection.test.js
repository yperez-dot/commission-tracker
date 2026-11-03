'use strict';

// Synthetic data only (made-up policies and amounts).
const { ALBA_DB_AGENT } = require('../bsiBookAttribution');
const { planBsiHouseSplitBackfill } = require('../bsiHouseSplitBackfill');
const { addLinaOriginal } = require('../linaChargebackProrate');
const {
  buildCapOriginals,
  planLinaChargebackCapCorrection,
} = require('../linaChargebackCapCorrection');

const alba = (o) => ({
  id: o.id,
  agent: ALBA_DB_AGENT,
  agent_name: ALBA_DB_AGENT,
  carrier: o.carrier || 'UnitedHealthcare',
  classification: o.cls || 'Chargeback',
  commission: o.amount,
  policyNumber: o.policy,
  policy_number: o.policy,
  period: '202610',
  payment_period: '202610',
  producerPayable: o.producer,
  producer_payable: o.producer,
  theiShare: o.thei,
  thei_share: o.thei,
  bsiShare: o.bsi,
  bsi_share: o.bsi,
  mga: o.mga || 'Lina chargeback taken back in proportion to the original payment(s) on this policy (100.0% Lina)',
  source: 'BSI',
});

describe('buildCapOriginals', () => {
  it('uses stored producer when present and ignores unsplit on that policy', () => {
    const map = buildCapOriginals([
      {
        agent: ALBA_DB_AGENT, carrier: 'Humana', policyNumber: 'H-1',
        classification: 'New Business', commission: 438,
        producerPayable: 294.32, theiShare: 71.84, bsiShare: 71.84,
      },
      {
        agent: ALBA_DB_AGENT, carrier: 'Humana', policyNumber: 'H-1',
        classification: 'New Business', commission: 50,
      },
    ]);
    expect(map.get('humana|h-1')).toEqual({
      gross: 438, producer: 294.32, thei: 71.84, bsi: 71.84,
    });
  });

  it('counts an unsplit positive as paid = commission when no stored producer exists', () => {
    const map = buildCapOriginals([
      {
        agent: 'Broker Society Insurance',
        carrier: 'UnitedHealthcare',
        policyNumber: 'SYN-CAP',
        classification: 'New Business',
        commission: 65.17,
      },
    ]);
    expect(map.get('uhc|syn-cap')).toEqual({
      gross: 65.17, producer: 65.17, thei: 0, bsi: 0,
    });
  });
});

describe('planLinaChargebackCapCorrection', () => {
  it('rewrites a stored 100% Lina chargeback so take-back stops at prior pay; house 50/50', () => {
    const originals = buildCapOriginals([{
      agent: 'Broker Society Insurance',
      carrier: 'UnitedHealthcare',
      policyNumber: 'SYN-CAP',
      classification: 'New Business',
      commission: 65.17,
    }]);
    const { updates } = planLinaChargebackCapCorrection(
      [alba({ id: 11, policy: 'SYN-CAP', amount: -77.67, producer: -77.67, thei: 0, bsi: 0 })],
      originals
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].after).toEqual({ producer: -65.17, thei: -6.25, bsi: -6.25 });
    expect(updates[0].after.producer + updates[0].after.thei + updates[0].after.bsi)
      .toBeCloseTo(-77.67, 2);
    expect(updates[0].mga).toMatch(/capped at actual prior pay/);
  });

  it('is a no-op when the stored split is already the cap (idempotent)', () => {
    const originals = buildCapOriginals([{
      agent: 'Broker Society Insurance',
      carrier: 'UnitedHealthcare',
      policyNumber: 'SYN-CAP',
      classification: 'New Business',
      commission: 65.17,
    }]);
    const { updates } = planLinaChargebackCapCorrection(
      [alba({ id: 12, policy: 'SYN-CAP', amount: -77.67, producer: -65.17, thei: -6.25, bsi: -6.25 })],
      originals
    );
    expect(updates).toHaveLength(0);
  });

  it('leaves a Humana-style stored prorate alone', () => {
    const originals = buildCapOriginals([{
      agent: ALBA_DB_AGENT, carrier: 'Humana', policyNumber: 'H-1',
      classification: 'New Business', commission: 438,
      producerPayable: 294.32, theiShare: 71.84, bsiShare: 71.84,
    }]);
    const { updates } = planLinaChargebackCapCorrection(
      [alba({
        id: 13, policy: 'H-1', carrier: 'Humana', amount: -438,
        producer: -294.32, thei: -71.84, bsi: -71.84,
      })],
      originals
    );
    expect(updates).toHaveLength(0);
  });
});

describe('startup prorate vs cap pass', () => {
  it('lina_cb_prorate plans 0 on a 100% Lina row when unsplit originals are skipped', () => {
    const m = new Map();
    addLinaOriginal(m, {
      agent: 'Broker Society Insurance',
      carrier: 'UnitedHealthcare',
      policyNumber: 'SYN-CAP',
      classification: 'New Business',
      commission: 65.17,
    });
    expect(m.size).toBe(0);
    const rows = [alba({ id: 14, policy: 'SYN-CAP', amount: -77.67, producer: -77.67, thei: 0, bsi: 0 })];
    expect(planBsiHouseSplitBackfill(rows, { linaOriginals: m }, { kinds: ['lina_cb_prorate'] }).updates)
      .toHaveLength(0);
  });
});

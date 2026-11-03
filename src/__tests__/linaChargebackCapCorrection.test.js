'use strict';

// Synthetic data only (made-up policies and amounts).
const { ALBA_DB_AGENT } = require('../bsiBookAttribution');
const { planBsiHouseSplitBackfill } = require('../bsiHouseSplitBackfill');
const { addLinaOriginal } = require('../linaChargebackProrate');
const {
  buildCapOriginals,
  planLinaChargebackCapCorrection,
  reconstructShortInstallmentPay,
  applyLinaChargebackCapCorrection,
  logSkipped,
  normalizePolicy,
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
  effectiveDate: o.effectiveDate,
  effective_date: o.effectiveDate,
  memberState: o.memberState,
  member_state: o.memberState,
  raw: o.raw,
  raw_data: o.raw,
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

describe('short first-year installment reconstruction', () => {
  const ctNewR = {
    carrier: 'UnitedHealthcare',
    classification: 'Chargeback',
    commission: -77.67,
    policyNumber: 'SYN-CT-NB',
    period: '202610',
    producerPayable: -77.67,
    theiShare: 0,
    bsiShare: 0,
    effectiveDate: '08/01/2026',
    memberState: 'CT',
    raw: {
      'Commission Action': 'New Chargeback',
      'Comp Type': 'R',
      'Member State': 'CT',
      'Original Effective Date': '08/01/2026',
      'Statement Date': '10/22/2026',
    },
  };

  it('line minus one month of Initial $150 is 65.17', () => {
    const rebuilt = reconstructShortInstallmentPay(ctNewR);
    expect(rebuilt).toMatchObject({ gross: 77.67, producer: 65.17 });
  });

  it('ignores a same-size unsplit original when the chargeback abs key matches', () => {
    const originals = buildCapOriginals([{
      agent: 'Broker Society Insurance',
      carrier: 'UnitedHealthcare',
      policyNumber: 'SYN-CT-NB',
      classification: 'New Business',
      commission: 77.67,
    }], new Map([[normalizePolicy('SYN-CT-NB'), 77.67]]));
    expect(originals.has('uhc|syn-ct-nb')).toBe(false);
  });

  it('rewrites 100% Lina even when the unsplit original equals the chargeback', () => {
    // #112 production path: unsplit line counted as paid = |CB|, planner skipped as same.
    const originals = buildCapOriginals([{
      agent: 'Broker Society Insurance',
      carrier: 'UnitedHealthcare',
      policyNumber: 'SYN-CT-NB',
      classification: 'New Business',
      commission: 77.67,
    }]);
    expect(originals.get('uhc|syn-ct-nb')).toEqual({
      gross: 77.67, producer: 77.67, thei: 0, bsi: 0,
    });
    const { updates, skipped } = planLinaChargebackCapCorrection(
      [alba({
        id: 21,
        policy: 'SYN-CT-NB',
        amount: -77.67,
        producer: -77.67,
        thei: 0,
        bsi: 0,
        effectiveDate: ctNewR.effectiveDate,
        memberState: ctNewR.memberState,
        raw: ctNewR.raw,
      })],
      originals
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].after).toEqual({ producer: -65.17, thei: -6.25, bsi: -6.25 });
    expect(JSON.stringify({ updates, skipped })).not.toMatch(/ROJAS|Edwin/i);
  });
});

describe('skip reasons (no client names)', () => {
  it('leaves a Humana-style prorate as within_cap_house', () => {
    const originals = buildCapOriginals([{
      agent: ALBA_DB_AGENT, carrier: 'Humana', policyNumber: 'H-1',
      classification: 'New Business', commission: 438,
      producerPayable: 294.32, theiShare: 71.84, bsiShare: 71.84,
    }]);
    const { updates, skipped } = planLinaChargebackCapCorrection(
      [alba({
        id: 13, policy: 'H-1', carrier: 'Humana', amount: -438,
        producer: -294.32, thei: -71.84, bsi: -71.84,
      })],
      originals
    );
    expect(updates).toHaveLength(0);
    expect(skipped).toEqual([expect.objectContaining({
      reason: 'within_cap_house',
      policyLast4: 'H-1',
      paid: 294.32,
      stored: -294.32,
    })]);
  });

  it('prints skip lines without client names', () => {
    const logs = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((m) => logs.push(String(m)));
    logSkipped([{
      carrier: 'UnitedHealt',
      policyLast4: 'T-NB',
      commission: -77.67,
      stored: -77.67,
      paid: 0,
      reason: 'reconstruct_failed',
    }]);
    spy.mockRestore();
    expect(logs).toEqual([
      '[lina-cb-cap] skip carrier=UnitedHealt policy=…T-NB comm=-77.67 stored=-77.67 paid=0.00 reason=reconstruct_failed',
    ]);
    expect(logs.join('\n')).not.toMatch(/ROJAS|Edwin|Hernandez|Alba/i);
  });

  it('skips HRA as not_lina_cb', () => {
    const { updates, skipped } = planLinaChargebackCapCorrection(
      [alba({ id: 9, policy: 'SYN-HRA', cls: 'HRA/Bonus', amount: -10, producer: -10, thei: 0, bsi: 0 })],
      new Map()
    );
    expect(updates).toHaveLength(0);
    expect(skipped[0].reason).toBe('not_lina_cb');
  });
});

describe('applyLinaChargebackCapCorrection', () => {
  it('plans the short-installment rewrite and leaves Humana stored shares', async () => {
    const logs = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((m) => logs.push(String(m)));
    const pool = {
      query: jest.fn(async (sql) => {
        if (sql.includes('commission, 0) < -0.005')) {
          return { rows: [
            {
              id: 21,
              agent_name: ALBA_DB_AGENT,
              carrier: 'UnitedHealthcare',
              classification: 'Chargeback',
              commission: -77.67,
              producer_payable: -77.67,
              thei_share: 0,
              bsi_share: 0,
              policy_number: 'SYN-CT-NB',
              payment_period: '202610',
              mga: 'Lina chargeback taken back in proportion to the original payment(s) on this policy (100.0% Lina)',
              source: 'BSI',
              effective_date: '08/01/2026',
              raw_data: {
                'Commission Action': 'New Chargeback',
                'Comp Type': 'R',
                'Member State': 'CT',
                'Original Effective Date': '08/01/2026',
                'Statement Date': '10/22/2026',
              },
            },
            {
              id: 13,
              agent_name: ALBA_DB_AGENT,
              carrier: 'Humana',
              classification: 'Chargeback',
              commission: -438,
              producer_payable: -294.32,
              thei_share: -71.84,
              bsi_share: -71.84,
              policy_number: 'H-1',
              payment_period: '202610',
              mga: '',
              source: 'BSI',
              effective_date: null,
              raw_data: {},
            },
          ] };
        }
        if (sql.includes('commission, 0) > 0.005')) {
          return { rows: [
            {
              agent_name: 'Broker Society Insurance',
              carrier: 'UnitedHealthcare',
              policy_number: 'SYN-CT-NB',
              classification: 'New Business',
              commission: 77.67,
              producer_payable: 0,
              thei_share: 0,
              bsi_share: 0,
              effective_date: '08/01/2026',
              raw_data: { 'Commission Action': 'New', 'Comp Type': 'R', 'Member State': 'CT' },
            },
            {
              agent_name: ALBA_DB_AGENT,
              carrier: 'Humana',
              policy_number: 'H-1',
              classification: 'New Business',
              commission: 438,
              producer_payable: 294.32,
              thei_share: 71.84,
              bsi_share: 71.84,
              effective_date: null,
              raw_data: {},
            },
          ] };
        }
        if (sql.includes('UPDATE commission_records')) return { rowCount: 1 };
        return { rows: [] };
      }),
    };
    const result = await applyLinaChargebackCapCorrection(pool, { period: '202610' });
    spy.mockRestore();
    expect(result).toMatchObject({ found: 2, planned: 1, applied: 1 });
    expect(result.updates[0].after).toEqual({ producer: -65.17, thei: -6.25, bsi: -6.25 });
    expect(result.updates[0].id).toBe(21);
    expect(result.skipped.map((s) => s.reason)).toEqual(['within_cap_house']);
    expect(logs.join('\n')).toMatch(/reason=within_cap_house/);
    expect(logs.join('\n')).not.toMatch(/ROJAS|Edwin/i);
    const updateCall = pool.query.mock.calls.find((c) => String(c[0]).includes('UPDATE'));
    expect(updateCall[1].slice(0, 4)).toEqual([-65.17, -6.25, -6.25, expect.stringMatching(/capped at actual prior pay/)]);
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

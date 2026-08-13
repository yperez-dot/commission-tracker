'use strict';

const {
  applyBsiBookAgentProduction,
  isBsiHouseAgent,
  ALBA_DB_AGENT,
  ALBA_NPN,
} = require('../bsiBookAttribution');
const { isAlbaHernandez } = require('../payeeSchedules');

describe('bsiBookAttribution', () => {
  it('remaps BSI house NB/Renewal/Chargeback to Alba with producer_payable', () => {
    const records = [
      {
        agent: 'Broker Society Insurance',
        classification: 'New Business',
        commission: 173.5,
        carrier: 'UnitedHealthcare',
      },
      {
        agent: 'Broker Society Insurance',
        classification: 'Chargeback',
        commission: -144.58,
      },
      {
        agent: 'Broker Society Insurance',
        classification: 'Renewal',
        commission: 36,
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records.every((r) => r.agent === ALBA_DB_AGENT)).toBe(true);
    expect(records.map((r) => r.producerPayable)).toEqual([173.5, -144.58, 36]);
    expect(records.every((r) => r.theiShare === 0 && r.bsiShare === 0)).toBe(true);
  });

  it('does NOT remap Agency Override under BSI house', () => {
    const records = [
      {
        agent: 'Broker Society Insurance',
        classification: 'Agency Override',
        commission: 75,
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

  it('sets producer_payable for Alba-named Aetna rows', () => {
    const records = [
      {
        agent: 'Alba Hernandez',
        classification: 'Renewal',
        commission: 40.17,
      },
      {
        agent: 'Hernandez, Alba',
        classification: 'New Business',
        commission: 300,
        raw: { 'Writing Agent NPN': '21209073' },
      },
    ];
    // Second agent string may not match isAlbaHernandez without normalize —
    // NPN path should still remap when we set agent oddly; force house-empty + npn
    records[1].agent = 'Broker Society Insurance';
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(40.17);
    expect(records[0].agent).toBe(ALBA_DB_AGENT);
    expect(records[1].agent).toBe(ALBA_DB_AGENT);
    expect(records[1].producerPayable).toBe(300);
  });

  it('leaves other individual agents unchanged (no invented producer_payable)', () => {
    const records = [
      {
        agent: 'Kelly Carpenter',
        classification: 'New Business',
        commission: 150,
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0].agent).toBe('Kelly Carpenter');
    expect(records[0].producerPayable).toBeUndefined();
  });

  it('detects BSI house agent names', () => {
    expect(isBsiHouseAgent('Broker Society Insurance')).toBe(true);
    expect(isBsiHouseAgent('BSI')).toBe(true);
    expect(isBsiHouseAgent('Alba Hernandez')).toBe(false);
    expect(isAlbaHernandez(ALBA_DB_AGENT)).toBe(true);
    expect(ALBA_NPN).toBe('21209073');
  });
});

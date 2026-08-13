'use strict';

const {
  STATEMENT_TYPES,
  buildOverrideStatements,
  classifyOverrideLine,
} = require('../overrideStatementBuilder');
const { isMarcoAgent, isIntegrityAgent } = require('../payeeSchedules');

describe('payeeSchedules', () => {
  it('recognizes Integrity agents including CAM', () => {
    expect(isIntegrityAgent('Christian Munoz')).toBe(true);
    expect(isIntegrityAgent('Cam Insurance Solutions Corp')).toBe(true);
    expect(isIntegrityAgent('Alba Hernandez')).toBe(false);
  });

  it('Marco includes Jendy before cutoff and excludes after', () => {
    expect(isMarcoAgent('Jendy Vanheyningen', '202605')).toBe(true);
    expect(isMarcoAgent('Jendy Vanheyningen', '202606')).toBe(false);
    expect(isMarcoAgent('Kelly Carpenter', '202606')).toBe(true);
  });
});

describe('overrideStatementBuilder', () => {
  const rows = [
    {
      id: 1,
      agent_name: 'Alba Hernandez',
      client_full_name: 'CLIENT A',
      policy_number: 'P1',
      carrier: 'Humana',
      effective_date: '01/01/2026',
      payment_period: '202601',
      classification: 'Agency Override',
      commission: 150,
      thei_share: 150,
      bsi_share: 150,
      producer_payable: 0,
      sub_agent_override: 0,
    },
    {
      id: 2,
      agent_name: 'Kelly Carpenter',
      client_full_name: 'CLIENT B',
      policy_number: 'P2',
      carrier: 'Humana',
      effective_date: '01/01/2026',
      payment_period: '202601',
      classification: 'Agency Override',
      commission: 100,
      thei_share: 45,
      bsi_share: 45,
      producer_payable: 0,
      sub_agent_override: 10,
    },
    {
      id: 3,
      agent_name: 'Christian Munoz',
      client_full_name: 'CLIENT C',
      policy_number: 'P3',
      carrier: 'UHC',
      effective_date: '01/01/2026',
      payment_period: '202601',
      classification: 'Agency Override',
      commission: 200,
      thei_share: 50,
      bsi_share: 50,
      producer_payable: 100,
      sub_agent_override: 0,
    },
    {
      id: 4,
      agent_name: 'Someone Else',
      client_full_name: 'CLIENT D',
      policy_number: 'P4',
      carrier: 'Humana',
      payment_period: '202601',
      classification: 'New Business',
      commission: 300,
      thei_share: 0,
      bsi_share: 0,
      producer_payable: 300,
      sub_agent_override: 0,
    },
  ];

  it('THEI override statement uses thei_share and excludes New Business', () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_OVERRIDE, { period: '202601' });
    expect(bundle.statements).toHaveLength(1);
    expect(bundle.statements[0].payee).toBe('The Health Experts Insurance');
    expect(bundle.grandTotal).toBe(245); // 150+45+50
  });

  it('BSI override statement uses bsi_share', () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.BSI_OVERRIDE, { period: '202601' });
    expect(bundle.grandTotal).toBe(245);
    expect(bundle.statements[0].payee).toBe('Broker Society Insurance');
  });

  it('Marco statement rolls up sub_agent_override only', () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.MARCO, { period: '202601' });
    expect(bundle.statements).toHaveLength(1);
    expect(bundle.statements[0].payee).toBe('Marco');
    expect(bundle.grandTotal).toBe(10);
    expect(bundle.statements[0].lines[0].writing_agent).toBe('Kelly Carpenter');
  });

  it('Integrity statement is per-agent producer_payable', () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.INTEGRITY, { period: '202601' });
    expect(bundle.statements).toHaveLength(1);
    expect(bundle.statements[0].payee).toBe('Christian Munoz');
    expect(bundle.grandTotal).toBe(100);
  });

  it('classifyOverrideLine returns null for non-override on THEI type', () => {
    expect(classifyOverrideLine(rows[3], STATEMENT_TYPES.THEI_OVERRIDE)).toBeNull();
  });
});

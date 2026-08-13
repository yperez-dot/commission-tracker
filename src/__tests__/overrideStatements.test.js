'use strict';

const {
  STATEMENT_TYPES,
  buildOverrideStatements,
  classifyOverrideLine,
} = require('../overrideStatementBuilder');
const { isMarcoAgent, isIntegrityAgent, isAlbaHernandez } = require('../payeeSchedules');

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
    expect(bundle.statements[0].lines[0].share_label).toBe('50%');
    expect(bundle.statements[0].lines[0].override_pot).toBe(300); // thei+bsi for first row
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

  it('THEI/BSI statements include Alba rate-peeled production shares (not just Agency Override class)', () => {
    const albaPeeled = {
      id: 99,
      agent_name: 'Alba Hernandez',
      client_full_name: 'CLIENT PEEL',
      policy_number: 'P99',
      carrier: 'UnitedHealthcare',
      payment_period: '202601',
      classification: 'New Business',
      commission: 323.5,
      gross_commission: 323.5,
      thei_share: 75,
      bsi_share: 75,
      producer_payable: 173.5,
      sub_agent_override: 0,
    };
    const thei = classifyOverrideLine(albaPeeled, STATEMENT_TYPES.THEI_OVERRIDE);
    expect(thei).not.toBeNull();
    expect(thei.amount).toBe(75);
    expect(thei.schedule).toBe('alba_rate_peel_thei_50');
    const bsi = classifyOverrideLine(albaPeeled, STATEMENT_TYPES.BSI_OVERRIDE);
    expect(bsi.amount).toBe(75);
    expect(bsi.schedule).toBe('alba_rate_peel_bsi_50');
    // Lina agent statement still uses producer_payable only
    const alba = classifyOverrideLine(albaPeeled, STATEMENT_TYPES.ALBA);
    expect(alba.amount).toBe(173.5);
  });

  it('classifyOverrideLine returns null for non-override on THEI type', () => {
    expect(classifyOverrideLine(rows[3], STATEMENT_TYPES.THEI_OVERRIDE)).toBeNull();
  });

  it('Alba statement pays agent commissions only (excludes Agency Override)', () => {
    const albaRows = [
      {
        id: 10,
        agent_name: 'Alba Hernandez',
        client_full_name: 'CLIENT E',
        policy_number: 'P5',
        carrier: 'Humana',
        effective_date: '01/01/2026',
        payment_period: '202601',
        classification: 'New Business',
        commission: 300,
        thei_share: 0,
        bsi_share: 0,
        producer_payable: 300,
        sub_agent_override: 0,
      },
      {
        id: 11,
        agent_name: 'Alba Hernandez',
        client_full_name: 'CLIENT F',
        policy_number: 'P6',
        carrier: 'Humana',
        payment_period: '202601',
        classification: 'Chargeback',
        commission: -50,
        thei_share: 0,
        bsi_share: 0,
        producer_payable: -50,
        sub_agent_override: 0,
      },
      {
        id: 13,
        agent_name: 'Alba Hernandez',
        client_full_name: 'CLIENT H',
        policy_number: 'P8',
        carrier: 'Humana',
        payment_period: '202601',
        classification: 'Agency Override',
        commission: 180,
        thei_share: 90,
        bsi_share: 90,
        producer_payable: 180,
        sub_agent_override: 0,
      },
      {
        id: 12,
        agent_name: 'Someone Else',
        client_full_name: 'CLIENT G',
        policy_number: 'P7',
        carrier: 'Humana',
        payment_period: '202601',
        classification: 'New Business',
        commission: 100,
        producer_payable: 100,
        thei_share: 0,
        bsi_share: 0,
        sub_agent_override: 0,
      },
    ];
    const bundle = buildOverrideStatements(albaRows, STATEMENT_TYPES.ALBA, { period: '202601' });
    expect(bundle.statements).toHaveLength(1);
    expect(bundle.statements[0].payee).toBe('Lina Hernandez');
    expect(bundle.grandTotal).toBe(250); // 300 - 50; override excluded
    expect(bundle.statements[0].lineCount).toBe(2);
  });

  it('matches Lina Hernandez name variants on Alba statement type', () => {
    expect(isAlbaHernandez('Lina Hernandez')).toBe(true);
    expect(isAlbaHernandez('Alba Ritela Hernandez')).toBe(true);
    const row = {
      id: 99,
      agent_name: 'Lina Hernandez',
      classification: 'Renewal',
      producer_payable: 36,
      payment_period: '202607',
    };
    const line = classifyOverrideLine(row, STATEMENT_TYPES.ALBA);
    expect(line.payee).toBe('Lina Hernandez');
    expect(line.amount).toBe(36);
  });
});

describe('overrideSplitMath', () => {
  const {
    splitFullOverridePot,
    splitTheRemittanceHalf,
    normalizeFilename,
    isBsiBookPayee,
  } = require('../overrideSplitMath');

  it('full pot splits 50/50', () => {
    const s = splitFullOverridePot(82.5, { agentName: 'Alba Hernandez' });
    expect(s.theiShare).toBe(41.25);
    expect(s.bsiShare).toBe(41.25);
    expect(s.grossCommission).toBe(82.5);
  });

  it('Marco takes $10 then 50/50', () => {
    const s = splitFullOverridePot(100, { agentName: 'Kelly Carpenter', paymentPeriod: '202601' });
    expect(s.subAgentOverride).toBe(10);
    expect(s.theiShare).toBe(45);
    expect(s.bsiShare).toBe(45);
  });

  it('Integrity is 50/25/25', () => {
    const s = splitFullOverridePot(200, { agentName: 'Christian Munoz' });
    expect(s.producerPayable).toBe(100);
    expect(s.theiShare).toBe(50);
    expect(s.bsiShare).toBe(50);
  });

  it('THE remittance half-model mirrors THEI half to BSI', () => {
    const s = splitTheRemittanceHalf(60);
    expect(s.theiShare).toBe(60);
    expect(s.bsiShare).toBe(60);
    expect(s.grossCommission).toBe(120);
  });

  it('normalizes spaced BSI filenames as BSI book', () => {
    expect(normalizeFilename('Statement-health experts (4).pdf')).toBe(
      'statement-health_experts_(4).pdf'
    );
    expect(isBsiBookPayee('BSI', 'Statement-health experts (4).pdf')).toBe(true);
    expect(isBsiBookPayee('Direct', 'Statement-health experts (4).pdf')).toBe(true);
  });
});

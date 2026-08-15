'use strict';

const {
  STATEMENT_TYPES,
  buildOverrideStatements,
  classifyOverrideLine,
  statementToCsv,
  formatEffectiveDate,
} = require('../overrideStatementBuilder');
const { isMarcoAgent, isIntegrityAgent, isAlbaHernandez } = require('../payeeSchedules');

describe('payeeSchedules', () => {
  const { isTheRemittanceUploadName, isBsiRemitSource } = require('../payeeSchedules');

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

  it('identifies remittance uploads vs carrier BSI feeds', () => {
    expect(isTheRemittanceUploadName('thei_statement_BSI_06.2026.csv')).toBe(true);
    expect(isTheRemittanceUploadName('T.H.E_STATEMENTS.csv')).toBe(true);
    expect(isTheRemittanceUploadName('uhc_bsi_statement_june.xlsx')).toBe(false);
    expect(
      isBsiRemitSource('BSI', { upload_original_name: 'thei_statement_BSI_06.2026.csv' })
    ).toBe(true);
    expect(
      isBsiRemitSource('BSI', { upload_original_name: 'humana_bsi_statement.xlsx' })
    ).toBe(false);
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

  it('THEI NHP statement includes only NHP source rows', () => {
    const sourced = [
      { ...rows[0], source: 'NHP', thei_share: 80, bsi_share: 80 },
      { ...rows[1], id: 21, source: 'BSI', thei_share: 45, bsi_share: 45 },
      { ...rows[2], id: 22, source: 'direct_carrier', thei_share: 50, bsi_share: 50 },
    ];
    const nhp = buildOverrideStatements(sourced, STATEMENT_TYPES.THEI_NHP, { period: '202601' });
    expect(nhp.grandTotal).toBe(80);
    expect(nhp.statements[0].lineCount).toBe(1);
    const bsi = buildOverrideStatements(sourced, STATEMENT_TYPES.THEI_BSI, { period: '202601' });
    expect(bsi.grandTotal).toBe(45);
    expect(bsi.statements[0].lineCount).toBe(1);
    expect(classifyOverrideLine(sourced[2], STATEMENT_TYPES.THEI_NHP)).toBeNull();
    expect(classifyOverrideLine(sourced[2], STATEMENT_TYPES.THEI_BSI)).toBeNull();
  });

  it('THEI BSI remittance excludes carrier BSI feed peels and includes override chargebacks', () => {
    const remittanceAo = {
      ...rows[1],
      id: 301,
      source: 'BSI',
      thei_share: 75,
      bsi_share: 75,
      classification: 'Agency Override',
      upload_original_name: 'thei_statement_BSI_06.2026.csv',
    };
    const remittanceCb = {
      ...rows[1],
      id: 302,
      source: 'BSI',
      thei_share: -28.13,
      bsi_share: -28.13,
      commission: -28.13,
      classification: 'Agency Override Chargeback',
      upload_original_name: 'thei_statement_BSI_06.2026.csv',
    };
    const carrierPeel = {
      ...rows[1],
      id: 303,
      source: 'BSI',
      thei_share: 400,
      bsi_share: 400,
      classification: 'Agency Override',
      upload_original_name: 'uhc_bsi_statement_june.xlsx',
    };
    const bundle = buildOverrideStatements(
      [remittanceAo, remittanceCb, carrierPeel],
      STATEMENT_TYPES.THEI_BSI,
      { period: '202601' }
    );
    expect(bundle.grandTotal).toBeCloseTo(46.87, 2);
    expect(bundle.statements[0].lineCount).toBe(2);
    expect(classifyOverrideLine(carrierPeel, STATEMENT_TYPES.THEI_BSI)).toBeNull();
  });

  it('THEI NHP includes mistagged direct_carrier rows from NHP upload filenames', () => {
    const mistagged = {
      ...rows[0],
      id: 88,
      source: 'direct_carrier',
      payee: 'NHP',
      upload_original_name: 'The_Health_Experts_Insurance_Statement.xlsx',
      thei_share: 90,
      bsi_share: 90,
    };
    const hit = classifyOverrideLine(mistagged, STATEMENT_TYPES.THEI_NHP);
    expect(hit).not.toBeNull();
    expect(hit.amount).toBe(90);
    const bundle = buildOverrideStatements([mistagged], STATEMENT_TYPES.THEI_NHP, { period: '202601' });
    expect(bundle.grandTotal).toBe(90);
  });

  it('Oscar / ACA override rows stay on THEI NHP and never on BSI house statements', () => {
    const oscarMistaggedBsi = {
      id: 901,
      agent_name: 'Eduardo Pernia',
      client_full_name: 'Michelle Day',
      policy_number: 'OSC75522291-01',
      carrier: 'Oscar Health',
      lob: 'ACA',
      effective_date: '05/01/2026',
      payment_period: '202606',
      classification: 'Agency Override',
      commission: 7,
      thei_share: 7,
      bsi_share: 0,
      producer_payable: 0,
      sub_agent_override: 0,
      source: 'BSI',
      payee: 'NHP',
      upload_original_name: 'Agency-Statement-The_Health_Experts_Insurance-June_15_2026.pdf',
    };
    const floridaBlue = {
      ...oscarMistaggedBsi,
      id: 902,
      carrier: 'Florida Blue',
      policy_number: 'FB1',
      source: 'NHP',
    };
    expect(classifyOverrideLine(oscarMistaggedBsi, STATEMENT_TYPES.THEI_NHP)?.amount).toBe(7);
    expect(classifyOverrideLine(floridaBlue, STATEMENT_TYPES.THEI_NHP)?.amount).toBe(7);
    expect(classifyOverrideLine(oscarMistaggedBsi, STATEMENT_TYPES.THEI_BSI)).toBeNull();
    expect(classifyOverrideLine(floridaBlue, STATEMENT_TYPES.THEI_BSI)).toBeNull();
    expect(classifyOverrideLine(oscarMistaggedBsi, STATEMENT_TYPES.BSI_OVERRIDE)).toBeNull();
    expect(classifyOverrideLine(floridaBlue, STATEMENT_TYPES.BSI_OVERRIDE)).toBeNull();
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

  it('Integrity falls back to legacy NHP sub_agent_override when producer_payable is 0', () => {
    const legacy = [{
      id: 501,
      agent_name: 'Horacio Mendieta',
      client_full_name: 'Legacy Client',
      policy_number: 'LEG1',
      carrier: 'UnitedHealthcare',
      effective_date: '2026-01-01',
      payment_period: '202601',
      classification: 'Agency Override',
      commission: 41.25,
      gross_commission: 165,
      thei_share: 41.25,
      bsi_share: 41.25,
      producer_payable: 0,
      sub_agent_override: 82.5,
      source: 'NHP',
    }];
    const bundle = buildOverrideStatements(legacy, STATEMENT_TYPES.INTEGRITY, { period: '202601' });
    expect(bundle.grandTotal).toBe(82.5);
    expect(bundle.statements[0].lines[0].amount_field).toBe('sub_agent_override');
  });

  it('formats effective dates on statement lines and CSV', () => {
    const bundle = buildOverrideStatements(rows, STATEMENT_TYPES.THEI_OVERRIDE, { period: '202601' });
    expect(bundle.statements[0].lines[0].effective_date).toBe('01/01/2026');
    const csv = statementToCsv(bundle, bundle.statements[0]);
    expect(csv).toMatch(/"Effective"/);
    expect(csv).toMatch(/"01-01-2026"/);
  });

  it('formatEffectiveDate normalizes ISO, slash, and Date values', () => {
    expect(formatEffectiveDate('2026-07-01')).toBe('07-01-2026');
    expect(formatEffectiveDate('2026-07-01T00:00:00.000Z')).toBe('07-01-2026');
    expect(formatEffectiveDate('01/15/2026')).toBe('01-15-2026');
    expect(formatEffectiveDate('7-1-2026')).toBe('07-01-2026');
    expect(formatEffectiveDate(new Date(Date.UTC(2026, 6, 1)))).toBe('07-01-2026');
    expect(formatEffectiveDate('')).toBe('');
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

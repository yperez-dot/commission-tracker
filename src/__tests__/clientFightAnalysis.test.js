'use strict';

const {
  analyzeClientFightHistory,
  lookupFightPackEntry,
} = require('../utils/clientFightAnalysis');

describe('clientFightAnalysis', () => {
  test('lookupFightPackEntry finds Acosta in 111-row pack', () => {
    const entry = lookupFightPackEntry('ACOSTA,ARISTIDES', 'Aetna');
    expect(entry).not.toBeNull();
    expect(entry.fightType).toBe('Wrong_claw');
    expect(entry.amount).toBe(240);
  });

  test('detects OVER_CLAW from BSI history (Ibarra-style pattern)', () => {
    const rows = [
      {
        classification: 'New Business',
        commission: 160,
        upload_category: 'bsi_statement',
        upload_name: 'AETNA_BSI_STATEMENT_202604.csv',
        payment_period: '202604',
      },
      {
        classification: 'Chargeback',
        commission: -240,
        upload_category: 'bsi_statement',
        upload_name: 'AETNA_BSI_STATEMENT_202604.csv',
        payment_period: '202604',
      },
      {
        classification: 'Agency Override',
        commission: 60,
        upload_name: 'Medicare Statement-THE-April.pdf',
        payment_period: '202604',
      },
      {
        classification: 'Chargeback',
        commission: -40,
        upload_name: 'Medicare Statement-THE-April.pdf',
        payment_period: '202604',
      },
      {
        classification: 'Agency Override',
        commission: 40,
        upload_name: 'Medicare Statement-THE-April.pdf',
        payment_period: '202605',
      },
    ];

    const result = analyzeClientFightHistory({
      client: 'IBARRA GONZALEZ R,RITO',
      carrier: 'Aetna',
      rows,
    });

    expect(result.hasFight).toBe(true);
    expect(result.inOfficialPacket).toBe(false);
    const carrierFight = result.fights.find((f) => f.bucket === 'C');
    expect(carrierFight).toBeTruthy();
    expect(carrierFight.amount).toBe(80);
    expect(carrierFight.errorCode).toBe('OVER_CLAW');
    expect(carrierFight.inOfficialPacket).toBe(false);
    expect(result.theiFight.net).toBe(60);
    expect(result.fights.some((f) => f.bucket === 'A')).toBe(false);
  });

  test('pack entry overrides amount but keeps history detection note when not in pack', () => {
    const rows = [
      {
        classification: 'New Business',
        commission: 347,
        upload_category: 'bsi_statement',
        upload_name: 'AETNA_BSI_STATEMENT_202601.xlsx',
        payment_period: '202601',
      },
      {
        classification: 'Chargeback',
        commission: -587,
        upload_category: 'bsi_statement',
        upload_name: 'AETNA_BSI_STATEMENT_202601.xlsx',
        payment_period: '202601',
      },
    ];

    const result = analyzeClientFightHistory({
      client: 'ACOSTA,ARISTIDES',
      carrier: 'Aetna',
      rows,
    });

    expect(result.inOfficialPacket).toBe(true);
    const carrierFight = result.fights.find((f) => f.bucket === 'C');
    expect(carrierFight.amount).toBe(240);
    expect(carrierFight.inOfficialPacket).toBe(true);
    expect(carrierFight.theiShare).toBe(120);
  });

  test('Missing_pay pack entry surfaces without BSI claw math', () => {
    const result = analyzeClientFightHistory({
      client: 'ADAMS, IDA',
      carrier: 'Humana',
      rows: [],
    });

    expect(result.hasFight).toBe(true);
    expect(result.fights[0].fightType).toBe('Missing_pay');
    expect(result.fights[0].amount).toBe(150);
  });

  test('reversal only counts when visible as positive chargeback in history', () => {
    const withoutReversal = analyzeClientFightHistory({
      client: 'IBARRA GONZALEZ R,RITO',
      carrier: 'Aetna',
      rows: [
        {
          classification: 'New Business',
          commission: 160,
          upload_category: 'bsi_statement',
          upload_name: 'AETNA_BSI_STATEMENT_202604.csv',
        },
        {
          classification: 'Chargeback',
          commission: -240,
          upload_category: 'bsi_statement',
          upload_name: 'AETNA_BSI_STATEMENT_202604.csv',
        },
      ],
    });
    expect(withoutReversal.carrierFight.hasReversalInHistory).toBe(false);
    expect(withoutReversal.carrierFight.overClaw).toBe(80);

    const withReversal = analyzeClientFightHistory({
      client: 'IBARRA GONZALEZ R,RITO',
      carrier: 'Aetna',
      rows: [
        {
          classification: 'New Business',
          commission: 160,
          upload_category: 'bsi_statement',
          upload_name: 'AETNA_BSI_STATEMENT_202604.csv',
        },
        {
          classification: 'Chargeback',
          commission: -240,
          upload_category: 'bsi_statement',
          upload_name: 'AETNA_BSI_STATEMENT_202604.csv',
        },
        {
          classification: 'Chargeback',
          commission: 160,
          upload_category: 'bsi_statement',
          upload_name: 'AETNA_BSI_STATEMENT_202605.csv',
        },
      ],
    });
    expect(withReversal.carrierFight.hasReversalInHistory).toBe(true);
    expect(withReversal.carrierFight.reversalCredit).toBe(160);
    expect(withReversal.carrierFight.overClaw).toBe(0);
  });
});

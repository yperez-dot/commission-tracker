'use strict';

const {
  auditRemittanceChargebacks,
  isLikelyTheRemittanceUploadName,
} = require('../remittanceChargebackAudit');

describe('remittanceChargebackAudit', () => {
  test('detects remittance upload names', () => {
    expect(isLikelyTheRemittanceUploadName('thei_statement_BSI_06.2026.csv')).toBe(true);
    expect(isLikelyTheRemittanceUploadName('T.H.E_STATEMENTS_JULY_2026.csv')).toBe(true);
    expect(isLikelyTheRemittanceUploadName('Medicare Statement-THE-April.pdf')).toBe(true);
    expect(isLikelyTheRemittanceUploadName('UHC_BSI_STATEMENT_2026-06-01.xlsx')).toBe(false);
  });

  test('OK when chargeback has prior remittance credit', () => {
    const result = auditRemittanceChargebacks({
      history: [
        {
          id: 1,
          client_full_name: 'NARCISO DOMINGUEZ',
          carrier: 'Humana',
          commission: 82.5,
          classification: 'Agency Override',
          payment_period: '202604',
          upload_original_name: 'thei_statement_BSI_04.2026.csv',
        },
      ],
      chargebacks: [
        {
          id: 2,
          client_full_name: 'NARCISO DOMINGUEZ',
          carrier: 'Humana',
          commission: -82.5,
          classification: 'Chargeback',
          payment_period: '202605',
          upload_original_name: 'thei_statement_BSI_05.2026.csv',
        },
      ],
    });
    expect(result.summary.problems).toBe(0);
    expect(result.ok).toHaveLength(1);
  });

  test('flags double remittance CB after prior net already $0 (Pedro/Illouz pattern)', () => {
    const result = auditRemittanceChargebacks({
      history: [
        {
          id: 1,
          client_full_name: 'Pedro, Isidro R.',
          carrier: 'UnitedHealthcare',
          commission: 82.5,
          classification: 'Agency Override',
          payment_period: '202604',
          upload_original_name: 'Medicare Statement-THE-April.pdf',
        },
        {
          id: 2,
          client_full_name: 'Pedro, Isidro R.',
          carrier: 'UnitedHealthcare',
          commission: -82.5,
          classification: 'Chargeback',
          payment_period: '202604',
          upload_original_name: 'Medicare Statement-THE-April.pdf',
        },
      ],
      chargebacks: [
        {
          id: 3,
          client_full_name: 'Isidro R. Pedro',
          carrier: 'UnitedHealthcare',
          commission: -82.5,
          classification: 'Chargeback',
          payment_period: '202606',
          upload_original_name: 'thei_statement_BSI_06.2026.csv',
        },
      ],
    });
    expect(result.summary.problems).toBe(1);
    expect(result.problems[0].status).toBe('DOUBLE_OR_OVER_CB');
    expect(result.problems[0].priorNet).toBe(0);
  });

  test('flags CB with no prior THEI remittance payment', () => {
    const result = auditRemittanceChargebacks({
      history: [],
      chargebacks: [
        {
          id: 9,
          client: 'Someone New',
          carrier: 'Aetna',
          commission: -80,
          period: '202607',
          classification: 'Chargeback',
        },
      ],
    });
    expect(result.problems[0].status).toBe('NO_PRIOR_PAYMENT');
  });

  test('ignores carrier-peel agent chargebacks in history when naming is non-remit', () => {
    const result = auditRemittanceChargebacks({
      history: [
        {
          id: 1,
          client_full_name: 'Test Client',
          carrier: 'Humana',
          commission: 100,
          classification: 'Agency Override',
          payment_period: '202603',
          upload_original_name: 'thei_statement_BSI_03.2026.csv',
        },
        {
          id: 2,
          client_full_name: 'Test Client',
          carrier: 'Humana',
          commission: -200,
          classification: 'Chargeback',
          payment_period: '202604',
          upload_original_name: 'HUMANA_BSI_STATEMENT_2026-04-01.xlsx',
        },
      ],
      chargebacks: [
        {
          id: 3,
          client_full_name: 'Test Client',
          carrier: 'Humana',
          commission: -50,
          classification: 'Chargeback',
          payment_period: '202605',
          upload_original_name: 'thei_statement_BSI_05.2026.csv',
        },
      ],
    });
    // Carrier peel -200 must NOT zero out remittance net; prior remittance still +100
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0].priorNet).toBe(100);
  });
});

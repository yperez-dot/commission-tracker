import { classifyClientFileStream } from '../clientFileStream';

describe('classifyClientFileStream', () => {
  test('keeps every BSI upload row in the carrier statement stream', () => {
    expect(classifyClientFileStream({
      upload_category: 'bsi_statement',
      classification: 'Agency Override',
    })).toBe('carrier_bsi');
  });

  test('keeps remittance overrides and remittance chargebacks in THEI activity', () => {
    expect(classifyClientFileStream({
      upload_category: 'commission_statement',
      classification: 'Agency Override',
      upload_name: 'T.H.E_STATEMENTS_JULY_2026.csv',
    })).toBe('thei_override');
    expect(classifyClientFileStream({
      upload_category: 'commission_statement',
      classification: 'Chargeback',
      upload_name: 'Medicare Statement -THE-April.pdf',
    })).toBe('thei_override');
  });

  test('does not mislabel ordinary agent commission activity as a THEI override', () => {
    expect(classifyClientFileStream({
      upload_category: 'commission_statement',
      classification: 'Chargeback',
      upload_name: 'KR_UHC_STATEMENT_FEBRUARY_2026.xlsx',
    })).toBe('other');
  });
});

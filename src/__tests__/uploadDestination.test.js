'use strict';

import {
  detectUploadDestination,
  destinationMatchesTab,
  UPLOAD_PAGE_BY_DEST,
} from '../utils/uploadDestination';

describe('uploadDestination', () => {
  test('routes BSI→THE remittance to Commission Statements', () => {
    const d = detectUploadDestination('JULY - THE.csv');
    expect(d.id).toBe('commission_statement');
    expect(d.confidence).toBe('high');
  });

  test('routes T.H.E Statements naming to Commission Statements', () => {
    expect(detectUploadDestination('T.H.E Statements January.csv').id).toBe('commission_statement');
  });

  test('routes carrier→BSI feeds to BSI Statements', () => {
    expect(detectUploadDestination('Humana_BSI_July.xlsx').id).toBe('bsi_statement');
    expect(detectUploadDestination('Statement-Health_Experts_2026.xlsx').id).toBe('bsi_statement');
  });

  test('routes MedicarePro and Agency Production', () => {
    expect(detectUploadDestination('MedicarePro_Sales_Export.xlsx').id).toBe('medicarepro');
    expect(detectUploadDestination('Hector_Agency_Production.xlsx').id).toBe('agency_production');
  });

  test('routes NHP agency statements to Commission Statements', () => {
    expect(detectUploadDestination('The_Health_Experts_Insurance_Statement_202601.xlsx').id).toBe(
      'commission_statement'
    );
  });

  test('routes AgentView CNHIC reports to Commission Statements', () => {
    const d = detectUploadDestination('AgentCommissionReport__1__68ea.pdf');
    expect(d.id).toBe('commission_statement');
    expect(d.confidence).toBe('high');
    expect(detectUploadDestination('CNHIC_AgentView_Aug2026.pdf').id).toBe('commission_statement');
  });

  test('destinationMatchesTab only matches exact tab', () => {
    expect(destinationMatchesTab('bsi_statement', 'commission_statement')).toBe(false);
    expect(destinationMatchesTab('bsi_statement', 'bsi_statement')).toBe(true);
    expect(destinationMatchesTab('unknown', 'commission_statement')).toBe(true);
  });

  test('UPLOAD_PAGE_BY_DEST maps destinations to pages', () => {
    expect(UPLOAD_PAGE_BY_DEST.commission_statement).toBe('upload');
    expect(UPLOAD_PAGE_BY_DEST.bsi_statement).toBe('bsi-statements-upload');
  });
});

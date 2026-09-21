'use strict';

import {
  detectUploadDestination,
  destinationMatchesTab,
  UPLOAD_PAGE_BY_DEST,
  uploadCategoryLabel,
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
    expect(detectUploadDestination('AETNA PRODUCTION 8.5.26.xlsx').id).toBe('agency_production');
    expect(detectUploadDestination('Aetna_Production_01.26.26_-_Brokers_Society.xlsx').id).toBe(
      'agency_production'
    );
  });

  test('routes NHP agency statements to Commission Statements', () => {
    expect(detectUploadDestination('The_Health_Experts_Insurance_Statement_202601.xlsx').id).toBe(
      'commission_statement'
    );
    expect(
      detectUploadDestination(
        'THE HEALTH EXPERST INSURANCE - YAHOSKA PEREZ principal - KATY ROBLES- NHP Commission Report.xlsx'
      ).id
    ).toBe('commission_statement');
  });

  test('routes Tailored / Jill NHP reports as agent payout (Commission Statements)', () => {
    const tailored = detectUploadDestination(
      'THE_HEALTH_EXPERST_INSURANCE_-_TAILORED_INSURANCE_SOLUTIONS_AGCY_-_JILL_TAYLOR_-_NHP_Commission_Report-_Jun_15th__2026.xlsx'
    );
    expect(tailored.id).toBe('agent_payout');
    expect(tailored.confidence).toBe('high');
    expect(detectUploadDestination('Jill_Taylor_NHP_Commission_Report_May.xlsx').id).toBe('agent_payout');
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
    expect(destinationMatchesTab('agent_payout', 'commission_statement')).toBe(true);
    expect(destinationMatchesTab('agent_payout', 'bsi_statement')).toBe(false);
    expect(destinationMatchesTab('unknown', 'commission_statement')).toBe(true);
  });

  test('UPLOAD_PAGE_BY_DEST maps destinations to pages', () => {
    expect(UPLOAD_PAGE_BY_DEST.commission_statement).toBe('upload');
    expect(UPLOAD_PAGE_BY_DEST.bsi_statement).toBe('bsi-statements-upload');
    expect(UPLOAD_PAGE_BY_DEST.agent_payout).toBe('upload');
  });

  test('uploadCategoryLabel maps DB category to Uploads tab name', () => {
    expect(uploadCategoryLabel('bsi_statement')).toBe('BSI Statements');
    expect(uploadCategoryLabel('agent_payout')).toBe('Agent payout');
    expect(uploadCategoryLabel('commission_statement')).toBe('Commission Statements');
    expect(uploadCategoryLabel(null)).toBe('Commission Statements');
    expect(uploadCategoryLabel('')).toBe('Commission Statements');
  });
});
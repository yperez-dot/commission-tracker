'use strict';

import {
  statementDisplayName,
  statementSearchText,
} from '../utils/statementDisplayName';

describe('statementDisplayName', () => {
  test('NHP THEI principal portal names', () => {
    expect(
      statementDisplayName(
        'THE HEALTH EXPERST INSURANCE - YAHOSKA PEREZ (principal) - KATY ROBLES- NHP Commission Report_2782.csv'
      )
    ).toBe('NHP · THEI principal');
    expect(
      statementDisplayName(
        'THE_HEALTH_EXPERST_INSURANCE_-_YAHOSKA_PEREZ__principal_-_KATY_ROBLES-_NHP_Commission_Report_2026-05-30.csv'
      )
    ).toBe('NHP · May 30, 2026 · THEI principal');
  });

  test('NHP agency statement with cycle in filename', () => {
    expect(
      statementDisplayName('The_Health_Experts_Insurance_Statement_2026-06-15.xlsx')
    ).toBe('NHP · Jun 15, 2026');
  });

  test('NHP Jill / Tailored', () => {
    expect(
      statementDisplayName(
        'THE_HEALTH_EXPERST_INSURANCE_-_TAILORED_INSURANCE_SOLUTIONS_AGCY_-_JILL_TAYLOR_-_NHP_Commission_Report-_Jun_15th__2026.xlsx'
      )
    ).toBe('NHP · Jun 15, 2026 · Jill Taylor');
  });

  test('BSI THE remittance and carrier feeds', () => {
    expect(statementDisplayName('JULY - THE.csv')).toBe('BSI · Jul · THE remittance');
    expect(statementDisplayName('JULY 2026 - THE.csv')).toBe('BSI · Jul 2026 · THE remittance');
    expect(statementDisplayName('Humana_BSI_July.xlsx')).toBe('BSI · Jul · Humana');
    expect(statementDisplayName('Statement-Health_Experts_2026.xlsx')).toBe('BSI · consolidator');
    expect(statementDisplayName('random.xlsx', { category: 'bsi_statement' })).toBe('BSI · random');
  });

  test('does not double-prefix', () => {
    expect(statementDisplayName('NHP · May 30, 2026 · THEI principal.csv')).toBe(
      'NHP · May 30, 2026 · THEI principal'
    );
  });

  test('search haystack includes original and label', () => {
    const hay = statementSearchText(
      'THE HEALTH EXPERST INSURANCE - YAHOSKA PEREZ (principal) - KATY ROBLES- NHP Commission Report.csv'
    );
    expect(hay).toContain('nhp');
    expect(hay).toContain('thei principal');
    expect(hay).toContain('yahoska');
  });
});

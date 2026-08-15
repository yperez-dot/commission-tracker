'use strict';

const {
  isNhpUploadName,
  stampNhpOriginalName,
  resolveNhpUploadOriginalName,
} = require('../nhpUploadName');

describe('nhpUploadName', () => {
  test('detects NHP portal filenames', () => {
    expect(isNhpUploadName('The_Health_Experts_Insurance_Statement.xlsx')).toBe(true);
    expect(isNhpUploadName('Agency-Statement-The_Health_Experts_Insurance.pdf')).toBe(true);
    expect(isNhpUploadName('yahoska_katy_statement.xlsx')).toBe(true);
    expect(isNhpUploadName('AgentCommissionReport.pdf')).toBe(false);
  });

  test('stamps duplicate NHP names so multiple Jan files can upload', () => {
    const when = new Date('2026-01-15T12:00:00.000Z');
    expect(stampNhpOriginalName('The_Health_Experts_Insurance_Statement.xlsx', when)).toBe(
      'The_Health_Experts_Insurance_Statement__2026-01-15T12-00-00.xlsx'
    );
  });

  test('resolve keeps first upload name and stamps collisions', () => {
    expect(resolveNhpUploadOriginalName('The_Health_Experts_Insurance_Statement.xlsx', false)).toBe(
      'The_Health_Experts_Insurance_Statement.xlsx'
    );
    const renamed = resolveNhpUploadOriginalName('The_Health_Experts_Insurance_Statement.xlsx', true);
    expect(renamed).toMatch(/^The_Health_Experts_Insurance_Statement__/);
    expect(resolveNhpUploadOriginalName('humana.pdf', true)).toBeNull();
  });
});

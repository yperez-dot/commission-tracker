'use strict';

const {
  detectBobExportColumns,
  mapBobExportRow,
  extractDobFromRaw,
  extractMemberIdFromRaw,
  mergeClientIdentifiers,
  policyNumberForDisplay,
  formatIdentifierDate,
} = require('../bobClientIdentifiers');

describe('detectBobExportColumns', () => {
  test('keeps member ID and policy number as separate columns', () => {
    const cols = detectBobExportColumns([
      'Member First Name', 'Member Last Name', 'Member ID', 'Policy Number',
      'Date of Birth', 'Policy Effective Date', 'Writing Agent Name',
    ]);
    expect(cols.memberIdCol).toBe('Member ID');
    expect(cols.policyCol).toBe('Policy Number');
    expect(cols.dobCol).toBe('Date of Birth');
    expect(cols.effDateCol).toBe('Policy Effective Date');
    expect(cols.firstNameCol).toBe('Member First Name');
    expect(cols.lastNameCol).toBe('Member Last Name');
    expect(cols.agentCol).toBe('Writing Agent Name');
  });

  test('does not treat Policy Effective Date as a policy number', () => {
    const cols = detectBobExportColumns(['Client Name', 'Policy Effective Date', 'Plan']);
    expect(cols.policyCol).toBeNull();
    expect(cols.effDateCol).toBe('Policy Effective Date');
  });

  test('maps Member ID when there is no policy number column', () => {
    const cols = detectBobExportColumns(['Member Name', 'Member ID', 'DOB']);
    expect(cols.memberIdCol).toBe('Member ID');
    expect(cols.policyCol).toBeNull();
    expect(cols.dobCol).toBe('DOB');
    expect(cols.clientCol).toBe('Member Name');
  });
});

describe('mapBobExportRow', () => {
  test('builds client name from first/last and captures identifiers', () => {
    const headers = ['Member First Name', 'Member Last Name', 'Member ID', 'Policy Number', 'Date of Birth'];
    const cols = detectBobExportColumns(headers);
    const mapped = mapBobExportRow({
      'Member First Name': 'Maria',
      'Member Last Name': 'Garcia',
      'Member ID': 'H123456789',
      'Policy Number': 'POL-9988',
      'Date of Birth': '03/08/1942',
    }, cols);
    expect(mapped.client).toBe('Maria Garcia');
    expect(mapped.memberId).toBe('H123456789');
    expect(mapped.policyNumber).toBe('POL-9988');
    expect(mapped.dateOfBirth).toBe('03/08/1942');
  });

  test('formats Date and excel serial DOB values', () => {
    const cols = detectBobExportColumns(['Name', 'DOB']);
    const fromDate = mapBobExportRow({ Name: 'Jane Doe', DOB: new Date(Date.UTC(1942, 0, 15)) }, cols);
    expect(fromDate.dateOfBirth).toBe('01/15/1942');

    const fromSerial = mapBobExportRow({ Name: 'Jane Doe', DOB: 15341 }, cols);
    expect(fromSerial.dateOfBirth).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('raw identifier extraction', () => {
  test('extracts DOB from common raw_data keys', () => {
    expect(extractDobFromRaw({ 'Date of Birth': '1942-01-15' })).toBe('01/15/1942');
    expect(extractDobFromRaw(JSON.stringify({ DOB: '1/5/1948' }))).toBe('01/05/1948');
    expect(extractDobFromRaw({ Member_DOB: '04-22-1939' })).toBe('04/22/1939');
  });

  test('extracts member ID from carrier-specific raw keys', () => {
    expect(extractMemberIdFromRaw({ UMID: 'H998877' })).toBe('H998877');
    expect(extractMemberIdFromRaw({ MEDICARE_IDENTIFIER: '1EG4TE5MK73' })).toBe('1EG4TE5MK73');
    expect(extractMemberIdFromRaw({ 'Member ID': '  ABC  ' })).toBe('ABC');
  });
});

describe('mergeClientIdentifiers', () => {
  test('prefers BOB fields, then fills gaps from statements and production', () => {
    const merged = mergeClientIdentifiers([
      { member_id: '', policy_number: '', date_of_birth: '' },
      { carrier_member_id: 'UMID-1', policy_number: '1EG4TE5MK73', raw_data: { DOB: '1945-06-02' } },
      { mbi: '1EG4TE5MK73', policy_number_production: 'POL-9' },
    ]);
    expect(merged.memberId).toBe('UMID-1');
    expect(merged.policyNumber).toBe('1EG4TE5MK73');
    expect(merged.dateOfBirth).toBe('06/02/1945');
  });

  test('keeps an existing BOB policy number and DOB', () => {
    const merged = mergeClientIdentifiers([
      { member_id: 'MEM-1', policy_number: 'POL-1', date_of_birth: '02/02/1940' },
      { carrier_member_id: 'OTHER', policy_number: 'OTHER-POL', raw_data: { DOB: '2000-01-01' } },
    ]);
    expect(merged).toEqual({
      memberId: 'MEM-1',
      policyNumber: 'POL-1',
      dateOfBirth: '02/02/1940',
    });
  });
});

describe('policyNumberForDisplay', () => {
  test('hides policy number when it is the same as member ID', () => {
    expect(policyNumberForDisplay('1EG4TE5MK73', '1EG4-TE5-MK73')).toBe('');
    expect(policyNumberForDisplay('H1', 'POL-2')).toBe('POL-2');
    expect(policyNumberForDisplay('', 'POL-2')).toBe('POL-2');
    expect(policyNumberForDisplay('H1', '')).toBe('');
  });
});

describe('formatIdentifierDate', () => {
  test('normalizes ISO and US dates', () => {
    expect(formatIdentifierDate('1942-03-08')).toBe('03/08/1942');
    expect(formatIdentifierDate('3/8/1942')).toBe('03/08/1942');
    expect(formatIdentifierDate('')).toBe('');
  });
});

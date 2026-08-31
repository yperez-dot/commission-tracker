'use strict';

const {
  detectBobExportColumns,
  mapBobExportRow,
  extractDobFromRaw,
  extractMemberIdFromRaw,
  mergeClientIdentifiers,
  policyNumberForDisplay,
  formatIdentifierDate,
  enrichBobClientsWithIdentifiers,
  identifiersFromProductionRaw,
  namesMatchForIdentifiers,
  parseGivenSurname,
  stripPolicySuffix,
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

  test('extracts DOB from Humana-style birth columns and excel serials', () => {
    expect(extractDobFromRaw({ DOB_DT: '1948-03-12' })).toBe('03/12/1948');
    expect(extractDobFromRaw({ Birth_Dt: '3/12/1948' })).toBe('03/12/1948');
    expect(extractDobFromRaw({ MEMBER_BIRTH_DT: 15341 })).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(extractDobFromRaw({ DOB: '15341' })).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
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
    expect(merged).toEqual({
      memberId: 'UMID-1',
      policyNumber: '1EG4TE5MK73',
      dateOfBirth: '06/02/1945',
      planType: '',
    });
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
      planType: '',
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

describe('enrichBobClientsWithIdentifiers', () => {
  test('fills empty BOB rows from statements and production without overwriting existing values', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [
        { id: 1, client_full_name: 'Maria Garcia', carrier: 'Humana', member_id: '', policy_number: '', date_of_birth: '' },
        { id: 2, client_full_name: 'John Smith', carrier: 'Aetna', member_id: 'KEEP-ME', policy_number: '', date_of_birth: '02/02/1940' },
      ],
      [
        { client_full_name: 'GARCIA, MARIA', carrier: 'Humana', carrier_member_id: 'UMID-9', policy_number: 'POL-1', date_of_birth: '1945-06-02' },
        { client_name: 'John Smith', carrier: 'Aetna', mbi: 'OTHER', policy_number: 'AET-22', date_of_birth: '2000-01-01' },
      ]
    );
    expect(enriched[0]).toMatchObject({
      member_id: 'UMID-9',
      policy_number: 'POL-1',
      date_of_birth: '06/02/1945',
    });
    expect(enriched[1]).toMatchObject({
      member_id: 'KEEP-ME',
      policy_number: 'AET-22',
      date_of_birth: '02/02/1940',
    });
  });

  test('crosswalks production carrier name variants for UHC, Devoted, and Humana', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [
        { id: 1, client_full_name: 'Ana Perez', carrier: 'UHC', member_id: '', policy_number: '', date_of_birth: '' },
        { id: 2, client_full_name: 'Luis Diaz', carrier: 'Devoted', member_id: '', policy_number: '', date_of_birth: '' },
        { id: 3, client_full_name: 'Carla Ruiz', carrier: 'HUMANA INC', member_id: '', policy_number: '', date_of_birth: '' },
      ],
      [
        { client_name: 'PEREZ, ANA', carrier: 'UnitedHealthcare', mbi: '1EG4TE5MK73', policy_number_production: 'POL-UHC', identifier_source: 'production' },
        { client_name: 'Luis Diaz', carrier: 'Devoted Health', carrier_member_id: 'MRL-22', mbi: '8C73N39QN86', identifier_source: 'production' },
        { client_name: 'Carla Ruiz', carrier: 'Humana', carrier_member_id: 'H70056676', mbi: '2D15P42UY89', identifier_source: 'production' },
      ]
    );
    expect(enriched[0]).toMatchObject({ member_id: '1EG4TE5MK73', policy_number: 'POL-UHC' });
    expect(enriched[1]).toMatchObject({ member_id: 'MRL-22' });
    expect(enriched[2]).toMatchObject({ member_id: 'H70056676' });
  });

  test('matches production names with an extra middle name on the same carrier', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [{ id: 1, client_full_name: 'Maria Garcia', carrier: 'Humana', member_id: '', policy_number: '', date_of_birth: '' }],
      [{ client_name: 'Maria Lopez Garcia', carrier: 'Humana', carrier_member_id: 'UMID-77', identifier_source: 'production' }]
    );
    expect(enriched[0].member_id).toBe('UMID-77');
  });

  test('prefers production IDs over commission when both match', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [{ id: 1, client_full_name: 'Ana Perez', carrier: 'UnitedHealthcare', member_id: '', policy_number: '', date_of_birth: '' }],
      [
        { client_full_name: 'Ana Perez', carrier: 'UnitedHealthcare', policy_number: 'STMT-ONLY', identifier_source: 'commission' },
        { client_name: 'Ana Perez', carrier: 'UnitedHealthcare', mbi: '1YJ9E76GC17', policy_number_production: 'UHC-POL', identifier_source: 'production' },
      ]
    );
    expect(enriched[0]).toMatchObject({
      member_id: '1YJ9E76GC17',
      policy_number: 'UHC-POL',
    });
  });
});

describe('identifiersFromProductionRaw', () => {
  test('reads Humana UMID then MBI', () => {
    expect(identifiersFromProductionRaw('Humana', {
      UMID: 'H70056676',
      MEDICARE_IDENTIFIER: '2D15P42UY89',
      Date_of_Birth: '1942-03-08',
    })).toEqual({
      memberId: 'H70056676',
      policyNumber: '',
      dateOfBirth: '03/08/1942',
      planType: '',
    });
  });

  test('reads UHC HIC / policy number', () => {
    expect(identifiersFromProductionRaw('UnitedHealthcare', {
      HIC: '1EG4TE5MK73',
      'Policy Number': '008899',
    })).toEqual({
      memberId: '1EG4TE5MK73',
      policyNumber: '008899',
      dateOfBirth: '',
      planType: '',
    });
  });

  test('reads Devoted MemberRecordLocator', () => {
    expect(identifiersFromProductionRaw('Devoted', {
      MemberRecordLocator: 'MRL-9',
      MBI: '8C73N39QN86',
    }).memberId).toBe('MRL-9');
  });

  test('reads Humana plan name from production raw_data', () => {
    expect(identifiersFromProductionRaw('Humana', {
      UMID: 'H88288448',
      PLAN_NAME: 'Humana Gold Plus HMO',
      PRODUCT: 'HMO',
    })).toMatchObject({
      memberId: 'H88288448',
      planType: 'Humana Gold Plus HMO',
    });
  });
});

describe('plan fill from production and policy suffix', () => {
  test('copies production plan_name onto an empty BOB plan', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [{
        id: 1,
        client_full_name: 'ALI JAFRI M',
        carrier: 'Humana',
        member_id: 'H88288448',
        policy_number: '00024276372K_HMO',
        date_of_birth: '',
        plan_type: '',
      }],
      [{
        client_name: 'JAFRI, ALI',
        carrier: 'Humana',
        carrier_member_id: 'H88288448',
        plan_name: 'Humana Gold Plus HMO',
        raw_data: { UMID: 'H88288448', PLAN_NAME: 'Humana Gold Plus HMO', DOB_DT: '1948-03-12' },
        identifier_source: 'production',
      }]
    );
    expect(enriched[0]).toMatchObject({
      member_id: 'H88288448',
      plan_type: 'Humana Gold Plus HMO',
      date_of_birth: '03/12/1948',
    });
  });

  test('matches production by member ID when the names do not line up', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [{
        id: 1,
        client_full_name: 'ALI JAFRI M',
        carrier: 'Humana',
        member_id: 'H88288448',
        policy_number: '00024276372K_HMO',
        date_of_birth: '',
        plan_type: '',
      }],
      [{
        client_name: 'Completely Different Name',
        carrier: 'Humana',
        carrier_member_id: 'H88288448',
        plan_name: 'HumanaChoice PPO',
        raw_data: { UMID: 'H88288448', Birth_Dt: '05-20-1941' },
        identifier_source: 'production',
      }]
    );
    expect(enriched[0]).toMatchObject({
      plan_type: 'HumanaChoice PPO',
      date_of_birth: '05/20/1941',
    });
  });

  test('derives HMO/PPO from the statement policy number when production has no plan', () => {
    const merged = mergeClientIdentifiers([
      { carrier: 'Humana', member_id: 'H88288448', policy_number: '00024276372K_HMO', plan_type: '' },
    ]);
    expect(merged.planType).toBe('Humana HMO');
  });

  test('keeps an existing BOB plan and does not overwrite it', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [{ id: 1, client_full_name: 'Ana Perez', carrier: 'Humana', plan_type: 'Humana PPO', member_id: '', policy_number: '' }],
      [{ client_name: 'Ana Perez', carrier: 'Humana', plan_name: 'Other Plan', identifier_source: 'production' }]
    );
    expect(enriched[0].plan_type).toBe('Humana PPO');
  });

  test('prefers production plan_name over a policy-suffix fallback', () => {
    const merged = mergeClientIdentifiers([
      { carrier: 'Humana', policy_number: '00024276372K_HMO', plan_type: '' },
      { carrier: 'Humana', plan_name: 'Humana Gold Plus SNP-DE HMO', identifier_source: 'production' },
    ]);
    expect(merged.planType).toBe('Humana Gold Plus SNP-DE HMO');
  });
});

describe('namesMatchForIdentifiers', () => {
  test('matches a first initial to the full given name on the same surname', () => {
    expect(namesMatchForIdentifiers('A Palacio', 'Ana Palacio')).toBe(true);
    expect(namesMatchForIdentifiers('A Palacio', 'PALACIO, ANA')).toBe(true);
    expect(namesMatchForIdentifiers('Palacio A', 'Ana Palacio')).toBe(true);
    expect(parseGivenSurname('A Palacio')).toEqual({ given: 'A', surname: 'Palacio' });
  });

  test('does not match a different first name that shares the surname', () => {
    expect(namesMatchForIdentifiers('A Palacio', 'Dora Palacio')).toBe(false);
    expect(namesMatchForIdentifiers('A Palacio', 'PALACIO, DORA')).toBe(false);
  });
});

describe('truncated BOB names vs production reports', () => {
  test('fills Humana A Palacio from Ana Palacio production (UMID, plan, DOB)', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [{
        id: 1,
        client_full_name: 'A Palacio',
        carrier: 'Humana',
        agent_name: 'Eric Del Valle',
        effective_date: '01/01/2025',
        member_id: '',
        policy_number: '',
        date_of_birth: '',
        plan_type: '',
      }],
      [{
        client_name: 'Ana Palacio',
        carrier: 'Humana',
        agent_name: 'DEL VALLE, ERIC',
        carrier_member_id: 'H92450001',
        mbi: '1AA1AA1AA11',
        plan_name: 'HUMANA GOLD PLUS HMO H1036-054',
        raw_data: { UMID: 'H92450001', PLAN_NAME: 'HUMANA GOLD PLUS HMO H1036-054', MEDICARE_IDENTIFIER: '1AA1AA1AA11' },
        identifier_source: 'production',
      }, {
        client_name: 'Dora Palacio',
        carrier: 'Devoted Health',
        agent_name: 'Eric del Valle',
        mbi: '7A14DD4NF93',
        raw_data: { BirthDate: '1952-12-13', MBI: '7A14DD4NF93', PlanName: 'Devoted DUAL PLUS Florida (HMO D-SNP)' },
        identifier_source: 'production',
      }]
    );
    expect(enriched[0]).toMatchObject({
      member_id: 'H92450001',
      plan_type: 'HUMANA GOLD PLUS HMO H1036-054',
    });
    expect(enriched[0].plan_type).not.toMatch(/Devoted/i);
  });

  test('does not copy Dora Palacio Humana IDs onto A Palacio when both exist', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [{
        id: 1,
        client_full_name: 'A Palacio',
        carrier: 'Humana',
        agent_name: 'Eric Del Valle',
        member_id: '',
        policy_number: '',
        plan_type: '',
      }],
      [
        {
          client_name: 'Ana Palacio',
          carrier: 'Humana',
          agent_name: 'Eric Del Valle',
          carrier_member_id: 'H-ANA',
          plan_name: 'Humana Gold Plus HMO',
          identifier_source: 'production',
        },
        {
          client_name: 'Dora Palacio',
          carrier: 'Humana',
          agent_name: 'Eric Del Valle',
          carrier_member_id: 'H-DORA',
          plan_name: 'CareOne Plus HMO',
          identifier_source: 'production',
        },
      ]
    );
    expect(enriched[0].member_id).toBe('H-ANA');
    expect(enriched[0].plan_type).toBe('Humana Gold Plus HMO');
  });

  test('unique last name + agent fills Dora when she is the only Palacio on Humana', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [{
        id: 1,
        client_full_name: 'A Palacio',
        carrier: 'Humana',
        agent_name: 'Eric Del Valle',
        effective_date: '01/01/2025',
        member_id: '',
        policy_number: '',
        date_of_birth: '',
        plan_type: '',
      }],
      [{
        client_full_name: 'Dora Palacio',
        carrier: 'Humana',
        agent_name: 'Eric Del Valle',
        policy_number: '7A14DD4NF93_MA',
        effective_date: '01/01/2025',
        identifier_source: 'commission',
      }, {
        client_name: 'Dora Palacio',
        carrier: 'Humana',
        agent_name: 'Eric Del Valle',
        carrier_member_id: 'H63800001',
        mbi: '7A14DD4NF93',
        plan_name: 'HUMANA GOLD PLUS HMO H1036-065',
        raw_data: { UMID: 'H63800001', MEDICARE_IDENTIFIER: '7A14DD4NF93', PLAN_NAME: 'HUMANA GOLD PLUS HMO H1036-065' },
        identifier_source: 'production',
      }, {
        client_name: 'Dora Palacio',
        carrier: 'Devoted Health',
        mbi: '7A14DD4NF93',
        plan_name: 'Devoted DUAL PLUS Florida (HMO D-SNP)',
        raw_data: { BirthDate: '1952-12-13', MBI: '7A14DD4NF93', PlanName: 'Devoted DUAL PLUS Florida (HMO D-SNP)' },
        identifier_source: 'production',
      }]
    );
    expect(enriched[0]).toMatchObject({
      member_id: 'H63800001',
      plan_type: 'HUMANA GOLD PLUS HMO H1036-065',
      date_of_birth: '12/13/1952',
    });
  });

  test('chains statement policy 7A14DD4NF93_MA to production MBI', () => {
    const enriched = enrichBobClientsWithIdentifiers(
      [{
        id: 1,
        client_full_name: 'Dora Palacio',
        carrier: 'Humana',
        member_id: '',
        policy_number: '',
        date_of_birth: '',
        plan_type: '',
      }],
      [{
        client_full_name: 'Dora Palacio',
        carrier: 'Humana',
        policy_number: '7A14DD4NF93_MA',
        identifier_source: 'commission',
      }, {
        client_name: 'Completely Different',
        carrier: 'Humana',
        mbi: '7A14DD4NF93',
        carrier_member_id: 'H63800001',
        plan_name: 'HUMANA GOLD PLUS HMO H1036-065',
        identifier_source: 'production',
      }]
    );
    expect(enriched[0].member_id).toBe('H63800001');
    expect(enriched[0].plan_type).toBe('HUMANA GOLD PLUS HMO H1036-065');
    expect(stripPolicySuffix('7A14DD4NF93_MA')).toBe('7A14DD4NF93');
  });
});

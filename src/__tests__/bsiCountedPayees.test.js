'use strict';

// Fictional members, policies, and amounts only.
const {
  BSI_COUNTED_PAYEES,
  isCountedBsiPayee,
  isCountedBsiStatementRow,
  statementPayeeFromRow,
  isHraBonusRow,
  isAlbaWritingAgent,
  isAlbaPolicyOverrideChargeback,
} = require('../bsiCountedPayees');
const { parseAmlPortalRows } = require('../bsiAmlPortalCsv');
const { applyBsiBookAgentProduction, ALBA_DB_AGENT } = require('../bsiBookAttribution');
const { checkUploadChargebacks } = require('../chargebackPaidCheck');
const { buildLinaCompensationStatement } = require('../linaCompensationStatement');
const { parseAetnaBsiPayeeRows } = require('../aetnaBsiPayeeCsv');

function amlRow(o) {
  return {
    'Statement Date': '10/01/2026',
    'Agent Name': 'Broker Society Insurance',
    'Voucher Description': '',
    'Policy #': 'POL-TEST-1',
    'Effective Date': '01/01/2026',
    'Original EffectiveDate': '01/01/2026',
    'Insured Name': 'SAMPLE MEMBER ONE',
    Carrier: 'Devoted Health',
    State: 'FL',
    Product: 'Medicare Advantage',
    'Commission ($)': '$100.00',
    Status: 'Paid',
    'Commission Type': 'Override',
    'Writing Agent': 'Sample Writer Alpha',
    'Writing Agent Code': 'EX0001',
    'Writing Agent NPN': '10000001',
    ...o,
  };
}

describe('BSI counted-payee allowlist', () => {
  it('is a named list of BSI, THEI, and Alba — easy to edit', () => {
    expect(BSI_COUNTED_PAYEES).toEqual([
      'Broker Society Insurance',
      'The Health Experts Insurance',
      'Alba Hernandez',
    ]);
  });

  it('matches payee aliases and rejects writing-agent names', () => {
    expect(isCountedBsiPayee('Broker Society Insurance')).toBe(true);
    expect(isCountedBsiPayee('BROKER SOCIETY INSURANCE')).toBe(true);
    expect(isCountedBsiPayee('BSI')).toBe(true);
    expect(isCountedBsiPayee('The Health Experts Insurance')).toBe(true);
    expect(isCountedBsiPayee('The Health Experts Insurance LLC')).toBe(true);
    expect(isCountedBsiPayee('Alba Ritela Hernandez')).toBe(true);
    expect(isCountedBsiPayee('Lina Hernandez')).toBe(true);
    expect(isCountedBsiPayee('Sample Writer Alpha')).toBe(false);
    expect(isCountedBsiPayee('Tailored Insurance Solutions Inc')).toBe(false);
    expect(isCountedBsiPayee('Piloto Insurance Services LLC')).toBe(false);
  });

  it('keys on Agent Name / Payee Name, never Writing Agent', () => {
    const row = {
      'Writing Agent': 'Sample Writer Alpha',
      raw: { 'Agent Name': 'Broker Society Insurance', 'Writing Agent': 'Sample Writer Alpha' },
    };
    expect(statementPayeeFromRow(row)).toBe('Broker Society Insurance');
    expect(isCountedBsiStatementRow(row)).toBe(true);
    expect(isCountedBsiStatementRow({
      raw: { 'Agent Name': 'Sample Writer Alpha', 'Writing Agent': 'Broker Society Insurance' },
    })).toBe(false);
    // Missing payee (UHC stored without Agent Name) still counts
    expect(isCountedBsiStatementRow({ agent: 'Sample Writer Alpha', payee: 'BSI' })).toBe(true);
  });
});

describe('AML-portal BSI CSV (Devoted / Humana / Wellcare / Freedom shape)', () => {
  it('imports only BSI + THEI + Alba payee rows; skips writer Commission', () => {
    const { records, skippedPayee, importedTotal } = parseAmlPortalRows([
      amlRow({ 'Commission ($)': '$130.00', 'Writing Agent': 'Sample Writer Alpha' }),
      amlRow({
        'Agent Name': 'Sample Writer Alpha',
        'Commission Type': 'Commission',
        'Commission ($)': '$86.75',
        'Writing Agent': 'Sample Writer Alpha',
        'Policy #': 'POL-TEST-1',
      }),
      amlRow({
        'Agent Name': 'The Health Experts Insurance',
        'Commission ($)': '$40.00',
        'Writing Agent': 'Sample Writer Beta',
        'Policy #': 'POL-TEST-2',
        Carrier: 'HUMANA',
      }),
      amlRow({
        'Agent Name': 'Tailored Insurance Solutions Inc',
        'Commission ($)': '$20.00',
        'Writing Agent': 'Sample Writer Gamma',
        'Policy #': 'POL-TEST-3',
        Carrier: 'HUMANA',
      }),
    ], { filename: 'BSI-Devoted-10.2026.csv' });

    expect(records).toHaveLength(2);
    expect(importedTotal).toBe(170);
    expect(records.every((r) => r.period === '202610')).toBe(true);
    expect(skippedPayee.map((s) => s.payee)).toEqual([
      'Sample Writer Alpha',
      'Tailored Insurance Solutions Inc',
    ]);
  });

  it('does not flag an override chargeback that nets to the override paid on the same policy', () => {
    const { records } = parseAmlPortalRows([
      amlRow({ 'Commission ($)': '$130.00', 'Policy #': 'POL-AMOS-1', 'Writing Agent': 'Sample Writer Alpha' }),
      amlRow({ 'Commission ($)': '-$130.00', 'Policy #': 'POL-AMOS-1', 'Writing Agent': 'Sample Writer Alpha' }),
      amlRow({
        'Agent Name': 'Sample Writer Alpha',
        'Commission Type': 'Commission',
        'Commission ($)': '-$115.66',
        'Policy #': 'POL-AMOS-1',
        'Writing Agent': 'Sample Writer Alpha',
      }),
    ]);
    expect(records).toHaveLength(2);
    expect(checkUploadChargebacks(records, [])).toHaveLength(0);
  });

  it('reports HRA/bonus paid to another agent and does not assign it to Lina', () => {
    const { records, hraConflicts } = parseAmlPortalRows([
      amlRow({
        'Agent Name': 'Sample Writer Delta',
        'Voucher Description': '10/2026-HRA BONUS-SAMPLE MEMBER',
        'Commission Type': 'Adjustment',
        'Commission ($)': '$50.00',
        'Writing Agent': 'Sample Writer Delta',
        'Policy #': 'POL-HRA-1',
      }),
    ]);
    expect(records).toHaveLength(0);
    expect(hraConflicts).toHaveLength(1);
    expect(hraConflicts[0].reason).toMatch(/not assigned to Lina/);
  });

  it('keeps Hold Commission and Open rows (same as today: they still count)', () => {
    const { records, importedTotal } = parseAmlPortalRows([
      amlRow({
        Status: 'Hold Commission',
        'Commission ($)': '$9.17',
        Carrier: 'WellCare',
        'Policy #': 'POL-HOLD-1',
        'Writing Agent': 'Alba Ritela Hernandez',
        'Writing Agent Code': 'EG5642',
      }),
      amlRow({
        Status: 'Open',
        'Commission ($)': '$6.38',
        Carrier: 'Freedom Health',
        'Policy #': 'POL-HOLD-2',
        'Writing Agent': 'Sample Writer Epsilon',
      }),
    ]);
    expect(records).toHaveLength(2);
    expect(importedTotal).toBe(15.55);
    expect(records[0].mga).toMatch(/Hold Commission/);
    expect(records[1].mga).toMatch(/Open status/);
    expect(records[0].classification).toBe('Agency Override');
  });

  it('imports a single-row file', () => {
    const { records, importedTotal } = parseAmlPortalRows([
      amlRow({ 'Commission ($)': '$9.17', Status: 'Hold Commission', Carrier: 'WellCare' }),
    ]);
    expect(records).toHaveLength(1);
    expect(importedTotal).toBe(9.17);
  });
});

describe('Alba override chargebacks → Lina', () => {
  it('passes the full Override chargeback to Lina and does not peel it', () => {
    const { records } = parseAmlPortalRows([
      amlRow({
        'Commission ($)': '-$173.50',
        'Writing Agent': 'Alba Ritela Hernandez',
        'Writing Agent Code': 'EG5642',
        'Writing Agent NPN': '21209073',
        'Insured Name': 'SAMPLE MEMBER ALBA',
        'Policy #': 'POL-ALBA-1',
        Carrier: 'HUMANA',
        Status: 'Open',
      }),
      amlRow({
        'Commission ($)': '$28.92',
        'Writing Agent': 'Alba Ritela Hernandez',
        'Writing Agent Code': 'EG5642',
        'Insured Name': 'SAMPLE MEMBER ALBA POS',
        'Policy #': 'POL-ALBA-2',
        Carrier: 'HUMANA',
      }),
    ]);
    applyBsiBookAgentProduction(records);
    const cb = records.find((r) => r.commission < 0);
    const pos = records.find((r) => r.commission > 0);
    expect(cb.agent).toBe(ALBA_DB_AGENT);
    expect(cb.producerPayable).toBe(-173.5);
    expect(cb.theiShare).toBe(0);
    expect(cb.bsiShare).toBe(0);
    expect(cb.mga).toMatch(/Alba's policy/);
    expect(cb.mga).toMatch(/SAMPLE MEMBER ALBA/);
    expect(cb.anomaly).not.toBe(true);
    // Positive Override stays house — not remapped to Lina pay
    expect(pos.classification).toBe('Agency Override');
    expect(pos.producerPayable).toBe(0);
    expect(pos.theiShare + pos.bsiShare).toBeCloseTo(28.92, 2);

    const stmt = buildLinaCompensationStatement(
      records.map((r) => ({
        agent_name: r.agent,
        classification: r.classification,
        producer_payable: r.producerPayable,
        client_full_name: r.client,
        policy_number: r.policyNumber,
        carrier: r.carrier,
        mga: r.mga,
        payment_period: '202610',
      })),
      { period: '202610' }
    );
    expect(stmt.chargebacks).toBe(-173.5);
    expect(stmt.lines).toHaveLength(1);
    expect(stmt.lines[0].classification).toBe("Chargeback — Alba's policy");
    expect(stmt.lines[0].clientName).toBe('SAMPLE MEMBER ALBA');
  });

  it('Lina chargeback total is $0 when the file has no Alba-writer override chargebacks', () => {
    const { records } = parseAmlPortalRows([
      amlRow({ 'Commission ($)': '-$130.00', 'Writing Agent': 'Sample Writer Alpha' }),
    ]);
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(0);
  });
});

describe('UHC-shaped BSI rows — payee filter does not drop writer variety', () => {
  it('counts every row whose Agent Name is BSI, regardless of writing agent', () => {
    const writers = [
      'SAMPLE CARRERA',
      'SAMPLE DIAZ',
      'SAMPLE ROBLES',
      'SAMPLE VANHEYNINGEN',
      'TAILORED INSURANCE SOLUTIONS INC',
      'THE HEALTH EXPERTS INSURANCE',
      'BROKER SOCIETY INSURANCE',
    ];
    const rows = writers.map((w, i) => ({
      agent: w,
      commission: 10 + i,
      classification: 'New Business',
      raw: { 'Agent Name': 'BROKER SOCIETY INSURANCE', 'Writing Agent Name': w },
    }));
    const before = rows.reduce((s, r) => s + r.commission, 0);
    const kept = rows.filter(isCountedBsiStatementRow);
    expect(kept).toHaveLength(writers.length);
    expect(kept.reduce((s, r) => s + r.commission, 0)).toBe(before);
    expect(statementPayeeFromRow(rows[0])).toBe('BROKER SOCIETY INSURANCE');
  });

  it('does not treat a UHC Commission Action chargeback as an Alba override pass-through', () => {
    const records = [{
      agent: ALBA_DB_AGENT,
      classification: 'Chargeback',
      commission: -175.83,
      carrier: 'UnitedHealthcare',
      raw: { 'Comp Type': 'R', 'Member State': 'TX', 'Agent Name': 'BROKER SOCIETY INSURANCE' },
    }];
    expect(isAlbaPolicyOverrideChargeback(records[0])).toBe(false);
    applyBsiBookAgentProduction(records);
    expect(records[0].theiShare).toBeLessThan(0);
    expect(records[0].bsiShare).toBeLessThan(0);
    expect(records[0].producerPayable + records[0].theiShare + records[0].bsiShare)
      .toBeCloseTo(-175.83, 2);
  });
});

describe('Aetna BSI payee CSV still filters on Payee Name', () => {
  it('drops a non-counted Payee Name and keeps BSI', () => {
    const { records } = parseAetnaBsiPayeeRows([
      {
        'Payment Date': '9/22/26', 'Member Name': 'SAMPLE, MEMBER', 'Member State': 'FL',
        'Sales Event': 'New Business', Product: 'MAPD', 'Plan ID': 'H0000-001',
        'Coverage Period': '9/1/26', 'Effective Date': '9/1/26',
        'Writing Agent Name': 'Example, Test', 'Payee Name': 'Broker Society Insurance',
        'Payee Amount': '50', 'Member ID': 'M-KEEP',
      },
      {
        'Payment Date': '9/22/26', 'Member Name': 'SAMPLE, OTHER', 'Member State': 'FL',
        'Sales Event': 'New Business', Product: 'MAPD', 'Plan ID': 'H0000-001',
        'Coverage Period': '9/1/26', 'Effective Date': '9/1/26',
        'Writing Agent Name': 'Example, Test', 'Payee Name': 'Sample Writer Alpha',
        'Payee Amount': '25', 'Member ID': 'M-DROP',
      },
    ], { filename: 'BSI-Aetna-09.2026.csv' });
    expect(records).toHaveLength(1);
    expect(records[0].policyNumber).toBe('M-KEEP');
    expect(records[0].commission).toBe(50);
  });
});

describe('house statements skip uncounted payees', () => {
  const { classifyOverrideLine } = require('../overrideStatementBuilder');
  const { STATEMENT_TYPES } = require('../payeeSchedules');

  it('does not put a writer-payee Agency Override on THEI/BSI statements', () => {
    const row = {
      agent_name: 'Sample Writer Alpha',
      classification: 'Agency Override',
      source: 'BSI',
      commission: 86.75,
      thei_share: 43.38,
      bsi_share: 43.37,
      raw_data: { 'Agent Name': 'Sample Writer Alpha', 'Commission Type': 'Commission' },
    };
    expect(classifyOverrideLine(row, STATEMENT_TYPES.THEI_BSI)).toBeNull();
    expect(classifyOverrideLine(row, STATEMENT_TYPES.BSI_OVERRIDE)).toBeNull();
  });
});

describe('HRA / Alba writing-agent helpers', () => {
  it('detects HRA bonus voucher text and Alba writer code/NPN', () => {
    expect(isHraBonusRow({ 'Voucher Description': '09/2026-HRA BONUS-SAMPLE' })).toBe(true);
    expect(isAlbaWritingAgent({
      raw: { 'Writing Agent': 'Someone Else', 'Writing Agent Code': 'EG5642' },
    })).toBe(true);
    expect(isAlbaWritingAgent({
      raw: { 'Writing Agent': 'Alba Ritela Hernandez' },
    })).toBe(true);
    expect(isAlbaWritingAgent({
      raw: { 'Writing Agent': 'Sample Writer Alpha', 'Writing Agent Code': 'EX0001' },
    })).toBe(false);
  });
});

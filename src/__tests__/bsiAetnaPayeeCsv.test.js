'use strict';

// Made-up data only (fictional members, IDs, NPNs and amounts).
const XLSX = require('xlsx');
const { parseAetnaBsiPayeeRows, classifyAetnaSalesEvent } = require('../aetnaBsiPayeeCsv');
const {
  BSI_LAYOUTS,
  detectBsiLayoutFromHeaders,
  detectBsiWorkbookLayout,
  expectedCarrier,
  carrierMismatchWarning,
} = require('../bsiCarrierDetect');
const { applyBsiBookAgentProduction } = require('../bsiBookAttribution');
const { reconcileToSummary } = require('../bsiNonMemberRows');

const HEADERS = [
  'Payment Date', 'Medicare Number', 'Member ID', 'Legacy Member ID', 'Member Name', 'Member State',
  'Sales Event', 'Product', 'Market', 'Plan ID', 'Additional Payment Detail', 'Coverage Period',
  'Effective Date', 'Term Date', 'Writing Agent NPN', 'Writing Agent Level', 'Writing Agent Name',
  'Payee ID', 'Payee Level', 'Payee Name', 'Payee Amount', 'CMS New', 'Member Sig Dt', '1099 Year',
];

function line(o) {
  const row = {
    'Payment Date': '9/22/26', 'Medicare Number': '0TEST0000A1', 'Member ID': 'M-TEST-1', 'Legacy Member ID': '',
    'Member Name': 'SAMPLE, MEMBER', 'Member State': 'FL', 'Sales Event': 'New Business', Product: 'MAPD',
    Market: 'GMO', 'Plan ID': 'H0000-001', 'Additional Payment Detail': '', 'Coverage Period': '9/1/26',
    'Effective Date': '9/1/26', 'Term Date': '', 'Writing Agent NPN': '00000001', 'Writing Agent Level': 'AG4',
    'Writing Agent Name': 'Example, Test', 'Payee ID': 'P1', 'Payee Level': 'GMO', 'Payee Name': 'Broker Society Insurance',
    'Payee Amount': '0', 'CMS New': '', 'Member Sig Dt': '', '1099 Year': '2026', ...o,
  };
  return HEADERS.map((h) => {
    const v = String(row[h] ?? '');
    return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');
}

const CSV = [
  HEADERS.join(','),
  line({ 'Member ID': 'M-1', 'Sales Event': 'New Business', 'Payee Amount': '125' }),
  line({ 'Member ID': 'M-2', 'Sales Event': 'PRONEW', 'Payee Amount': '62.50', 'Effective Date': '10/1/26', 'Plan ID': 'H0000-002' }),
  line({ 'Member ID': 'M-3', 'Sales Event': 'Renewal', 'Payee Amount': '30.25', 'Effective Date': '1/1/25' }),
  line({ 'Member ID': 'M-4', 'Sales Event': 'CMS Trueup', 'Payee Amount': '20' }),
  line({ 'Member ID': 'M-5', 'Sales Event': 'CMS Trueup reversal', 'Payee Amount': '-41.66' }),
  line({ 'Member ID': 'M-6', 'Sales Event': 'Involuntarily Rapid Disenroll', 'Payee Amount': '-125' }),
  line({ 'Member ID': 'M-7', 'Sales Event': 'New Business', 'Payee Amount': '100', 'Writing Agent Name': 'Munoz, Christian' }),
  line({ 'Member ID': 'M-8', 'Sales Event': 'Renewal', 'Payee Amount': '12', 'Writing Agent Name': 'Mendieta, Horacio' }),
  line({ 'Member ID': 'M-9', 'Sales Event': 'CMS Trueup reversal', 'Payee Amount': '-50', 'Writing Agent Name': 'Munoz, Christian' }),
  HEADERS.map(() => '').join(','),
  HEADERS.map(() => '').join(','),
  ['Total Payee Amount: $133.09', ...HEADERS.slice(1).map(() => '')].join(','),
].join('\n');

function workbook() {
  return XLSX.read(CSV, { type: 'string', raw: true });
}

function parse() {
  const wb = workbook();
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  return parseAetnaBsiPayeeRows(rows, { filename: 'BSI-Aetna-09.2026.csv' });
}

describe('BSI Aetna payee CSV', () => {
  it('is detected as the Aetna layout by its columns (not UHC)', () => {
    expect(detectBsiLayoutFromHeaders(HEADERS)).toBe(BSI_LAYOUTS.AETNA_PAYEE);
    expect(detectBsiWorkbookLayout(workbook(), XLSX)).toBe(BSI_LAYOUTS.AETNA_PAYEE);
  });

  it('imports every member row as Aetna, totals to the footer, skips blank/footer rows', () => {
    const { records, footerTotal } = parse();
    expect(records).toHaveLength(9);
    expect(footerTotal).toBe(133.09);
    const total = Math.round(records.reduce((s, r) => s + r.commission, 0) * 100) / 100;
    expect(total).toBe(133.09);
    expect(reconcileToSummary(records, footerTotal, 0).ok).toBe(true);
    expect(new Set(records.map((r) => r.carrier))).toEqual(new Set(['Aetna']));
    expect(records.every((r) => !/united/i.test(r.planType))).toBe(true);
    expect(records.every((r) => r.period === '202609')).toBe(true);
  });

  it('takes effective date from Effective Date and plan from Plan ID', () => {
    const { records } = parse();
    expect(records[0].effectiveDate).toBe('09/01/2026');
    expect(records[1].effectiveDate).toBe('10/01/2026');
    expect(records[1].planId).toBe('H0000-002');
    expect(records[1].planType).toBe('Aetna MAPD H0000-002');
    expect(records[2].effectiveDate).toBe('01/01/2025');
  });

  it('classifies by Sales Event', () => {
    const { records } = parse();
    expect(records.map((r) => r.classification)).toEqual([
      'New Business', 'New Business', 'Renewal', 'CMS Trueup', 'Chargeback', 'Chargeback',
      'New Business', 'Renewal', 'Chargeback',
    ]);
    expect(classifyAetnaSalesEvent('Involuntarily Rapid Disenroll', 0)).toBe('Chargeback');
    expect(classifyAetnaSalesEvent('CMS Trueup', 10)).toBe('CMS Trueup');
  });

  it('applies the Integrity rules (50/25/25 new sales and chargebacks, no renewals)', () => {
    const { records } = parse();
    applyBsiBookAgentProduction(records);
    const [nb, renewal, cb] = [records[6], records[7], records[8]];
    expect(nb.agent).toBe('Christian Munoz');
    expect(nb.producerPayable).toBe(50);
    expect(nb.theiShare).toBe(25);
    expect(nb.bsiShare).toBe(25);
    expect(renewal.producerPayable).toBe(0);
    expect(renewal.theiShare).toBe(6);
    expect(renewal.bsiShare).toBe(6);
    expect(cb.producerPayable).toBe(-25);
    expect(cb.theiShare).toBe(-12.5);
    expect(cb.bsiShare).toBe(-12.5);
    // other agents untouched
    expect(records[0].producerPayable).toBeUndefined();
  });
});

describe('BSI carrier detection and mismatch warning', () => {
  it('reads the expected carrier from selection, title or filename', () => {
    expect(expectedCarrier({ filename: 'BSI-Aetna-09.2026.csv' })).toBe('Aetna');
    expect(expectedCarrier({ title: 'BSI · Aetna · 09-2026' })).toBe('Aetna');
    expect(expectedCarrier({ selectedCarrier: 'Humana', filename: 'statement.xlsx' })).toBe('Humana');
    expect(expectedCarrier({ filename: 'statement.xlsx' })).toBeNull();
  });

  it('detects UHC and Humana/Devoted layouts by their columns', () => {
    expect(detectBsiLayoutFromHeaders(['Writing Agent Name', 'Member Name', 'Commission', 'Policy Number', 'Commission Action']))
      .toBe(BSI_LAYOUTS.UHC);
    const ws = XLSX.utils.aoa_to_sheet([
      [],
      ['Agent Name', 'Writing Agent', 'Carrier', 'Policy #', 'Insured Name', 'Commission ($)', 'First Year/Renewal'],
      ['Broker Society', 'Example Agent', 'HUMANA', 'TEST-1', 'SAMPLE MEMBER', 10, 'First Year'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    expect(detectBsiWorkbookLayout(wb, XLSX)).toBe(BSI_LAYOUTS.HUMANA_DEVOTED);
    expect(detectBsiLayoutFromHeaders(['Foo', 'Bar'])).toBeNull();
  });

  it('warns when the selected/named carrier does not match what was detected or imported', () => {
    expect(carrierMismatchWarning({ expected: 'Aetna', layout: BSI_LAYOUTS.UHC, importedCarriers: ['UnitedHealthcare'] }))
      .toMatch(/Aetna.*UHC/);
    expect(carrierMismatchWarning({ expected: 'Aetna', layout: BSI_LAYOUTS.AETNA_PAYEE, importedCarriers: ['Aetna'] }))
      .toBeNull();
    expect(carrierMismatchWarning({ expected: 'Devoted', layout: BSI_LAYOUTS.HUMANA_DEVOTED, importedCarriers: ['Devoted', 'Humana'] }))
      .toBeNull();
    expect(carrierMismatchWarning({ expected: 'Humana', layout: null, importedCarriers: ['UnitedHealthcare'] }))
      .toMatch(/imported as UHC/);
    expect(carrierMismatchWarning({ expected: null, layout: BSI_LAYOUTS.UHC, importedCarriers: ['UnitedHealthcare'] }))
      .toBeNull();
  });
});

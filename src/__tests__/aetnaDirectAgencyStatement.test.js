'use strict';

const path = require('path');
const XLSX = require('xlsx');
const {
  isAetnaDirectAgencyFilename,
  isAetnaDirectAgencyWorkbook,
  parseAetnaDirectAgencyStatement,
  parseMoney,
  applyAgentLookup,
  HOUSE_AGENT,
} = require('../aetnaDirectAgencyStatement');
const {
  findIncomingDuplicates,
  uhcTransactionKey,
  crossFileDuplicateKey,
} = require('../uhcUad');
const { collapseInternalDuplicates } = require('../uploadBatchDedupe');

const FIX = path.join(__dirname, 'fixtures');
const AET1 = path.join(FIX, 'AET1.xls'); // October 09, 2026
const AET2 = path.join(FIX, 'AET2.xls'); // September 11, 2026
const REFORMATTED = path.join(FIX, 'THEI_AETNA_09.2026.xlsx');

function load(file) {
  return XLSX.readFile(file);
}

function totals(rows) {
  const commission = Math.round(rows.reduce((s, r) => s + r.commission, 0) * 100) / 100;
  const mapd = rows.filter((r) => /MAPD/i.test(r.planType));
  const pdp = rows.filter((r) => /PDP/i.test(r.planType));
  return { count: rows.length, commission, mapd: mapd.length, pdp: pdp.length };
}

describe('Aetna DIRECT agency BIFF .xls', () => {
  test('detects portal .xls and reformatted xlsx, not BSI', () => {
    expect(isAetnaDirectAgencyFilename('AET1.xls')).toBe(true);
    expect(isAetnaDirectAgencyFilename('AET2.xls')).toBe(true);
    expect(isAetnaDirectAgencyFilename('THEI_AETNA_09.2026.xlsx')).toBe(true);
    expect(isAetnaDirectAgencyFilename('Aetna_BSI_09.2026.csv')).toBe(false);
    expect(isAetnaDirectAgencyWorkbook(load(AET1))).toBe(true);
    expect(isAetnaDirectAgencyWorkbook(load(AET2))).toBe(true);
    expect(isAetnaDirectAgencyWorkbook(load(REFORMATTED))).toBe(true);
  });

  test('parseMoney handles $ strings, negatives, and parentheses', () => {
    expect(parseMoney('$28.92')).toBeCloseTo(28.92, 2);
    expect(parseMoney('($28.92)')).toBeCloseTo(-28.92, 2);
    expect(parseMoney('-$3.83')).toBeCloseTo(-3.83, 2);
    expect(parseMoney(28.92)).toBeCloseTo(28.92, 2);
  });

  test('AET2.xls September 11 2026: 10 rows totaling $164.02', () => {
    const rows = parseAetnaDirectAgencyStatement(load(AET2), 'AET2.xls');
    const t = totals(rows);
    expect(t.count).toBe(10);
    expect(t.commission).toBeCloseTo(164.02, 2);
    expect(t.mapd).toBe(5);
    expect(t.pdp).toBe(5);
    expect(rows.filter((r) => r.commission === 28.92)).toHaveLength(5);
    expect(rows.reconciliation.ok).toBe(true);
    expect(rows.reconciliation.expectedTotal).toBeCloseTo(164.02, 2);
    expect(rows.reconciliation.source).toMatch(/NetCheck/i);
    expect(rows.every((r) => r.period === '202609')).toBe(true);
    expect(rows.every((r) => r.statementDate === '09/11/2026')).toBe(true);
    expect(rows.every((r) => r.carrier === 'Aetna')).toBe(true);
    expect(rows.every((r) => r.agent === HOUSE_AGENT)).toBe(true);
    expect(rows.every((r) => r.classification === 'Renewal')).toBe(true);
    const abrams = rows.find((r) => r.policyNumber === 'NG101794716700');
    expect(abrams.client).toMatch(/Abrams/i);
    expect(abrams.planType).toBe('Aetna MAPD');
    const canel = rows.find((r) => r.policyNumber === 'CHGA1490317');
    expect(canel.planType).toBe('Aetna PDP');
    expect(canel.commission).toBeCloseTo(3.92, 2);
  });

  test('AET1.xls October 09 2026: 10 rows totaling $164.02', () => {
    const rows = parseAetnaDirectAgencyStatement(load(AET1), 'AET1.xls');
    const t = totals(rows);
    expect(t.count).toBe(10);
    expect(t.commission).toBeCloseTo(164.02, 2);
    expect(t.mapd).toBe(5);
    expect(t.pdp).toBe(5);
    expect(rows.every((r) => r.period === '202610')).toBe(true);
    expect(rows.every((r) => r.statementDate === '10/09/2026')).toBe(true);
    expect(rows.reconciliation.ok).toBe(true);
  });

  test('reformatted THEI_AETNA_09.2026.xlsx matches September portal file', () => {
    const portal = parseAetnaDirectAgencyStatement(load(AET2), 'AET2.xls');
    const xlsx = parseAetnaDirectAgencyStatement(load(REFORMATTED), 'THEI_AETNA_09.2026.xlsx');
    expect(xlsx).toHaveLength(10);
    expect(totals(xlsx).commission).toBeCloseTo(164.02, 2);
    expect(xlsx.every((r) => r.period === '202609')).toBe(true);
    expect(xlsx.every((r) => r.statementDate === '09/11/2026')).toBe(true);
    expect(findIncomingDuplicates(portal, xlsx)).toHaveLength(10);
  });

  test('same policy+amount in September vs October are not duplicates', () => {
    const sep = parseAetnaDirectAgencyStatement(load(AET2), 'AET2.xls');
    const oct = parseAetnaDirectAgencyStatement(load(AET1), 'AET1.xls');
    expect(findIncomingDuplicates(sep, oct)).toHaveLength(0);
    expect(uhcTransactionKey(sep[0])).not.toBe(uhcTransactionKey(oct[0]));
    expect(crossFileDuplicateKey(sep[0])).not.toBe(crossFileDuplicateKey(oct[0]));
    expect(collapseInternalDuplicates(sep.concat(oct)).removedCount).toBe(0);
  });

  test('BSI-paid Aetna is not a duplicate unless policy+statement date+amount match', () => {
    const agency = parseAetnaDirectAgencyStatement(load(AET2), 'AET2.xls');
    const sample = agency[0];
    const bsiDifferentDate = {
      policyNumber: sample.policyNumber,
      client: sample.client,
      effectiveDate: '07/01/2025',
      commission: sample.commission,
      period: sample.period,
      carrier: 'Aetna',
      statementDate: '',
      payee: 'BSI',
    };
    const bsiSameTxn = {
      policyNumber: sample.policyNumber,
      client: 'Some Other Payee Name',
      effectiveDate: '07/01/2025',
      commission: sample.commission,
      period: '202609',
      carrier: 'Aetna',
      statementDate: sample.statementDate,
      payee: 'BSI',
    };
    expect(findIncomingDuplicates([bsiDifferentDate], [sample])).toHaveLength(0);
    expect(uhcTransactionKey(bsiDifferentDate)).toBe('');
    expect(findIncomingDuplicates([bsiSameTxn], [sample])).toHaveLength(1);
    expect(uhcTransactionKey(bsiSameTxn)).toBe(uhcTransactionKey(sample));
  });

  test('policy lookup overrides THEI house; unknown stays house', () => {
    const rows = parseAetnaDirectAgencyStatement(load(AET2), 'AET2.xls');
    applyAgentLookup(rows, { NG101794716700: 'Yahoska Perez' });
    const abrams = rows.find((r) => r.policyNumber === 'NG101794716700');
    const other = rows.find((r) => r.policyNumber === 'CHGA1490317');
    expect(abrams.agent).toBe('Yahoska Perez');
    expect(other.agent).toBe(HOUSE_AGENT);
  });
});

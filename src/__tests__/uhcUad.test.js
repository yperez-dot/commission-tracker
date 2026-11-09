'use strict';

const path = require('path');
const XLSX = require('xlsx');
const {
  parseUHCRows,
  parseUHCDirectRows,
  isUHCWorkbook,
  uadTotals,
} = require('../uhcCommissionParse');
const {
  UAD_CLASSIFICATION,
  parseUadActivity,
  applyUhcUad,
  crossFileDuplicateKey,
  uhcTransactionKey,
  findIncomingDuplicates,
  isUHCFilename,
  isUHCDirectFilename,
} = require('../uhcUad');
const { collapseInternalDuplicates } = require('../uploadBatchDedupe');

const THEI_FILE = path.join(__dirname, 'fixtures', 'UHC_THEI_09.2026_sample.xlsx');
const PERSONAL_FILE = path.join(__dirname, 'fixtures', 'P_UHC_09.2026.xlsx');

function loadWb(file) {
  return XLSX.readFile(file);
}

describe('UHC UAD + personal statement parse', () => {
  test('filenames: THEI and P_UHC are UHC workbooks, not the 706381-only detector', () => {
    expect(isUHCFilename('UHC_THEI_09.2026.xlsx')).toBe(true);
    expect(isUHCFilename('P_UHC_09.2026.xlsx')).toBe(true);
    expect(isUHCDirectFilename('P_UHC_09.2026.xlsx')).toBe(false);
    expect(isUHCDirectFilename('commission_statement_706381_2026-09-13.xlsx')).toBe(true);
    expect(isUHCWorkbook(loadWb(THEI_FILE))).toBe(true);
    expect(isUHCWorkbook(loadWb(PERSONAL_FILE))).toBe(true);
  });

  test('THEI sample: 217 rows, commission 2449.57, UAD -250.73 on 7 recoup lines', () => {
    const records = parseUHCRows(loadWb(THEI_FILE), 'UHC_THEI_09.2026_sample.xlsx');
    const totals = uadTotals(records);
    expect(totals.rowCount).toBe(217);
    expect(totals.commission).toBeCloseTo(2449.57, 2);
    expect(totals.uadActivity).toBeCloseTo(-250.73, 2);
    expect(totals.uadRows).toBe(7);

    const uadOnly = records.filter((r) => r.classification === UAD_CLASSIFICATION);
    expect(uadOnly).toHaveLength(7);
    expect(uadOnly.every((r) => r.commission === 0)).toBe(true);
    const names = uadOnly.map((r) => r.client).sort();
    expect(names).toEqual([
      'CHAPMAN, WENDY',
      'CHEUNG, CHITING',
      'HENNING, ROMA',
      'SMITH, MAURICIO',
      'WILLSROMERO, PATRICIO',
      'WU, KAMLING',
      'YAN, MOW',
    ]);
    expect(uadOnly.every((r) => r.period === '202609')).toBe(true);
    expect(uadOnly.every((r) => r.agent === 'The Health Experts Insurance')).toBe(true);
  });

  test('personal P_UHC: 85 Renewal rows, $2167.47, Member Name as client, Yahoska Perez', () => {
    const records = parseUHCRows(loadWb(PERSONAL_FILE), 'P_UHC_09.2026.xlsx');
    const totals = uadTotals(records);
    expect(totals.rowCount).toBe(85);
    expect(totals.commission).toBeCloseTo(2167.47, 2);
    expect(totals.uadActivity).toBe(0);
    expect(records.every((r) => r.classification === 'Renewal')).toBe(true);
    expect(records.every((r) => r.period === '202609')).toBe(true);
    expect(records.every((r) => r.agent === 'Yahoska Perez')).toBe(true);
    expect(records.every((r) => r.client && r.client !== 'PEREZ, YAHOSKA G')).toBe(true);
    const castro = records.find((r) => r.policyNumber === 'A02744749');
    expect(castro.client).toBe('CASTRO-SMITH, YIRIS');
    expect(castro.commission).toBeCloseTo(9.42, 2);
    expect(castro.statementDate).toBe('09/13/2026');
  });

  test('parseUHCDirectRows still keeps MedSup UAD rows that have $0 commission', () => {
    const records = parseUHCDirectRows(loadWb(THEI_FILE), 'UHC_THEI_09.2026_sample.xlsx');
    const uad = records.filter((r) => r.uadActivity);
    expect(uad.length).toBe(7);
    expect(uadTotals(uad).uadActivity).toBeCloseTo(-250.73, 2);
  });

  test('nonzero UAD is distinct from a plain $0 BSI-style row in duplicate keys', () => {
    const bsiZero = {
      policyNumber: 'A04363505',
      client: 'CHAPMAN, WENDY',
      effectiveDate: '09/01/2026',
      commission: 0,
      period: '202609',
      uadActivity: 0,
    };
    const uadRecoup = {
      ...bsiZero,
      uadActivity: -48.5,
      classification: UAD_CLASSIFICATION,
    };
    expect(crossFileDuplicateKey(uadRecoup)).not.toBe(crossFileDuplicateKey(bsiZero));
    expect(findIncomingDuplicates([bsiZero], [uadRecoup])).toHaveLength(0);

    const collapsed = collapseInternalDuplicates([bsiZero, uadRecoup]);
    expect(collapsed.removedCount).toBe(0);
    expect(collapsed.records).toHaveLength(2);
  });

  test('importing personal file after THEI yields 40 new rows / $1067.80', () => {
    const thei = parseUHCRows(loadWb(THEI_FILE), 'UHC_THEI_09.2026.xlsx');
    const personal = parseUHCRows(loadWb(PERSONAL_FILE), 'P_UHC_09.2026.xlsx');
    const dups = findIncomingDuplicates(thei, personal);
    expect(dups).toHaveLength(45);
    expect(uadTotals(dups).commission).toBeCloseTo(1099.67, 2);

    const dupTxn = new Set(dups.map(uhcTransactionKey).filter(Boolean));
    const unique = personal.filter((r) => !dupTxn.has(uhcTransactionKey(r)));
    expect(unique).toHaveLength(40);
    expect(uadTotals(unique).commission).toBeCloseTo(1067.80, 2);

    const castroThei = thei.find((r) => r.policyNumber === 'A02744749');
    const castroPers = personal.find((r) => r.policyNumber === 'A02744749');
    expect(uhcTransactionKey(castroThei)).toBe(uhcTransactionKey(castroPers));
    // Writing agent is Yahoska on both files; the party/payee still differs
    // (THEI 2737247 vs personal 706381). Txn key ignores party/agent.
    expect(castroThei.agent).toBe('Yahoska Perez');
    expect(castroPers.agent).toBe('Yahoska Perez');
    expect(castroThei.commission).toBeCloseTo(9.42, 2);
    expect(castroThei.statementDate).toBe('09/13/2026');

    const agencyPayee = {
      policyNumber: 'A02744749',
      client: 'CASTRO-SMITH, YIRIS',
      effectiveDate: '08/01/2019',
      commission: 9.42,
      period: '202609',
      statementDate: '09/13/2026',
      agent: 'The Health Experts Insurance',
    };
    const personalPayee = {
      policyNumber: 'A02744749',
      client: 'CASTRO SMITH YIRIS',
      effectiveDate: '08/01/2019',
      commission: 9.42,
      period: '202609',
      statementDate: '09/13/2026',
      agent: 'Yahoska Perez',
    };
    expect(crossFileDuplicateKey(agencyPayee)).not.toBe(crossFileDuplicateKey(personalPayee));
    expect(findIncomingDuplicates([agencyPayee], [personalPayee])).toHaveLength(1);
  });

  test('BSI same policy with a different amount is not a UHC transaction duplicate', () => {
    const uhc = {
      policyNumber: 'A02744749',
      client: 'CASTRO-SMITH, YIRIS',
      effectiveDate: '08/01/2019',
      commission: 9.42,
      period: '202609',
      statementDate: '09/13/2026',
      carrier: 'UnitedHealthcare',
    };
    const bsiDifferentAmount = {
      policyNumber: 'A02744749',
      client: 'CASTRO-SMITH, YIRIS',
      effectiveDate: '08/01/2019',
      commission: 12.00,
      period: '202609',
      carrier: 'UnitedHealthcare',
    };
    expect(findIncomingDuplicates([uhc], [bsiDifferentAmount])).toHaveLength(0);
    expect(uhcTransactionKey(bsiDifferentAmount)).toBe('');
  });

  test('applyUhcUad labels $0 commission + UAD as advance recoup and leaves commission alone', () => {
    const rec = applyUhcUad(
      { commission: 0, classification: 'New Business', raw: { 'UAD Activity': -11.8 } },
      { 'UAD Activity': -11.8 }
    );
    expect(rec.commission).toBe(0);
    expect(rec.uadActivity).toBeCloseTo(-11.8, 2);
    expect(rec.classification).toBe(UAD_CLASSIFICATION);
    expect(parseUadActivity({ 'UAD Activity': '($48.50)' })).toBeCloseTo(-48.5, 2);
  });
});

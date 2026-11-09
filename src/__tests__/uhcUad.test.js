'use strict';

const path = require('path');
const XLSX = require('xlsx');
const {
  parseUHCRows,
  parseUHCDirectRows,
  parseUhcUploadWorkbook,
  isUHCWorkbook,
  uadTotals,
} = require('../uhcCommissionParse');
const {
  UAD_CLASSIFICATION,
  UHC_FEE_CLASSIFICATION,
  parseUadActivity,
  applyUhcUad,
  crossFileDuplicateKey,
  uhcTransactionKey,
  findIncomingDuplicates,
  isUHCFilename,
  isUHCDirectFilename,
  isExcludedFeeClassification,
} = require('../uhcUad');
const { collapseInternalDuplicates } = require('../uploadBatchDedupe');

const THEI_FILE = path.join(__dirname, 'fixtures', 'UHC_THEI_09.2026_sample.xlsx');
const PERSONAL_FILE = path.join(__dirname, 'fixtures', 'P_UHC_09.2026.xlsx');
const K2_FILE = path.join(__dirname, 'fixtures', 'K2.xlsx');
const K1_FILE = path.join(__dirname, 'fixtures', 'K1.xlsx');

function loadWb(file) {
  return XLSX.readFile(file);
}

describe('UHC UAD + personal statement parse', () => {
  test('filenames: THEI and P_UHC are UHC workbooks, not the 706381-only detector', () => {
    expect(isUHCFilename('UHC_THEI_09.2026.xlsx')).toBe(true);
    expect(isUHCFilename('P_UHC_09.2026.xlsx')).toBe(true);
    expect(isUHCFilename('YP_UHC_STATTEMENT_09.2026.xlsx')).toBe(true);
    expect(isUHCFilename('UHC_THEI_STATEMENT_09.2026.xlsx')).toBe(true);
    expect(isUHCFilename('UHC_BSI_09.2026.xlsx')).toBe(false);
    expect(isUHCDirectFilename('P_UHC_09.2026.xlsx')).toBe(false);
    expect(isUHCDirectFilename('commission_statement_706381_2026-09-13.xlsx')).toBe(true);
    expect(isUHCWorkbook(loadWb(THEI_FILE))).toBe(true);
    expect(isUHCWorkbook(loadWb(PERSONAL_FILE))).toBe(true);
  });

  test('live POST /files/upload path: YP_UHC_STATTEMENT keeps 85 personal rows', () => {
    const records = parseUhcUploadWorkbook(loadWb(PERSONAL_FILE), 'YP_UHC_STATTEMENT_09.2026.xlsx');
    expect(records).not.toBeNull();
    const totals = uadTotals(records);
    expect(totals.rowCount).toBe(85);
    expect(totals.commission).toBeCloseTo(2167.47, 2);
  });

  test('live POST /files/upload path: UHC_THEI_STATEMENT keeps $0 UAD recoup rows', () => {
    const records = parseUhcUploadWorkbook(loadWb(THEI_FILE), 'UHC_THEI_STATEMENT_09.2026.xlsx');
    expect(records).not.toBeNull();
    const totals = uadTotals(records);
    expect(totals.rowCount).toBe(217);
    expect(totals.commission).toBeCloseTo(2449.57, 2);
    expect(totals.uadActivity).toBeCloseTo(-250.73, 2);
    expect(totals.uadRows).toBe(7);
    expect(records.filter((r) => r.commission === 0 && r.uadActivity !== 0).length).toBe(7);
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

  test('Katy K2 09.2026: 24 rows, $409.49 net, 5 appointment fees -$50, commission $459.49', () => {
    const records = parseUHCRows(loadWb(K2_FILE), 'K2.xlsx');
    const totals = uadTotals(records);
    expect(isUHCWorkbook(loadWb(K2_FILE))).toBe(true);
    expect(totals.rowCount).toBe(24);
    expect(totals.commission).toBeCloseTo(409.49, 2);
    expect(totals.commissionExclFees).toBeCloseTo(459.49, 2);
    expect(totals.fees).toBeCloseTo(-50, 2);
    expect(totals.feeRows).toBe(5);

    const fees = records.filter((r) => r.classification === UHC_FEE_CLASSIFICATION);
    expect(fees).toHaveLength(5);
    expect(fees.every((r) => r.commission === -10)).toBe(true);
    expect(fees.every((r) => r.agent === 'Katy Robles')).toBe(true);
    expect(fees.every((r) => r.producerPayable === 0 && r.splitApplies === false)).toBe(true);
    expect(new Set(fees.map((r) => r.policyNumber)).size).toBe(5);
    expect(new Set(fees.map((r) => r.client)).size).toBe(5);
    expect(fees.every((r) => r.client.startsWith('UHC FEE OH Renewal'))).toBe(true);
    expect(isExcludedFeeClassification(UHC_FEE_CLASSIFICATION)).toBe(true);

    const collapsed = collapseInternalDuplicates(records);
    expect(collapsed.removedCount).toBe(0);
    expect(findIncomingDuplicates(fees.slice(0, 1), fees.slice(1))).toHaveLength(0);

    const rodriguez = records.find((r) => r.policyNumber === '930820519');
    expect(rodriguez.client).toBe('RODRIGUEZ, MARIA E.');
    expect(rodriguez.classification).toBe('New Business');
    expect(rodriguez.commission).toBeCloseTo(86.75, 2);
    expect(rodriguez.statementDate).toBe('09/17/2026');

    const fleming = records.find((r) => r.policyNumber === '955826220');
    expect(fleming.client).toBe('FLEMING, SHEBBY J.');
    expect(fleming.classification).toBe('Chargeback');
    expect(fleming.commission).toBeCloseTo(-86.75, 2);
    expect(fleming.statementDate).toBe('09/26/2026');
  });

  test('Katy K1 10.2026: 19 rows $632.99, both REEVES New $86.75 lines kept', () => {
    const records = parseUHCRows(loadWb(K1_FILE), 'K1.xlsx');
    const totals = uadTotals(records);
    expect(totals.rowCount).toBe(19);
    expect(totals.commission).toBeCloseTo(632.99, 2);
    expect(totals.feeRows).toBe(0);
    expect(records.every((r) => r.agent === 'Katy Robles')).toBe(true);

    const reeves = records.filter((r) => r.policyNumber === '923914330');
    expect(reeves).toHaveLength(2);
    expect(reeves.every((r) => r.client === 'REEVES, PAMELA S.')).toBe(true);
    expect(reeves.every((r) => r.classification === 'New Business')).toBe(true);
    expect(reeves.every((r) => r.commission === 86.75)).toBe(true);
    const dates = reeves.map((r) => r.statementDate).sort();
    expect(dates).toEqual(['10/06/2026', '10/08/2026']);
    expect(crossFileDuplicateKey(reeves[0])).not.toBe(crossFileDuplicateKey(reeves[1]));
    expect(uhcTransactionKey(reeves[0])).not.toBe(uhcTransactionKey(reeves[1]));

    const collapsed = collapseInternalDuplicates(records);
    expect(collapsed.removedCount).toBe(0);
    expect(collapsed.records.filter((r) => r.policyNumber === '923914330')).toHaveLength(2);
    expect(findIncomingDuplicates([reeves[0]], [reeves[1]])).toHaveLength(0);
  });

  test('Katy personal files do not overlap THEI agency 09.2026', () => {
    const thei = parseUHCRows(loadWb(THEI_FILE), 'UHC_THEI_09.2026.xlsx');
    const k2 = parseUHCRows(loadWb(K2_FILE), 'K2.xlsx');
    const k1 = parseUHCRows(loadWb(K1_FILE), 'K1.xlsx');
    expect(findIncomingDuplicates(thei, k2)).toHaveLength(0);
    expect(findIncomingDuplicates(thei, k1)).toHaveLength(0);
    expect(findIncomingDuplicates(k2, k1)).toHaveLength(0);
  });
});

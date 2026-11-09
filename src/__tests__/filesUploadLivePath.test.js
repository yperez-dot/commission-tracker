'use strict';

/**
 * Exercises the production POST /api/files/upload UHC stage
 * (parsePostFilesUploadExcel + collapse + findDuplicates after raw_data round-trip).
 */

const path = require('path');
const {
  runPostFilesUpload,
  UHC_FEE_CLASSIFICATION,
  UAD_CLASSIFICATION,
} = require('../filesUploadLivePath');

const FIX = path.join(__dirname, 'fixtures');

function money(rows, field) {
  const key = field || 'commission';
  return Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100;
}

describe('POST /files/upload live path', () => {
  test('Katy K2.xlsx 09.2026: 24 rows, $409.49 net, 5 OH fees -$50 excluded from commission', () => {
    const out = runPostFilesUpload(path.join(FIX, 'K2.xlsx'), 'K2.xlsx');
    expect(out.parser).toBe('uhc_commission_transactions');
    expect(out.internalDuplicatesRemoved).toBe(0);
    expect(out.totals.rowCount).toBe(24);
    expect(out.totals.commissionSum).toBeCloseTo(409.49, 2);
    expect(out.totals.fees).toBeCloseTo(-50, 2);
    expect(out.totals.feeRows).toBe(5);
    expect(out.totals.commissionExclFees).toBeCloseTo(459.49, 2);

    const fees = out.records.filter((r) => r.classification === UHC_FEE_CLASSIFICATION);
    expect(fees).toHaveLength(5);
    expect(fees.every((r) => r.commission === -10)).toBe(true);
    expect(fees.every((r) => r.client.startsWith('UHC FEE OH Renewal'))).toBe(true);
    expect(new Set(fees.map((r) => r.policyNumber)).size).toBe(5);
  });

  test('Katy K1.xlsx 10.2026: 19 rows $632.99, both REEVES 923914330 $86.75 kept', () => {
    const out = runPostFilesUpload(path.join(FIX, 'K1.xlsx'), 'K1.xlsx');
    expect(out.parser).toBe('uhc_commission_transactions');
    expect(out.totals.rowCount).toBe(19);
    expect(out.totals.commissionSum).toBeCloseTo(632.99, 2);
    expect(out.totals.feeRows).toBe(0);

    const reeves = out.records.filter((r) => r.policyNumber === '923914330');
    expect(reeves).toHaveLength(2);
    expect(reeves.every((r) => r.commission === 86.75)).toBe(true);
    expect(reeves.map((r) => r.statementDate).sort()).toEqual(['10/06/2026', '10/08/2026']);
  });

  test('UHC_THEI_10.2026.xlsx: 219 rows, commission $3854.51, UAD -60.30 on Cheung and Willsromero', () => {
    const out = runPostFilesUpload(path.join(FIX, 'UHC_THEI_10.2026.xlsx'), 'UHC_THEI_10.2026.xlsx');
    expect(out.parser).toBe('uhc_commission_transactions');
    expect(out.totals.rowCount).toBe(219);
    expect(out.totals.commissionSum).toBeCloseTo(3854.51, 2);
    expect(out.totals.uadSum).toBeCloseTo(-60.30, 2);
    expect(out.totals.uadRows).toBe(2);

    const uadOnly = out.records.filter((r) => r.classification === UAD_CLASSIFICATION);
    expect(uadOnly).toHaveLength(2);
    expect(uadOnly.every((r) => r.commission === 0)).toBe(true);
    const names = uadOnly.map((r) => r.client).sort();
    expect(names).toEqual(['CHEUNG, CHITING', 'WILLSROMERO, PATRICIO']);
  });

  test('P_UHC_10.2026.xlsx and YP_UHC_STATTEMENT: 85 rows $2167.47', () => {
    const personal = runPostFilesUpload(path.join(FIX, 'P_UHC_10.2026.xlsx'), 'P_UHC_10.2026.xlsx');
    const typo = runPostFilesUpload(path.join(FIX, 'P_UHC_10.2026.xlsx'), 'YP_UHC_STATTEMENT_10.2026.xlsx');
    expect(personal.parser).toBe('uhc_commission_transactions');
    expect(typo.parser).toBe('uhc_commission_transactions');
    expect(personal.totals.rowCount).toBe(85);
    expect(personal.totals.commissionSum).toBeCloseTo(2167.47, 2);
    expect(typo.totals.rowCount).toBe(85);
    expect(typo.totals.commissionSum).toBeCloseTo(2167.47, 2);
  });

  test('duplicate 409: YP personal 09 after THEI 09 is 45 / $1099.67 dup and 40 / $1067.80 new', () => {
    const thei = runPostFilesUpload(
      path.join(FIX, 'UHC_THEI_09.2026_sample.xlsx'),
      'UHC_THEI_STATEMENT_09.2026.xlsx'
    );
    const personal = runPostFilesUpload(
      path.join(FIX, 'P_UHC_09.2026.xlsx'),
      'YP_UHC_STATTEMENT_09.2026.xlsx',
      thei.records
    );
    expect(thei.totals.rowCount).toBe(217);
    expect(personal.totals.rowCount).toBe(85);
    expect(personal.duplicateCheck.duplicateWarning).toBe(true);
    expect(personal.duplicateCheck.duplicateCount).toBe(45);
    expect(personal.duplicateCheck.totalCount).toBe(85);
    expect(money(personal.duplicateCheck.duplicates, 'amount')).toBeCloseTo(1099.67, 2);
    expect(personal.duplicateCheck.newRecords).toHaveLength(40);
    expect(money(personal.duplicateCheck.newRecords)).toBeCloseTo(1067.80, 2);
  });

  test('duplicate 409: personal 10 after THEI 10 is 45 / $1099.67 dup and 40 / $1067.80 new', () => {
    const thei = runPostFilesUpload(path.join(FIX, 'UHC_THEI_10.2026.xlsx'), 'UHC_THEI_10.2026.xlsx');
    const personal = runPostFilesUpload(
      path.join(FIX, 'P_UHC_10.2026.xlsx'),
      'P_UHC_10.2026.xlsx',
      thei.records
    );
    expect(thei.totals.rowCount).toBe(219);
    expect(personal.totals.rowCount).toBe(85);
    expect(personal.duplicateCheck.duplicateCount).toBe(45);
    expect(money(personal.duplicateCheck.duplicates, 'amount')).toBeCloseTo(1099.67, 2);
    expect(personal.duplicateCheck.newRecords).toHaveLength(40);
    expect(money(personal.duplicateCheck.newRecords)).toBeCloseTo(1067.80, 2);
  });
});

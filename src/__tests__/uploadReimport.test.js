'use strict';

/**
 * Re-upload / short-upload regressions (2026-11-09):
 * - same-filename re-upload must say "Already uploaded — N of N…", never a fake success
 * - THEI UHC 09.2026 on the live parser: 217 rows incl. 7 UAD recoups, no blank periods
 * - Doctors/Solis prior-month negative carry (no policy #) takes part in duplicate checks
 * - Solis "Agent Renewal Compensation" is Renewal even when enrolled in the paid month
 *
 * Doctors/Solis fixtures are the real statements with member names, member IDs and
 * MBIs replaced by TEST values; amounts, dates, payment types and layout are unchanged.
 */

const path = require('path');
const XLSX = require('xlsx');
const {
  runPostFilesUpload,
  findDuplicatesLikePostFilesUpload,
  UAD_CLASSIFICATION,
} = require('../filesUploadLivePath');
const { policylessDuplicateKey, duplicateMatchKey } = require('../uhcUad');
const { alreadyUploadedPayload } = require('../uploadAlreadyImported');
const { solisClassification } = require('../solisClassify');
const { uploadNotImportedMessage } = require('../utils/uploadNotImported');

const { parseSolisRows } = require('../solisLedgerParse');

const FIX = path.join(__dirname, 'fixtures');
const money = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.commission) || 0), 0) * 100) / 100;
const uad = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.uadActivity) || 0), 0) * 100) / 100;

function parseLedger(fixture, uploadName) {
  return parseSolisRows(XLSX.readFile(path.join(FIX, fixture)), uploadName);
}

describe('THEI UHC statements on the live POST /files/upload parser', () => {
  test('UHC_THEI_STATEMENT_09.2026.xlsx: 217 rows, $2449.57, 7 UAD recoups -$250.73, every row 202609', () => {
    const out = runPostFilesUpload(path.join(FIX, 'UHC_THEI_09.2026_sample.xlsx'), 'UHC_THEI_STATEMENT_09.2026.xlsx');
    expect(out.internalDuplicatesRemoved).toBe(0);
    expect(out.records).toHaveLength(217);
    expect(money(out.records)).toBeCloseTo(2449.57, 2);
    expect(uad(out.records)).toBeCloseTo(-250.73, 2);
    expect(out.records.every((r) => r.period === '202609')).toBe(true);

    const recoups = out.records
      .filter((r) => r.classification === UAD_CLASSIFICATION)
      .map((r) => [r.client, r.commission, r.uadActivity])
      .sort();
    expect(recoups).toEqual([
      ['CHAPMAN, WENDY', 0, -48.5],
      ['CHEUNG, CHITING', 0, -11.8],
      ['HENNING, ROMA', 0, -33.13],
      ['SMITH, MAURICIO', 0, -11.8],
      ['WILLSROMERO, PATRICIO', 0, -48.5],
      ['WU, KAMLING', 0, -48.5],
      ['YAN, MOW', 0, -48.5],
    ]);

    // Blank "Payment Period" on the statement → filename period (09.2026).
    const blankOnStatement = out.records.filter((r) => !String(r.raw['Payment Period'] || '').trim());
    expect(blankOnStatement.map((r) => [r.client, r.commission, r.classification])).toEqual([
      ['CARRENO, GAIL', -86.75, 'Chargeback'],
      ['CARRENO, GAIL', 86.75, 'New Business'],
      ['CHANG, MIRIAM H.', 86.75, 'New Business'],
    ]);
    expect(blankOnStatement.every((r) => r.period === '202609')).toBe(true);
  });

  test('UHC_THEI_STATEMENT_10.2026.xlsx: 219 rows, $3854.51, UAD -$60.30 (Cheung, Willsromero), every row 202610', () => {
    const out = runPostFilesUpload(path.join(FIX, 'UHC_THEI_10.2026.xlsx'), 'UHC_THEI_STATEMENT_10.2026.xlsx');
    expect(out.records).toHaveLength(219);
    expect(money(out.records)).toBeCloseTo(3854.51, 2);
    expect(uad(out.records)).toBeCloseTo(-60.3, 2);
    expect(out.records.every((r) => r.period === '202610')).toBe(true);
    const recoups = out.records.filter((r) => r.uadActivity).map((r) => [r.client, r.uadActivity]).sort();
    expect(recoups).toEqual([['CHEUNG, CHITING', -11.8], ['WILLSROMERO, PATRICIO', -48.5]]);
  });

  test('re-uploading 09.2026 after the old 210-row import: 210 lines match, 7 UAD lines are new', () => {
    const full = runPostFilesUpload(path.join(FIX, 'UHC_THEI_09.2026_sample.xlsx'), 'UHC_THEI_STATEMENT_09.2026.xlsx').records;
    // The pre-fix import: no UAD rows, blank period on the 3 rows without Payment Period.
    const old = full
      .filter((r) => r.classification !== UAD_CLASSIFICATION)
      .map((r) => (String(r.raw['Payment Period'] || '').trim() ? r : { ...r, period: '' }));
    expect(old).toHaveLength(210);
    const dup = findDuplicatesLikePostFilesUpload(old, full);
    expect(dup.duplicateCount).toBe(210);
    expect(dup.newRecords).toHaveLength(7);
    expect(dup.newRecords.every((r) => r.classification === UAD_CLASSIFICATION)).toBe(true);
  });
});

describe('Doctors / Solis Commissions Ledger', () => {
  test('YP_DOCTORS_08.2026.xlsx parses 5 rows, net -$231.25', () => {
    const recs = parseLedger('YP_DOCTORS_08.2026.xlsx', 'YP_DOCTORS_08.2026.xlsx');
    expect(recs.map((r) => [r.client, r.commission, r.classification, r.period])).toEqual([
      ['Negative Charge from Previous Month', -346.93, 'Chargeback', '202608'],
      ['TEST MEMBER 01', 28.92, 'Renewal', '202608'],
      ['TEST MEMBER 02', 28.92, 'Renewal', '202608'],
      ['TEST MEMBER 03', 28.92, 'Renewal', '202608'],
      ['TEST MEMBER 04', 28.92, 'Renewal', '202608'],
    ]);
    expect(money(recs)).toBeCloseTo(-231.25, 2);
    expect(recs.every((r) => r.carrier === 'Doctors' && r.agent === 'Yahoska Perez')).toBe(true);
  });

  test('YP_SOLIS_STATEMENT_01.2026_10.2026.xlsx parses 6 rows = Total Amount $1795.33; $347 lines are Renewal', () => {
    const recs = parseLedger('YP_SOLIS_STATEMENT_01.2026_10.2026.xlsx', 'YP_SOLIS_STATEMENT_01.2026_10.2026.xlsx');
    expect(recs.map((r) => [r.client, r.commission, r.classification, r.period])).toEqual([
      ['TEST MEMBER 05', -203.67, 'Chargeback', '202412'],
      ['TEST MEMBER 05', 611, 'New Business', '202407'],
      ['TEST MEMBER 06', 347, 'Renewal', '202601'],
      ['TEST MEMBER 07', 347, 'Renewal', '202601'],
      ['TEST MEMBER 08', 347, 'Renewal', '202601'],
      ['TEST MEMBER 09', 347, 'Renewal', '202601'],
    ]);
    expect(money(recs)).toBeCloseTo(1795.33, 2);
    // Blank Agent Legal Name on one row does not shift Agent Name.
    expect(recs.every((r) => r.agent === 'Yahoska Perez' && r.carrier === 'Solis')).toBe(true);
  });

  test('KATY_SOLIS_STATEMENT_09.2026.xlsx (H0982): 5 rows, $809.68, initial compensation = New Business', () => {
    const recs = parseLedger('KATY_SOLIS_STATEMENT_09.2026.xlsx', 'KATY_SOLIS_STATEMENT_09.2026.xlsx');
    expect(recs).toHaveLength(5);
    expect(money(recs)).toBeCloseTo(809.68, 2);
    expect(recs.every((r) => r.period === '202609' && r.agent === 'Katy Robles')).toBe(true);
    expect(recs.filter((r) => r.classification === 'New Business').map((r) => [r.client, r.commission]))
      .toEqual([['TEST MEMBER 11', 694]]);
    expect(recs.filter((r) => r.classification === 'Renewal')).toHaveLength(4);
  });

  test('re-uploading the Doctors file flags the policy-less negative carry as a duplicate too', () => {
    const recs = parseLedger('YP_DOCTORS_08.2026.xlsx', 'YP_DOCTORS_08.2026.xlsx');
    const dup = findDuplicatesLikePostFilesUpload(recs, recs);
    expect(dup.duplicateCount).toBe(5);
    expect(dup.newRecords).toHaveLength(0);
    expect(policylessDuplicateKey(recs[0])).toMatch(/^nopolicy\|doctors\|yahoska perez\|negative charge/);
    expect(duplicateMatchKey(recs[1])).toBe(duplicateMatchKey({ ...recs[1] }));
  });

  test('same-amount renewals in other months are NOT duplicates of 08.2026', () => {
    const aug = parseLedger('YP_DOCTORS_08.2026.xlsx', 'YP_DOCTORS_08.2026.xlsx');
    const sep = aug.map((r) => ({ ...r, period: '202609' }));
    const oct = aug.map((r) => ({ ...r, period: '202610' }));
    const dup = findDuplicatesLikePostFilesUpload([...sep, ...oct], aug);
    expect(dup.duplicateCount).toBe(0);
    expect(dup.newRecords).toHaveLength(5);
  });

  test("a different month's negative carry with a different amount is not a duplicate", () => {
    const aug = parseLedger('YP_DOCTORS_08.2026.xlsx', 'YP_DOCTORS_08.2026.xlsx');
    const otherCarry = { ...aug[0], period: '202609', commission: -231.25 };
    const dup = findDuplicatesLikePostFilesUpload([otherCarry], aug);
    expect(dup.duplicateCount).toBe(0);
  });
});

describe('already-uploaded messaging', () => {
  test('payload says N of N matched and nothing imported', () => {
    const p = alreadyUploadedPayload({
      filename: 'KATY_SOLIS_STATEMENT_09.2026.xlsx', existingUploadId: 42, matchCount: 5, totalCount: 5, filenameTaken: true,
    });
    expect(p.alreadyUploaded).toBe(true);
    expect(p.rowCount).toBe(0);
    expect(p.error).toMatch(/^Already uploaded — 5 of 5 lines match existing records, nothing imported\./);
    expect(p.error).toMatch(/already in Uploads; delete that upload first/);
  });

  test('UI never shows a success banner for a 409 / missing rowCount', () => {
    expect(uploadNotImportedMessage({ status: 409, error: '"X" has already been uploaded. Delete it first.' }))
      .toMatch(/already been uploaded/);
    expect(uploadNotImportedMessage({ status: 409, ...alreadyUploadedPayload({ matchCount: 5, totalCount: 5 }) }))
      .toMatch(/^Already uploaded — 5 of 5/);
    expect(uploadNotImportedMessage({})).toMatch(/Nothing was imported/);
    expect(uploadNotImportedMessage({ status: 409, duplicateWarning: true })).toBe('');
    expect(uploadNotImportedMessage({ rowCount: 5, commissionSum: 809.68 })).toBe('');
  });

  test('Solis classification: explicit payment type wins over enrollment month', () => {
    expect(solisClassification('agent renewal compensation', 347, true)).toBe('Renewal');
    expect(solisClassification('agent retention', 28.92, true)).toBe('Renewal');
    expect(solisClassification('agent initial compensation', 694, true)).toBe('New Business');
    expect(solisClassification('agent chargeback for disenrollment', -203.67, false)).toBe('Chargeback');
    expect(solisClassification('', 100, true)).toBe('New Business');
    expect(solisClassification('', 100, false)).toBe('Renewal');
  });
});

'use strict';

const path = require('path');
const XLSX = require('xlsx');
const { solisClassification, CARRYOVER_CLASSIFICATION } = require('../solisClassify');
const { isCarryoverClassification, isCarryoverClassSql } = require('../solisCarryover');
const { parseSolisRows } = require('../solisLedgerParse');
const { findDuplicatesLikePostFilesUpload } = require('../filesUploadLivePath');

const FIX = path.join(__dirname, 'fixtures');
const money = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.commission) || 0), 0) * 100) / 100;

describe('Doctors / Solis prior-month carryover', () => {
  test('payment type maps to Carryover, not Chargeback', () => {
    expect(solisClassification('negative charge from previous month', -346.93, false, {
      isPriorMonthNegative: true,
    })).toBe(CARRYOVER_CLASSIFICATION);
    expect(isCarryoverClassification(CARRYOVER_CLASSIFICATION)).toBe(true);
    expect(isCarryoverClassification('Chargeback')).toBe(false);
    expect(isCarryoverClassSql('cr')).toMatch(/carryover from previous/i);
  });

  test('YP_DOCTORS_08.2026.xlsx: 5 rows net -$231.25; carryover labeled Carryover', () => {
    const recs = parseSolisRows(XLSX.readFile(path.join(FIX, 'YP_DOCTORS_08.2026.xlsx')), 'YP_DOCTORS_08.2026.xlsx');
    expect(recs.map((r) => [r.client, r.commission, r.classification, r.period])).toEqual([
      ['Negative Charge from Previous Month', -346.93, CARRYOVER_CLASSIFICATION, '202608'],
      ['TEST MEMBER 01', 28.92, 'Renewal', '202608'],
      ['TEST MEMBER 02', 28.92, 'Renewal', '202608'],
      ['TEST MEMBER 03', 28.92, 'Renewal', '202608'],
      ['TEST MEMBER 04', 28.92, 'Renewal', '202608'],
    ]);
    expect(money(recs)).toBeCloseTo(-231.25, 2);
  });

  test('member chargebacks stay Chargeback; carryover is not a duplicate of a later month carry', () => {
    expect(solisClassification('agent chargeback for disenrollment', -203.67, false)).toBe('Chargeback');
    const aug = parseSolisRows(XLSX.readFile(path.join(FIX, 'YP_DOCTORS_08.2026.xlsx')), 'YP_DOCTORS_08.2026.xlsx');
    const sepCarry = { ...aug[0], period: '202609', commission: -231.25 };
    const dup = findDuplicatesLikePostFilesUpload([aug[0]], [sepCarry]);
    expect(dup.duplicateCount).toBe(0);
  });
});

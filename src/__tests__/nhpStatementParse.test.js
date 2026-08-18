'use strict';

const path = require('path');
const XLSX = require('xlsx');
const {
  parseNhpMoney,
  isNhpTotalRow,
  isNhpChargeBacksRollup,
  isNhpHouseOnlyClientName,
  buildNhpChargeBacksHouseRecord,
  nhpStatementCheckAmount,
  parseNhpWorkbook,
  NHP_CHARGE_BACKS_CLIENT,
} = require('../nhpStatementParse');

describe('parseNhpMoney', () => {
  test('handles currency, commas, leading minus, and accounting parens', () => {
    expect(parseNhpMoney('-$14,554.63')).toBeCloseTo(-14554.63);
    expect(parseNhpMoney('($210.00)')).toBeCloseTo(-210);
    expect(parseNhpMoney('$4,265.16')).toBeCloseTo(4265.16);
    expect(parseNhpMoney(-96.25)).toBeCloseTo(-96.25);
    expect(parseNhpMoney('')).toBe(0);
  });
});

describe('NHP footer row detection', () => {
  test('TOTAL footer is skipped even when it has money', () => {
    expect(isNhpTotalRow({ lob: 'TOTAL', client: '' })).toBe(true);
    expect(isNhpTotalRow({ lob: 'MA', client: 'SAMPLE, MEMBER' })).toBe(false);
  });

  test('C/B Charge Backs rollup has no policy and is not a member', () => {
    expect(isNhpChargeBacksRollup({
      lob: 'C/B',
      agency: 'Charge Backs',
      commClass: 'Charge Backs',
      client: '',
      policyNumber: '',
    })).toBe(true);
    expect(isNhpChargeBacksRollup({
      lob: 'MA',
      client: 'CHARGE, ITEM',
      commType: 'New Chargeback',
      commClass: 'Override',
      policyNumber: '986226000',
    })).toBe(false);
  });

  test('house record keeps the full recoup on THEI (no 50/50)', () => {
    const rec = buildNhpChargeBacksHouseRecord({ amount: '-$14,554.63', period: '20260530' });
    expect(rec.client).toBe(NHP_CHARGE_BACKS_CLIENT);
    expect(rec.theiShare).toBeCloseTo(-14554.63);
    expect(rec.producerPayable).toBe(0);
    expect(rec.bsiShare).toBe(0);
    expect(rec.splitApplies).toBe(false);
    expect(rec.excludeFromBob).toBe(true);
    expect(isNhpHouseOnlyClientName(rec.client)).toBe(true);
  });
});

describe('May 30 THEI principal NHP fixture', () => {
  const fixture = path.join(
    __dirname,
    '../../fixtures/nhp-thei-principal-may30-chargebacks.csv'
  );

  function parse() {
    const wb = XLSX.readFile(fixture, { raw: true });
    return parseNhpWorkbook(
      wb,
      '202608',
      'THE_HEALTH_EXPERST_INSURANCE_-_YAHOSKA_PEREZ__principal_-_KATY_ROBLES-_NHP_Commission_Report_2782.csv'
    );
  }

  test('uses May 30 2026 payment cycle, not coverage month', () => {
    const records = parse();
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.period === '20260530')).toBe(true);
    expect(records.every((r) => r.payee === 'NHP')).toBe(true);
  });

  test('ingests C/B rollup as house, skips TOTAL, keeps itemized chargeback', () => {
    const records = parse();
    const house = records.filter((r) => r.client === NHP_CHARGE_BACKS_CLIENT);
    expect(house).toHaveLength(1);
    expect(house[0].theiShare).toBeCloseTo(-14554.63);
    expect(house[0].grossCommission).toBeCloseTo(-14554.63);

    expect(records.some((r) => /total/i.test(r.client))).toBe(false);
    expect(records.filter((r) => r.client === 'Charge Backs')).toHaveLength(0);

    const itemizedCb = records.find((r) => r.policyNumber === '986226000');
    expect(itemizedCb).toBeTruthy();
    expect(itemizedCb.grossCommission).toBeCloseTo(-96.25);
  });

  test('paren negatives and blank member names still parse', () => {
    const records = parse();
    const paren = records.find((r) => r.policyNumber === 'FL-TEST-002');
    expect(paren.producerPayable).toBeCloseTo(-210);
    const unnamed = records.find((r) => r.policyNumber === 'D4SRR9');
    expect(unnamed).toBeTruthy();
    expect(unnamed.client).toMatch(/Unknown \(D4SRR9\)/);
    expect(unnamed.grossCommission).toBeCloseTo(9.8);
  });

  test('Override-class dollars in the Commission column are not dropped', () => {
    const records = parse();
    const carepoint = records.find((r) => r.policyNumber === 'HS877249');
    expect(carepoint).toBeTruthy();
    expect(carepoint.grossCommission).toBeCloseTo(10.21);
    const acaOverrideClass = records.find((r) => r.policyNumber === '1V8A76');
    expect(acaOverrideClass.producerPayable).toBeCloseTo(27);
    const aetnaNoLob = records.find((r) => r.policyNumber === 'NG101778595300');
    expect(aetnaNoLob).toBeTruthy();
    expect(aetnaNoLob.grossCommission).toBeCloseTo(3.21);
    expect(aetnaNoLob.carrier).toBe('Aetna');
  });

  test('NHP check reconstruction includes the -$14,554.63 recoup', () => {
    const records = parse();
    const check = nhpStatementCheckAmount(records);
    // Itemized pots + fee + C/B rollup. TOTAL footer must not be added again.
    expect(check).toBeLessThan(-14000);
    expect(records.filter((r) => r.classification === 'NHP Charge Backs')).toHaveLength(1);
  });
});

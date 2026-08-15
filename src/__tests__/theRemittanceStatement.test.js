'use strict';

const path = require('path');
const XLSX = require('xlsx');
const {
  isTheRemittanceStatement,
  periodFromTheRemittanceTitle,
  parseTheRemittanceStatement,
} = require('../theRemittanceStatement');

describe('theRemittanceStatement', () => {
  const samplePath = path.join(__dirname, '../../fixtures/T.H.E_STATEMENTS_JULY_SAMPLE.csv');

  it('detects JULY - THE / T.H.E_STATEMENTS filename', () => {
    const wb = XLSX.readFile(samplePath);
    expect(isTheRemittanceStatement(wb, 'T.H.E_STATEMENTS.csv')).toBe(true);
    expect(isTheRemittanceStatement(wb, 'random.xlsx')).toBe(true); // title row
  });

  it('period from JULY - THE title defaults to most recent July', () => {
    expect(periodFromTheRemittanceTitle('JULY - THE', 'T.H.E_STATEMENTS.csv', new Date('2026-08-13T00:00:00Z'))).toBe(
      '202607'
    );
    expect(periodFromTheRemittanceTitle('JULY 2025 - THE', 'x.csv')).toBe('202507');
  });

  it('recognizes Spanish month titles (JUNIO / JULIO / MAYO)', () => {
    expect(periodFromTheRemittanceTitle('JUNIO - THE HEALTH EXPERTS INSURANCE', 'x.csv', new Date('2026-08-13T00:00:00Z'))).toBe(
      '202606'
    );
    expect(periodFromTheRemittanceTitle('MAYO - THE', 'x.csv', new Date('2026-08-13T00:00:00Z'))).toBe('202605');
  });

  it('parses sample file with 50/50 remittance shares', () => {
    const wb = XLSX.readFile(samplePath);
    const records = parseTheRemittanceStatement(wb, 'T.H.E_STATEMENTS.csv');
    expect(records.length).toBeGreaterThan(100);

    const sumThei = records.reduce((s, r) => s + r.theiShare, 0);
    expect(Math.round(sumThei * 100) / 100).toBe(1790.84);

    const standard = records.find((r) => r.agent === 'Jendy Vanheyningen' && r.theiShare === 70);
    expect(standard).toBeTruthy();
    expect(standard.bsiShare).toBe(70);
    expect(standard.grossCommission).toBe(140);
    expect(standard.period).toBe('202607');
    expect(standard.payee).toBe('BSI');
    expect(standard.source).toBe('BSI');

    const integrity = records.find((r) => /christian munoz/i.test(r.agent) && r.theiShare === 41.25);
    expect(integrity).toBeTruthy();
    expect(integrity.bsiShare).toBe(41.25);
    expect(integrity.producerPayable).toBe(82.5);
    expect(integrity.grossCommission).toBe(165);

    const clawback = records.find((r) => r.theiShare === -30 && /borcione/i.test(r.client));
    expect(clawback).toBeTruthy();
    expect(clawback.classification).toBe('Agency Override Chargeback');

    const credit = records.find((r) => r.theiShare === 70 && /vanheyningen/i.test(r.agent));
    expect(credit).toBeTruthy();
    expect(credit.classification).toBe('Agency Override');

    const byCarrier = records.reduce((acc, r) => {
      acc[r.carrier] = (acc[r.carrier] || 0) + 1;
      return acc;
    }, {});
    expect(byCarrier.UnitedHealthcare).toBeGreaterThan(0);
    expect(byCarrier.Humana).toBeGreaterThan(0);
    expect(byCarrier.Aetna).toBeGreaterThan(0);
  });
});

'use strict';

const {
  classifyTHECarrierTransaction,
  classifyHumanaDevotedBSITransaction,
} = require('../theCarrierStatementClassify');

describe('classifyTHECarrierTransaction', () => {
  test('Devoted Transaction Type Override → Agent Commission (not Agency Override)', () => {
    expect(
      classifyTHECarrierTransaction({
        transactionType: 'Override',
        commission: 694,
        carrier: 'Devoted',
      })
    ).toBe('Agent Commission');
  });

  test('Humana Override stays Agency Override', () => {
    expect(
      classifyTHECarrierTransaction({
        transactionType: 'Override',
        commission: 50,
        carrier: 'Humana',
      })
    ).toBe('Agency Override');
  });

  test('New Business / Renewal / Chargeback', () => {
    expect(
      classifyTHECarrierTransaction({
        transactionType: 'New Business',
        commission: 694,
        carrier: 'Devoted',
      })
    ).toBe('New Business');
    expect(
      classifyTHECarrierTransaction({
        transactionType: 'Renewal',
        commission: 100,
        carrier: 'Devoted',
      })
    ).toBe('Renewal');
    expect(
      classifyTHECarrierTransaction({
        transactionType: 'Override',
        commission: -50,
        carrier: 'Devoted',
      })
    ).toBe('Chargeback');
  });

  test('default Agent Commission', () => {
    expect(
      classifyTHECarrierTransaction({
        transactionType: '',
        commission: 100,
        carrier: 'Devoted',
      })
    ).toBe('Agent Commission');
  });
});

describe('classifyHumanaDevotedBSITransaction', () => {
  test('BSI Devoted/Humana positive amounts are Agency Override (not New Business)', () => {
    expect(classifyHumanaDevotedBSITransaction({ commission: 81.25 })).toBe('Agency Override');
    expect(classifyHumanaDevotedBSITransaction({ commission: 48.75 })).toBe('Agency Override');
  });

  test('negative amounts are Chargeback', () => {
    expect(classifyHumanaDevotedBSITransaction({ commission: -10 })).toBe('Chargeback');
  });
});

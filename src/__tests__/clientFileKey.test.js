'use strict';

const { clientNameKey, clientFileGroupKey, clientNameKeySql } = require('../clientNameKey');

describe('clientNameKey', () => {
  test('merges Last, First and First Last formats', () => {
    expect(clientNameKey('CAMBAS DE RIVAS, MILAGROS')).toBe(
      clientNameKey('Milagros Cambas De Rivas')
    );
  });

  test('clientFileGroupKey keeps carriers separate', () => {
    expect(clientFileGroupKey('Milagros Cambas De Rivas', 'Aetna')).not.toBe(
      clientFileGroupKey('Milagros Cambas De Rivas', 'Devoted')
    );
  });

  test('ignores case and extra punctuation', () => {
    expect(clientNameKey('RONALDO BALBOA')).toBe(clientNameKey('ronaldo balboa'));
  });

  test('clientNameKeySql uses the requested column', () => {
    expect(clientNameKeySql('ap', 'client_name')).toContain('ap.client_name');
    expect(clientNameKeySql('cr')).toContain('cr.client_full_name');
  });
});

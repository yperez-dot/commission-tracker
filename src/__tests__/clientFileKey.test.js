'use strict';

const { clientNameKey, clientFileGroupKey } = require('../clientNameKey');

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
});

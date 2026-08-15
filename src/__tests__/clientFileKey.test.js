'use strict';

/**
 * All Data client-file grouping key (matches /records/by-client GROUP BY).
 */
function clientFileKey(clientName, carrier) {
  return `${String(clientName || '').toLowerCase().trim()}|${String(carrier || '').toLowerCase().trim()}`;
}

describe('clientFileKey', () => {
  test('groups same client+carrier ignoring case/space', () => {
    expect(clientFileKey('RONALDO BALBOA', 'Devoted')).toBe(clientFileKey('ronaldo balboa ', ' devoted'));
  });

  test('keeps different carriers separate', () => {
    expect(clientFileKey('RICARDO BALBOA', 'Oscar Health')).not.toBe(
      clientFileKey('RICARDO BALBOA', 'Devoted')
    );
  });
});

module.exports = { clientFileKey };

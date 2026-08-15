'use strict';

const {
  paymentResolvesChase,
  appendAutoResolveNote,
  renewalMatchKey,
} = require('../renewalsAutoResolve');

describe('renewalsAutoResolve', () => {
  test('renewalMatchKey normalizes name/carrier/agent', () => {
    expect(renewalMatchKey('GARCIA, MARIA L.', 'UnitedHealthcare', 'Yahoska Perez'))
      .toBe(renewalMatchKey('Maria Garcia', 'UHC', 'Yahoska Perez'));
  });

  test('paymentResolvesChase requires positive commission + name/carrier match', () => {
    const status = {
      client_full_name: 'Maria Garcia',
      carrier: 'Humana',
      agent_name: 'Katy Robles',
    };
    expect(paymentResolvesChase({
      client_full_name: 'GARCIA, MARIA',
      carrier: 'Humana',
      agent_name: 'Katy Robles',
      commission: 50,
    }, status)).toBe(true);

    expect(paymentResolvesChase({
      client_full_name: 'GARCIA, MARIA',
      carrier: 'Humana',
      agent_name: 'Katy Robles',
      commission: -50,
    }, status)).toBe(false);

    expect(paymentResolvesChase({
      client_full_name: 'GARCIA, MARIA',
      carrier: 'Aetna',
      agent_name: 'Katy Robles',
      commission: 50,
    }, status)).toBe(false);

    expect(paymentResolvesChase({
      client_full_name: 'GARCIA, MARIA',
      carrier: 'Humana',
      agent_name: 'Yahoska Perez',
      commission: 50,
    }, status)).toBe(false);
  });

  test('appendAutoResolveNote does not duplicate identical stamps', () => {
    const once = appendAutoResolveNote(null, 'Paid in upload #1');
    expect(once).toContain('[Auto-resolved]');
    expect(appendAutoResolveNote(once, 'Paid in upload #1')).toBe(once);
    expect(appendAutoResolveNote(once, 'Paid in upload #2')).toContain('upload #2');
  });
});

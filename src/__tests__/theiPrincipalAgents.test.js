'use strict';

const {
  THEI_DIRECT_AGENTS,
  DASHBOARD_PRINCIPAL_AGENTS,
  DASHBOARD_MY_AGENTS,
  isTheiDirectAgent,
  isTheiHouseWritingName,
  isTheiPrincipalAgent,
} = require('../theiPrincipalAgents');

describe('theiPrincipalAgents', () => {
  it('lists direct agents aligned with Sales Recon', () => {
    expect(THEI_DIRECT_AGENTS).toEqual([
      'Yahoska Perez',
      'Katy Robles',
      'Carolina Robles',
    ]);
  });

  it('dashboard principal view includes direct agents and house', () => {
    expect(DASHBOARD_PRINCIPAL_AGENTS).toContain('Yahoska Perez');
    expect(DASHBOARD_PRINCIPAL_AGENTS).toContain('Carolina Robles');
    expect(DASHBOARD_PRINCIPAL_AGENTS).toContain('The Health Experts Insurance');
  });

  it('dashboard MY_AGENTS includes Carolina', () => {
    expect(DASHBOARD_MY_AGENTS).toContain('Carolina Robles');
  });

  it('isTheiDirectAgent matches name variants', () => {
    expect(isTheiDirectAgent('Carolina Andrea Robles')).toBe(true);
    expect(isTheiDirectAgent('Yahoska G Perez')).toBe(true);
    expect(isTheiDirectAgent('Gina Berenguer')).toBe(false);
  });

  it('isTheiDirectAgent includes THEI house UHC writing names', () => {
    expect(isTheiHouseWritingName('The Health Experts Insurance')).toBe(true);
    expect(isTheiHouseWritingName('The Health Experts')).toBe(true);
    expect(isTheiHouseWritingName('Health Experts')).toBe(true);
    expect(isTheiDirectAgent('The Health Experts Insurance')).toBe(true);
    expect(isTheiDirectAgent('Health Experts')).toBe(true);
  });

  it('isTheiPrincipalAgent is Yahoska + Katy only (missing renewals BOB)', () => {
    expect(isTheiPrincipalAgent('Yahoska Perez')).toBe(true);
    expect(isTheiPrincipalAgent('Katy Robles')).toBe(true);
    expect(isTheiPrincipalAgent('Carolina Robles')).toBe(false);
    expect(isTheiPrincipalAgent('Alan Elchami')).toBe(false);
  });
});

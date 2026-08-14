'use strict';

const {
  THEI_DIRECT_AGENTS,
  THEI_EXCLUDED_FROM_DIRECT,
  DASHBOARD_PRINCIPAL_AGENTS,
  DASHBOARD_MY_AGENTS,
  isTheiDirectAgent,
  isTheiExcludedFromDirect,
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

  it('Alan Elchami is excluded from direct/principal filters', () => {
    expect(THEI_EXCLUDED_FROM_DIRECT).toContain('Alan Elchami');
    expect(isTheiExcludedFromDirect('Alan Elchami')).toBe(true);
    expect(isTheiExcludedFromDirect('Eidi Alan')).toBe(true);
    expect(isTheiDirectAgent('Alan Elchami')).toBe(false);
    expect(isTheiDirectAgent('Eidi Alan')).toBe(false);
    expect(DASHBOARD_PRINCIPAL_AGENTS).not.toContain('Alan Elchami');
  });

  it('house writing still matches for Yahoska UHC after Alan exclusion', () => {
    expect(isTheiDirectAgent('The Health Experts Insurance')).toBe(true);
    expect(isTheiDirectAgent('The Health Experts')).toBe(true);
  });
});

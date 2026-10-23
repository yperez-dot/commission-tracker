'use strict';

// Synthetic names only. Schedule-list agents are taken from the lists, never spelled out.
const { agentNameMatches, agentNameInList, agentNameWords } = require('../agentNameMatch');
const { MARCO_AGENTS, INTEGRITY_AGENTS, isMarcoAgent, isIntegrityAgent } = require('../payeeSchedules');
const { agentHasFixedCut } = require('../nhpOverrideSplit');

const tc = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const [first, last] = MARCO_AGENTS[8].split(' ');

describe('agentNameMatches (first + last, tolerant)', () => {
  it('matches a middle initial, middle name, punctuation, case and "Last, First M"', () => {
    const entry = 'sample person';
    for (const n of [
      'Sample Person', 'SAMPLE PERSON', 'Sample L Person', 'Sample L. Person', 'Sample Lee Person',
      'Sample Lee Ann Person', 'Person, Sample', 'PERSON, SAMPLE L', 'Person, Sample L.', 'Sample  Person  Jr.',
      'Sample-Person', ' sample person ', 'Sámple Persón',
    ]) {
      expect(agentNameMatches(n, entry)).toBe(true);
    }
  });

  it('does not create false matches', () => {
    const entry = 'sample person';
    for (const n of [
      'Sample Personal', 'Samples Person', 'Sampler Person', 'S Person', 'Sample P', 'Other Person',
      'Sample Other', 'Person Sample Other', 'Sample', 'Person', '', null,
      'Sample Lee Ann Marie Person', // more than two middle names
    ]) {
      expect(agentNameMatches(n, entry)).toBe(false);
    }
  });

  it('company entries keep matching their legal-name variants', () => {
    const entry = 'sample insurance solutions corp';
    expect(agentNameMatches('Sample Insurance Solutions Corp', entry)).toBe(true);
    expect(agentNameMatches('SAMPLE INSURANCE SOLUTIONS CORP.', entry)).toBe(true);
    expect(agentNameMatches('Sample Insurance Solutions Corporation', entry)).toBe(true);
    expect(agentNameMatches('Sample Insurance Solutions Corp, LLC', entry)).toBe(true);
    expect(agentNameMatches('Sample Insurance Group', entry)).toBe(false);
  });

  it('agentNameWords turns "Last, First M" around', () => {
    expect(agentNameWords('Person, Sample L.')).toEqual(['sample', 'l', 'person']);
    expect(agentNameWords('Sample Person, Jr')).toEqual(['sample', 'person']);
  });
});

describe('schedule lists use the tolerant matching', () => {
  it('a Swan agent with a middle initial gets Marco (the case the old rule missed)', () => {
    const withInitial = `${tc(first)} L ${tc(last)}`;
    expect(String(withInitial).toLowerCase().includes(MARCO_AGENTS[8])).toBe(false); // old rule
    expect(isMarcoAgent(withInitial, '202609')).toBe(true);
    expect(isMarcoAgent(`${tc(last)}, ${tc(first)} L.`, '202609')).toBe(true);
    expect(isMarcoAgent(`${tc(first)} ${tc(last)}son`, '202609')).toBe(false);
  });

  it('every Swan and Integrity entry still matches its plain spelling', () => {
    for (const a of MARCO_AGENTS) expect(agentNameInList(tc(a), MARCO_AGENTS)).toBe(true);
    for (const a of INTEGRITY_AGENTS) expect(isIntegrityAgent(tc(a))).toBe(true);
  });

  it('Jendy cutoff still applies with a middle initial', () => {
    const jendy = MARCO_AGENTS.find((a) => a.startsWith('jendy'));
    const [f, l] = jendy.split(' ');
    const name = `${tc(f)} Q ${tc(l)}`;
    expect(isMarcoAgent(name, '202605')).toBe(true);
    expect(isMarcoAgent(name, '202606')).toBe(false);
  });

  it('Integrity with a middle initial keeps its fixed-cut schedule', () => {
    const [f, l] = INTEGRITY_AGENTS[0].split(' ');
    const name = `${tc(f)} A. ${tc(l)}`;
    expect(isIntegrityAgent(name)).toBe(true);
    expect(agentHasFixedCut(name, 'UnitedHealthcare')).toBe(agentHasFixedCut(tc(INTEGRITY_AGENTS[0]), 'UnitedHealthcare'));
  });

  it('made-up agents are not on any list', () => {
    expect(isMarcoAgent('Sample Writer Alpha', '202609')).toBe(false);
    expect(isIntegrityAgent('Sample Writer Alpha')).toBe(false);
  });
});

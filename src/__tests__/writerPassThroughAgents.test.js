'use strict';

const {
  resolvePassThroughLiableAgent,
  clientMatchesPassThroughPatterns,
  ALAN_ELCHAMI_CLIENT_PATTERNS,
  listPassThroughAgents,
} = require('../writerPassThroughAgents');

describe('writerPassThroughAgents', () => {
  it('lists Alan and Sabri pass-through agents', () => {
    const agents = listPassThroughAgents();
    expect(agents.map((a) => a.name)).toEqual(['Alan Elchami', 'Sabri Perez']);
    expect(agents[0].clientCount).toBe(22);
  });

  it('matches Alan Katy-list clients by carrier name format', () => {
    expect(clientMatchesPassThroughPatterns('NELSON, WILLIE M.', ALAN_ELCHAMI_CLIENT_PATTERNS)).toBe(true);
    expect(clientMatchesPassThroughPatterns('Guillaume, Marie N.', ALAN_ELCHAMI_CLIENT_PATTERNS)).toBe(true);
    expect(clientMatchesPassThroughPatterns('Yahoska Perez client', ALAN_ELCHAMI_CLIENT_PATTERNS)).toBe(false);
  });

  it('attributes house UHC chargebacks on Alan clients to Alan', () => {
    expect(
      resolvePassThroughLiableAgent({
        agentName: 'The Health Experts Insurance',
        clientName: 'NELSON, WILLIE M.',
        commission: -150,
      })
    ).toBe('Alan Elchami');
  });

  it('attributes chargebacks already tagged Alan Elchami', () => {
    expect(
      resolvePassThroughLiableAgent({
        agentName: 'Alan Elchami',
        clientName: 'Winston Benjamin',
        commission: -75,
      })
    ).toBe('Alan Elchami');
  });

  it('ignores positive commissions', () => {
    expect(
      resolvePassThroughLiableAgent({
        agentName: 'The Health Experts Insurance',
        clientName: 'NELSON, WILLIE M.',
        commission: 150,
      })
    ).toBeNull();
  });

  it('attributes Sabri house chargebacks via MedicarePro sale agent', () => {
    expect(
      resolvePassThroughLiableAgent({
        agentName: 'The Health Experts Insurance',
        clientName: 'Some New Client',
        commission: -100,
        saleAgentName: 'Sabri Perez',
      })
    ).toBe('Sabri Perez');
  });

  it('does not attribute unrelated house chargebacks', () => {
    expect(
      resolvePassThroughLiableAgent({
        agentName: 'The Health Experts Insurance',
        clientName: 'Random Client Name',
        commission: -50,
      })
    ).toBeNull();
  });
});

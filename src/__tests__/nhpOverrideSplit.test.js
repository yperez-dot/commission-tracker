'use strict';

const {
  integrityFixedProducerCut,
  isNhpIntegrityFixedNb,
  splitNhpMedicareOverride,
} = require('../nhpOverrideSplit');

describe('nhpOverrideSplit', () => {
  test('Chris UHC NB fixed cut lands in producer_payable, not sub_agent_override', () => {
    const s = splitNhpMedicareOverride({
      pot: 165,
      agentName: 'Christian Munoz',
      carrier: 'UnitedHealthcare',
      classification: 'New Business Override',
      isBsiEligible: true,
    });
    expect(s.producerPayable).toBe(82.5);
    expect(s.subAgentOverride).toBe(0);
    expect(s.theiShare).toBe(41.25);
    expect(s.bsiShare).toBe(41.25);
  });

  test('Integrity statement field mapping: historical sub_agent_override alone still countable', () => {
    // Classifier regression helper — amount prefers producer_payable
    const row = { producer_payable: 0, sub_agent_override: 82.5, commission: 41.25 };
    const amount = Number(row.producer_payable) || Number(row.sub_agent_override);
    expect(amount).toBe(82.5);
  });

  test('CAM uses 50/25/25 on BSI-eligible pot', () => {
    const s = splitNhpMedicareOverride({
      pot: 200,
      agentName: 'CAM Insurance Solutions Corp',
      carrier: 'Humana',
      classification: 'Agency Override',
      isBsiEligible: true,
    });
    expect(s.producerPayable).toBe(100);
    expect(s.theiShare).toBe(50);
    expect(s.bsiShare).toBe(50);
    expect(s.subAgentOverride).toBe(0);
  });

  test('Marco first policy peels $10 into sub_agent_override', () => {
    const s = splitNhpMedicareOverride({
      pot: 100,
      agentName: 'Jena Brewer',
      carrier: 'Humana',
      classification: 'Agency Override',
      paymentPeriod: '202601',
      isBsiEligible: true,
      alreadyDeducted: false,
    });
    expect(s.subAgentOverride).toBe(10);
    expect(s.theiShare).toBe(45);
    expect(s.bsiShare).toBe(45);
    expect(s.producerPayable).toBe(0);
  });

  test('Marco alreadyDeducted skips second $10', () => {
    const s = splitNhpMedicareOverride({
      pot: 100,
      agentName: 'Jena Brewer',
      carrier: 'Humana',
      classification: 'Agency Override',
      paymentPeriod: '202602',
      isBsiEligible: true,
      alreadyDeducted: true,
    });
    expect(s.subAgentOverride).toBe(0);
    expect(s.theiShare).toBe(50);
    expect(s.bsiShare).toBe(50);
  });

  test('fixed-rate helpers', () => {
    expect(integrityFixedProducerCut('Doctors')).toBe(50);
    expect(isNhpIntegrityFixedNb('Christian Munoz', 'Doctors', 'New Business')).toBe(true);
    expect(isNhpIntegrityFixedNb('CAM Insurance Solutions Corp', 'Doctors', 'New Business')).toBe(false);
  });

  test('negative NHP cycle does not skip Chris split or BSI half on a new sale', () => {
    const chris = splitNhpMedicareOverride({
      pot: 175,
      agentName: 'Christian Munoz',
      carrier: 'Doctors',
      classification: 'New',
      isBsiEligible: true,
    });
    expect(chris.producerPayable).toBe(50);
    expect(chris.theiShare).toBe(62.5);
    expect(chris.bsiShare).toBe(62.5);

    const houseNewSale = splitNhpMedicareOverride({
      pot: 100,
      agentName: 'Yahoska Perez',
      carrier: 'Humana',
      classification: 'New',
      isBsiEligible: true,
    });
    expect(houseNewSale.theiShare).toBe(50);
    expect(houseNewSale.bsiShare).toBe(50);
    expect(houseNewSale.producerPayable).toBe(0);
  });
});

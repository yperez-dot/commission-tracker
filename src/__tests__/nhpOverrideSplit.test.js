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

  describe('Integrity: renewals not paid, fixed-cut chargebacks take back the cut', () => {
    test('NHP Integrity renewal → producer 0, THEI/BSI 50/50 (THEI only before BSI split)', () => {
      const s = splitNhpMedicareOverride({
        pot: 20, agentName: 'Horacio Mendieta', carrier: 'Humana', classification: 'Renewal', isBsiEligible: true,
      });
      expect(s.producerPayable).toBe(0);
      expect(s.theiShare).toBe(10);
      expect(s.bsiShare).toBe(10);
      const pre = splitNhpMedicareOverride({
        pot: 20, agentName: 'CAM Insurance Solutions Corp', carrier: 'Humana', classification: 'Renewal', isBsiEligible: false,
      });
      expect(pre.producerPayable).toBe(0);
      expect(pre.theiShare).toBe(20);
      expect(pre.bsiShare).toBe(0);
    });

    test('full chargeback of a fixed-cut sale takes back the whole cut', () => {
      const s = splitNhpMedicareOverride({
        pot: -175, agentName: 'Christian Munoz', carrier: 'Doctors', classification: 'New Business',
        isBsiEligible: true, originalSale: { gross: 175, producer: 50 },
      });
      expect(s.producerPayable).toBe(-50);
      expect(s.theiShare).toBe(-62.5);
      expect(s.bsiShare).toBe(-62.5);
      expect(s.needsReview).toBe(false);
    });

    test('partial chargeback takes back the cut in the same proportion', () => {
      const s = splitNhpMedicareOverride({
        pot: -82.5, agentName: 'Horacio Mendieta', carrier: 'UnitedHealthcare', classification: 'Chargeback',
        isBsiEligible: true, originalSale: { gross: 165, producer: 82.5 },
      });
      expect(s.producerPayable).toBe(-41.25);
      expect(s.producerPayable + s.theiShare + s.bsiShare).toBeCloseTo(-82.5, 2);
    });

    test('original sale unknown → full fixed cut (capped at the line) and flagged for review', () => {
      const s = splitNhpMedicareOverride({
        pot: -175, agentName: 'Christian Munoz', carrier: 'Solis', classification: 'Chargeback', isBsiEligible: true,
      });
      expect(s.producerPayable).toBe(-62.5);
      expect(s.needsReview).toBe(true);
      const small = splitNhpMedicareOverride({
        pot: -20, agentName: 'Christian Munoz', carrier: 'Solis', classification: 'Chargeback', isBsiEligible: true,
      });
      expect(small.producerPayable).toBe(-20);
    });

    test('CAM and non-fixed carriers keep 50/25/25 chargebacks; other agents unchanged', () => {
      const cam = splitNhpMedicareOverride({
        pot: -100, agentName: 'CAM Insurance Solutions Corp', carrier: 'Doctors', classification: 'Chargeback', isBsiEligible: true,
      });
      expect(cam.producerPayable).toBe(-50);
      const humana = splitNhpMedicareOverride({
        pot: -100, agentName: 'Horacio Mendieta', carrier: 'Humana', classification: 'Chargeback', isBsiEligible: true,
      });
      expect(humana.producerPayable).toBe(-50);
      for (const agent of ['Edgar Piloto', 'Ivan Santiago']) {
        const o = splitNhpMedicareOverride({
          pot: -100, agentName: agent, carrier: 'UnitedHealthcare', classification: 'Chargeback', isBsiEligible: true,
        });
        expect(o.producerPayable).toBe(0);
        expect(o.theiShare).toBe(-50);
      }
    });
  });

  describe('UHC plan year 2026 fixed $82.50 (Chris incl. CAM, and Horacio)', () => {
    for (const agent of ['Christian Munoz', 'CAM Insurance Solutions Corp', 'Horacio Mendieta']) {
      test(`${agent}: $150 pot → producer 82.50, BSI keeps 25%, THEI absorbs the extra`, () => {
        const s = splitNhpMedicareOverride({
          pot: 150, agentName: agent, carrier: 'UnitedHealthcare', classification: 'New Business',
          isBsiEligible: true, effectiveDate: '2026-03-01',
        });
        expect(s.producerPayable).toBe(82.5);
        expect(s.bsiShare).toBe(37.5);
        expect(s.theiShare).toBe(30);
        const back = splitNhpMedicareOverride({
          pot: -150, agentName: agent, carrier: 'UnitedHealthcare', classification: 'Chargeback',
          isBsiEligible: true, effectiveDate: '2026-03-01', originalSale: { gross: 150, producer: 82.5 },
        });
        expect(back.producerPayable).toBe(-82.5);
        expect(back.bsiShare).toBe(-37.5);
        expect(back.theiShare).toBe(-30);
      });
    }

    test('CAM stays 50/25/25 on Doctors / Solis / HealthSun; Piloto / Santiago never fixed', () => {
      const cam = splitNhpMedicareOverride({
        pot: 175, agentName: 'CAM Insurance Solutions Corp', carrier: 'Doctors', classification: 'New Business', isBsiEligible: true,
      });
      expect(cam.producerPayable).toBe(87.5);
      for (const agent of ['Edgar Piloto', 'Ivan Santiago']) {
        const o = splitNhpMedicareOverride({
          pot: 150, agentName: agent, carrier: 'UnitedHealthcare', classification: 'New Business',
          isBsiEligible: true, effectiveDate: '2026-03-01',
        });
        expect(o.producerPayable).toBe(0);
        expect(o.theiShare).toBe(75);
        expect(o.bsiShare).toBe(75);
      }
    });
  });
});

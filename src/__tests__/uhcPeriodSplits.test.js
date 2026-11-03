'use strict';

// Synthetic fixtures only — fictional policies, members, and amounts.

const {
  periodFromFilename,
  periodFromStatementDate,
  resolveBsiRowPeriod,
} = require('../periodFormat');
const { resolveYearType } = require('../overrideRateEngine');
const {
  applyBsiBookAgentProduction,
  peelAlbaProduction,
  ALBA_DB_AGENT,
  BSI_WRITING_NPN,
} = require('../bsiBookAttribution');
const {
  linaProportionalChargeback,
} = require('../linaChargebackProrate');
const {
  splitEvenHouse,
  splitIntegrityThreeWay,
  splitIntegrityRenewal,
} = require('../overrideSplitMath');
const {
  STATEMENT_TYPES,
  classifyOverrideLine,
  buildOverrideStatements,
} = require('../overrideStatementBuilder');
const {
  planUhcSplitSaleCorrection,
  TARGET_POLICY,
  PARTS,
} = require('../uhcSplitSalePolicyCorrection');
const { buildLinaCompensationStatement } = require('../linaCompensationStatement');
const { buildIntegrityStatement } = require('../integrityStatement');
const { parseAmlPortalRows, parsePeriod } = require('../bsiAmlPortalCsv');
const { planLinaRemainingOverrideCorrection } = require('../linaRemainingOverrideCorrection');

const uhcBase = {
  carrier: 'UnitedHealthcare',
  period: '202610',
  payee: 'BSI',
  source: 'BSI',
  client: 'SAMPLE, MEMBER',
};

describe('1. UHC period: Statement Date + filename MM.YY; never silent blank', () => {
  it('filename BSI.UHC.10.26.xlsx → 202610', () => {
    expect(periodFromFilename('BSI.UHC.10.26.xlsx')).toBe('202610');
    expect(periodFromFilename('BSI.UHC.10-2026.xlsx')).toBe('202610');
    expect(periodFromFilename('BSI_UHC_10.2026.xlsx')).toBe('202610');
  });

  it('blank Payment Period uses Statement Date month (MM/DD/YYYY)', () => {
    expect(periodFromStatementDate('10/06/2026')).toBe('202610');
    expect(resolveBsiRowPeriod({
      'Payment Period': '',
      'Statement Date': '10/06/2026',
    }, null)).toBe('202610');
  });

  it('Payment Period wins over Statement Date; filename is last resort', () => {
    expect(resolveBsiRowPeriod({
      'Payment Period': '09.2026',
      'Statement Date': '10/06/2026',
    }, '202610')).toBe('202609');
    expect(resolveBsiRowPeriod({
      'Payment Period': '',
      'Statement Date': '',
    }, '202610')).toBe('202610');
  });

  it('still-blank period is an empty string the upload can warn on', () => {
    expect(resolveBsiRowPeriod({ 'Payment Period': '', 'Statement Date': '' }, null)).toBe('');
    expect(resolveBsiRowPeriod({ 'Payment Period': '', 'Statement Date': '' }, '')).toBe('');
  });

  it('AML portal Statement Date accepts Date objects and MM/DD/YYYY', () => {
    expect(parsePeriod('10/16/2026')).toBe('202610');
    expect(parsePeriod(new Date(Date.UTC(2026, 9, 16)))).toBe('202610');
  });
});

describe('2. Lina BSI-written UHC chargebacks follow prior payments, not the rate table', () => {
  it('sums all prior payments on the policy: -844 → Lina -694 / house -150', () => {
    const orig = { gross: 844, producer: 694, thei: 75, bsi: 75 };
    const s = linaProportionalChargeback(-844, orig);
    expect(s.producerPayable).toBe(-694);
    expect(s.theiShare).toBe(-75);
    expect(s.bsiShare).toBe(-75);
    expect(s.producerPayable + s.theiShare + s.bsiShare).toBeCloseTo(-844, 2);
  });

  it('upload uses stored originals; flags when none exist', () => {
    const withOrig = [{
      ...uhcBase,
      agent: ALBA_DB_AGENT,
      classification: 'Chargeback',
      policyNumber: 'SYN-CB-844',
      commission: -844,
      memberState: 'TX',
      raw: { 'Commission Action': 'New Chargeback', 'Comp Type': 'I', 'Member State': 'TX', 'Writing Agent NPN': BSI_WRITING_NPN },
    }];
    applyBsiBookAgentProduction(withOrig, {
      linaOriginalSales: new Map([['uhc|syn-cb-844', { gross: 844, producer: 694, thei: 75, bsi: 75 }]]),
    });
    expect(withOrig[0]).toMatchObject({ producerPayable: -694, theiShare: -75, bsiShare: -75 });
    expect(withOrig[0].mga).toMatch(/in proportion to the original payment/);

    const none = [{
      ...uhcBase,
      agent: 'Broker Society Insurance',
      classification: 'Chargeback',
      policyNumber: 'SYN-CB-NONE',
      commission: -844,
      memberState: 'TX',
      raw: { 'Commission Action': 'New Chargeback', 'Comp Type': 'I', 'Member State': 'TX', 'Writing Agent NPN': BSI_WRITING_NPN },
    }];
    applyBsiBookAgentProduction(none);
    expect(none[0].agent).toBe(ALBA_DB_AGENT);
    expect(none[0].mga || '').toMatch(/no original payment found/);
    expect(none[0].producerPayable + none[0].theiShare + none[0].bsiShare).toBeCloseTo(-844, 2);
  });
});

describe('3. Rojas-type: positive BSI-written UHC new sale never gives Lina a negative share', () => {
  it('caps house override at the line when Initial CA $175 exceeds +89.50', () => {
    const records = [{
      ...uhcBase,
      agent: 'Broker Society Insurance',
      classification: 'New Business',
      policyNumber: 'SYN-ROJAS',
      commission: 89.5,
      memberState: 'CA',
      effectiveDate: '11/01/2026',
      statementDate: '10/06/2026',
      raw: {
        'Commission Action': 'New',
        'Comp Type': 'R',
        'Member State': 'CA',
        'Original Effective Date': '11/01/2026',
        'Statement Date': '10/06/2026',
        'Writing Agent NPN': BSI_WRITING_NPN,
      },
    }];
    applyBsiBookAgentProduction(records);
    expect(records[0].agent).toBe(ALBA_DB_AGENT);
    expect(records[0].producerPayable).toBeGreaterThanOrEqual(0);
    expect(records[0].producerPayable).toBe(0);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(89.5, 2);
    expect(records[0].producerPayable + records[0].theiShare + records[0].bsiShare).toBeCloseTo(89.5, 2);
    expect(records[0].mga || '').toMatch(/House override capped at the line/);
  });

  it('peelAlbaProduction itself never returns Lina < 0 on a positive line', () => {
    const peel = peelAlbaProduction({
      carrier: 'UnitedHealthcare',
      classification: 'New Business',
      memberState: 'CA',
      effectiveDate: '11/01/2026',
      statementDate: '10/06/2026',
      raw: {
        'Commission Action': 'New',
        'Comp Type': 'R',
        'Member State': 'CA',
        'Original Effective Date': '11/01/2026',
        'Statement Date': '10/06/2026',
      },
    }, 89.5);
    expect(peel.producerPayable).toBeGreaterThanOrEqual(0);
    expect(peel.totalOverride).toBeCloseTo(89.5, 2);
  });

  it('ignores a leftover prior peel with Lina < 0 so a new CA Initial is not under-peeled', () => {
    const leftover = new Map([['uhc|syn-rojas', {
      gross: 89.5, producer: -15.5, thei: 52.5, bsi: 52.5,
    }]]);
    const records = [{
      ...uhcBase,
      agent: 'Broker Society Insurance',
      classification: 'New Business',
      policyNumber: 'SYN-ROJAS',
      commission: 89.5,
      memberState: 'CA',
      effectiveDate: '11/01/2026',
      statementDate: '10/06/2026',
      raw: {
        'Commission Action': 'New',
        'Comp Type': 'R',
        'Member State': 'CA',
        'Original Effective Date': '11/01/2026',
        'Statement Date': '10/06/2026',
        'Writing Agent NPN': BSI_WRITING_NPN,
      },
    }];
    applyBsiBookAgentProduction(records, { linaOriginalSales: leftover });
    expect(records[0].producerPayable).toBe(0);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(89.5, 2);
  });

  it('re-peels a stored leftover +19.50 CA Initial back to Lina 0', () => {
    const { updates } = planLinaRemainingOverrideCorrection([{
      id: 21,
      agent_name: ALBA_DB_AGENT,
      carrier: 'UnitedHealthcare',
      classification: 'New Business',
      policy_number: 'SYN-ROJAS',
      payment_period: '202610',
      commission: 89.5,
      producer_payable: 19.5,
      thei_share: 35,
      bsi_share: 35,
      effective_date: '11/01/2026',
      raw_data: {
        'Commission Action': 'New',
        'Comp Type': 'R',
        'Member State': 'CA',
        'Original Effective Date': '11/01/2026',
        'Statement Date': '10/06/2026',
      },
    }], new Map());
    expect(updates).toHaveLength(1);
    expect(updates[0].after).toEqual({ producer: 0, thei: 44.75, bsi: 44.75 });
  });
});

describe('4. UHC split New + Comp Type R is one first-year sale, not a renewal', () => {
  it('New + Comp Type R on a not-yet-effective policy is Initial', () => {
    expect(resolveYearType({
      compType: 'R',
      commissionAction: 'New',
      effectiveDate: '08/01/2026',
      statementDate: '05/21/2026',
    })).toBe('Initial');
  });

  it('parts of the same new sale share one Initial override ($150 once)', () => {
    const records = [
      {
        ...uhcBase,
        period: '202605',
        agent: 'Broker Society Insurance',
        classification: 'New Business',
        policyNumber: 'SYN-SPLIT',
        commission: 294.59,
        memberState: 'TX',
        effectiveDate: '08/01/2026',
        statementDate: '05/21/2026',
        raw: {
          'Commission Action': 'New',
          'Comp Type': 'R',
          'Member State': 'TX',
          'Original Effective Date': '08/01/2026',
          'Statement Date': '05/21/2026',
          'Writing Agent NPN': BSI_WRITING_NPN,
        },
      },
      {
        ...uhcBase,
        period: '202606',
        agent: 'Broker Society Insurance',
        classification: 'New Business',
        policyNumber: 'SYN-SPLIT',
        commission: 549.41,
        memberState: 'TX',
        effectiveDate: '08/01/2026',
        statementDate: '06/11/2026',
        raw: {
          'Commission Action': 'New',
          'Comp Type': 'I',
          'Member State': 'TX',
          'Original Effective Date': '08/01/2026',
          'Statement Date': '06/11/2026',
          'Writing Agent NPN': BSI_WRITING_NPN,
        },
      },
    ];
    applyBsiBookAgentProduction(records);
    expect(records[0]).toMatchObject({ producerPayable: 144.59, theiShare: 75, bsiShare: 75 });
    expect(records[1]).toMatchObject({ producerPayable: 549.41, theiShare: 0, bsiShare: 0 });
    expect(records[0].producerPayable + records[1].producerPayable).toBeCloseTo(694, 2);
    expect(records[0].theiShare + records[0].bsiShare + records[1].theiShare + records[1].bsiShare)
      .toBeCloseTo(150, 2);
    expect(records[1].mga || '').toMatch(/Same new sale as a prior payment/);
  });

  it('idempotent correction rewrites only the matching split-sale rows for the targeted policy', () => {
    const other = 'syn-other-policy';
    const rows = [
      {
        id: 1,
        policyNumber: 'SYN-SPLIT-FIX',
        payment_period: '202605',
        commission: 294.59,
        producer_payable: 219.59,
        thei_share: 37.5,
        bsi_share: 37.5,
      },
      {
        id: 2,
        policyNumber: 'SYN-SPLIT-FIX',
        payment_period: '202606',
        commission: 549.41,
        producer_payable: 399.41,
        thei_share: 75,
        bsi_share: 75,
      },
      {
        id: 3,
        policyNumber: other,
        payment_period: '202605',
        commission: 294.59,
        producer_payable: 219.59,
        thei_share: 37.5,
        bsi_share: 37.5,
      },
    ];
    const first = planUhcSplitSaleCorrection(rows, { policyNumber: 'SYN-SPLIT-FIX' });
    expect(first.updates).toHaveLength(2);
    expect(first.updates.map((u) => u.id)).toEqual([1, 2]);
    expect(first.updates[0].after).toEqual({ producer: 144.59, thei: 75, bsi: 75 });
    expect(first.updates[1].after).toEqual({ producer: 549.41, thei: 0, bsi: 0 });

    const already = [
      { ...rows[0], producer_payable: 144.59, thei_share: 75, bsi_share: 75 },
      { ...rows[1], producer_payable: 549.41, thei_share: 0, bsi_share: 0 },
    ];
    expect(planUhcSplitSaleCorrection(already, { policyNumber: 'SYN-SPLIT-FIX' }).updates).toHaveLength(0);

    expect(TARGET_POLICY).toMatch(/^\d+$/);
    expect(PARTS).toHaveLength(2);
  });

  it('rewrites the June installment even when its stored split is not the exact historical from', () => {
    const rows = [
      {
        id: 11,
        policyNumber: 'SYN-SPLIT-FIX',
        payment_period: '202605',
        commission: 294.59,
        producer_payable: 144.59,
        thei_share: 75,
        bsi_share: 75,
      },
      {
        id: 12,
        policyNumber: 'SYN-SPLIT-FIX',
        payment_period: '202606',
        commission: 549.41,
        producer_payable: 0,
        thei_share: 0,
        bsi_share: 0,
      },
    ];
    const planned = planUhcSplitSaleCorrection(rows, { policyNumber: 'SYN-SPLIT-FIX' });
    expect(planned.updates).toHaveLength(1);
    expect(planned.updates[0].id).toBe(12);
    expect(planned.updates[0].after).toEqual({ producer: 549.41, thei: 0, bsi: 0 });
  });
});

describe('5. Integrity UHC renewals go house 50/50 like Humana', () => {
  it('upload splits an Integrity UHC Renewal: producer 0, THEI/BSI 50/50', () => {
    const records = [
      {
        ...uhcBase,
        agent: 'Christian Munoz',
        classification: 'Renewal',
        policyNumber: 'SYN-INT-RN-C',
        commission: 6.26,
        raw: { 'Commission Action': 'Renewal', 'Comp Type': 'R' },
      },
      {
        ...uhcBase,
        agent: 'Horacio Mendieta',
        classification: 'Renewal',
        policyNumber: 'SYN-INT-RN-H',
        commission: 6.26,
        raw: { 'Commission Action': 'Renewal', 'Comp Type': 'R' },
      },
    ];
    applyBsiBookAgentProduction(records);
    for (const r of records) {
      expect(r.producerPayable).toBe(0);
      expect(r.theiShare).toBe(3.13);
      expect(r.bsiShare).toBe(3.13);
      expect(r.theiShare + r.bsiShare).toBeCloseTo(6.26, 2);
    }
    expect(splitIntegrityRenewal(6.26, 'Christian Munoz', 'Renewal').producerPayable).toBe(0);
  });

  it('house statements list them; Integrity agent statements do not', () => {
    const row = {
      id: 501,
      agent_name: 'Christian Munoz',
      client_full_name: 'SAMPLE, MEMBER',
      policy_number: 'SYN-INT-RN-C',
      carrier: 'UnitedHealthcare',
      payment_period: '202610',
      classification: 'Renewal',
      source: 'BSI',
      commission: 6.26,
      gross_commission: 6.26,
      producer_payable: 0,
      thei_share: 3.13,
      bsi_share: 3.13,
    };
    expect(classifyOverrideLine(row, STATEMENT_TYPES.THEI_BSI).amount).toBe(3.13);
    expect(classifyOverrideLine(row, STATEMENT_TYPES.BSI_OVERRIDE).amount).toBe(3.13);
    expect(classifyOverrideLine(row, STATEMENT_TYPES.INTEGRITY)).toBeNull();
    const chris = buildIntegrityStatement([row], 'christian-munoz', { period: '202610' });
    expect(chris.lineCount).toBe(0);
  });
});

describe('6. BSI house statement uses the same BSI-upload source filter as THEI', () => {
  it('excludes NHP HealthSun-type rows from BSI_OVERRIDE and THEI_BSI', () => {
    const nhp = {
      id: 601,
      agent_name: 'Sample Writer Alpha',
      client_full_name: 'SAMPLE, MEMBER',
      policy_number: 'SYN-HSUN',
      carrier: 'HealthSun',
      payment_period: '202610',
      classification: 'Agency Override',
      source: 'NHP',
      commission: 7.78,
      thei_share: 7.78,
      bsi_share: 0,
      producer_payable: 0,
    };
    const bsi = {
      ...nhp,
      id: 602,
      source: 'BSI',
      thei_share: 3.89,
      bsi_share: 3.89,
    };
    expect(classifyOverrideLine(nhp, STATEMENT_TYPES.BSI_OVERRIDE)).toBeNull();
    expect(classifyOverrideLine(nhp, STATEMENT_TYPES.THEI_BSI)).toBeNull();
    expect(classifyOverrideLine(bsi, STATEMENT_TYPES.BSI_OVERRIDE).amount).toBe(3.89);
    expect(classifyOverrideLine(bsi, STATEMENT_TYPES.THEI_BSI).amount).toBe(3.89);

    const bundle = buildOverrideStatements([nhp, bsi], STATEMENT_TYPES.BSI_OVERRIDE, { period: '202610' });
    expect(bundle.grandTotal).toBe(3.89);
    expect(bundle.statements[0].lineCount).toBe(1);
  });
});

describe('7. Shares always sum to the line; remainder cent to THEI; Marrero CB consistent', () => {
  it('50/50 odd-cent lines: THEI gets the extra half-cent, both signs', () => {
    expect(splitEvenHouse(7.33)).toEqual({ theiShare: 3.67, bsiShare: 3.66 });
    expect(splitEvenHouse(-7.33)).toEqual({ theiShare: -3.67, bsiShare: -3.66 });
    expect(splitEvenHouse(0.21).theiShare + splitEvenHouse(0.21).bsiShare).toBeCloseTo(0.21, 2);
    expect(splitEvenHouse(-0.21).theiShare + splitEvenHouse(-0.21).bsiShare).toBeCloseTo(-0.21, 2);
  });

  it('Integrity 50/25/25 of -27.50 sums to the line (not -27.49)', () => {
    const s = splitIntegrityThreeWay(-27.5);
    expect(s.producerPayable + s.theiShare + s.bsiShare).toBeCloseTo(-27.5, 2);
    expect(s.producerPayable).toBe(-13.75);
    expect(s.bsiShare + s.theiShare).toBeCloseTo(-13.75, 2);
  });

  it('other-agent (Marrero-type) chargeback reverse uses the same remainder-to-THEI split', () => {
    const records = [{
      ...uhcBase,
      agent: 'Sample Writer Alpha',
      classification: 'Chargeback',
      policyNumber: 'SYN-MARRERO',
      commission: -7.33,
      raw: {},
    }];
    applyBsiBookAgentProduction(records);
    expect(records[0].producerPayable).toBe(0);
    expect(records[0].theiShare).toBe(-3.67);
    expect(records[0].bsiShare).toBe(-3.66);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(-7.33, 2);
  });
});

describe('AML agency NPN does not steal named writers onto Lina', () => {
  it('Humana Integrity Override CB with BSI writing NPN stays on Horacio 50/25/25', () => {
    const { records } = parseAmlPortalRows([
      {
        'Statement Date': '10/16/2026',
        'Agent Name': 'Broker Society Insurance',
        'Policy #': 'SYN-SIMPSON',
        'Effective Date': '01/01/2026',
        'Original EffectiveDate': '01/01/2026',
        'Insured Name': 'SAMPLE, SIMPSON',
        Carrier: 'HUMANA',
        State: 'FL',
        Product: 'Medicare Advantage',
        'Commission ($)': '-$27.50',
        Status: 'Paid',
        'Commission Type': 'Override',
        'Writing Agent': 'Horacio Mendieta',
        'Writing Agent Code': 'EX9999',
        'Writing Agent NPN': BSI_WRITING_NPN,
      },
    ]);
    expect(records).toHaveLength(1);
    applyBsiBookAgentProduction(records);
    const r = records[0];
    expect(r.agent).toBe('Horacio Mendieta');
    expect(r.agent).not.toBe(ALBA_DB_AGENT);
    expect(r.producerPayable).toBe(-13.75);
    expect(r.theiShare + r.bsiShare).toBeCloseTo(-13.75, 2);
    expect(r.producerPayable + r.theiShare + r.bsiShare).toBeCloseTo(-27.5, 2);

    const stmtRows = [{
      id: 1,
      agent_name: r.agent,
      client_full_name: r.client,
      policy_number: r.policyNumber,
      carrier: r.carrier,
      payment_period: '202610',
      classification: r.classification,
      commission: r.commission,
      producer_payable: r.producerPayable,
      thei_share: r.theiShare,
      bsi_share: r.bsiShare,
      source: 'BSI',
      payee: 'BSI',
    }];
    const hor = buildIntegrityStatement(stmtRows, 'horacio-mendieta', { period: '202610' });
    expect(hor.balance).toBeCloseTo(-13.75, 2);
    expect(hor.lineCount).toBe(1);
    const lina = buildLinaCompensationStatement(stmtRows, { period: '202610' });
    expect(lina.lineCount).toBe(0);
  });

  it('other named writer with BSI writing NPN stays house 50/50, not remapped to Lina', () => {
    const records = [{
      agent: 'Sample Writer Alpha',
      classification: 'Chargeback',
      commission: -30,
      carrier: 'Devoted Health',
      client: 'SAMPLE, MEMBER',
      policyNumber: 'SYN-JENDY',
      period: '202610',
      payee: 'BSI',
      source: 'BSI',
      raw: {
        'Commission Type': 'Override',
        'Writing Agent': 'Sample Writer Alpha',
        'Writing Agent NPN': BSI_WRITING_NPN,
        'Agent Name': 'Broker Society Insurance',
      },
    }];
    applyBsiBookAgentProduction(records);
    expect(records[0].agent).toBe('Sample Writer Alpha');
    expect(records[0].producerPayable).toBe(0);
    expect(records[0].theiShare + records[0].bsiShare).toBeCloseTo(-30, 2);
  });

  it('blank / house writing-agent name with BSI NPN still remaps to Lina', () => {
    const records = [{
      ...uhcBase,
      agent: 'Broker Society Insurance',
      classification: 'Chargeback',
      policyNumber: 'SYN-HOUSE-NPN',
      commission: -105.5,
      memberState: 'FL',
      raw: {
        'Commission Action': 'New Chargeback',
        'Comp Type': 'R',
        'Member State': 'FL',
        'Writing Agent NPN': BSI_WRITING_NPN,
      },
    }];
    applyBsiBookAgentProduction(records);
    expect(records[0].agent).toBe(ALBA_DB_AGENT);
    expect(records[0].producerPayable + records[0].theiShare + records[0].bsiShare)
      .toBeCloseTo(-105.5, 2);
  });
});

describe('statement builders still read Lina / Integrity from the stored shares', () => {
  it('Lina compensation uses producer_payable (HRA 100% still Lina)', () => {
    const rows = [
      {
        id: 1,
        agent_name: ALBA_DB_AGENT,
        carrier: 'UnitedHealthcare',
        classification: 'Chargeback',
        payment_period: '202610',
        policy_number: 'SYN-CB-844',
        client_full_name: 'SAMPLE, MEMBER',
        producer_payable: -694,
        thei_share: -75,
        bsi_share: -75,
        commission: -844,
        source: 'BSI',
        payee: 'BSI',
      },
      {
        id: 2,
        agent_name: ALBA_DB_AGENT,
        carrier: 'UnitedHealthcare',
        classification: 'HRA/Bonus',
        payment_period: '202610',
        policy_number: 'SYN-HRA',
        client_full_name: 'SAMPLE, MEMBER',
        producer_payable: 50,
        thei_share: 0,
        bsi_share: 0,
        commission: 50,
        source: 'BSI',
        payee: 'BSI',
      },
    ];
    const s = buildLinaCompensationStatement(rows, { period: '202610' });
    expect(s.balance).toBeCloseTo(-644, 2);
  });
});

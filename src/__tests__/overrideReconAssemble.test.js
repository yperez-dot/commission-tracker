'use strict';

const {
  findOverrideMatch,
  buildNameIndex,
  buildOverrideMatches,
  getThreeWayOverrideStatus,
  getHoldDetail,
} = require('../agencyOverrideReconMatch.cjs');
const { assembleOverrideRecon } = require('../overrideReconAssemble');

function prod(overrides = {}) {
  return {
    id: 1,
    client_name: 'Milagros Cambas De Rivas',
    carrier: 'Aetna',
    agent_name: 'Hernandez, Alba',
    status: 'Active',
    effective_date: '2026-01-01',
    ...overrides,
  };
}

const houseRows = [
  {
    id: 10,
    client_full_name: 'CAMBAS DE RIVAS, MILAGROS',
    carrier: 'Aetna',
    commission: 80,
    classification: 'Agency Override',
    upload_name: 'Medicare Statement -THE-March.pdf',
  },
  {
    id: 11,
    client_full_name: 'Milagros Cambas De Rivas',
    carrier: 'Aetna',
    commission: -80,
    classification: 'Agency Override Chargeback',
    upload_name: 'thei_statement_BSI_06.2026.csv',
  },
];

describe('indexed matching matches nested-scan semantics', () => {
  test('findOverrideMatch with index nets the same clawback', () => {
    const index = buildNameIndex(houseRows);
    const unindexed = findOverrideMatch(prod(), houseRows);
    const indexed = findOverrideMatch(prod(), houseRows, index);
    expect(indexed.override_net).toBe(unindexed.override_net);
    expect(indexed.matchCount).toBe(unindexed.matchCount);
    expect(indexed.override_net).toBe(0);
  });

  test('index ignores unrelated clients (no false match)', () => {
    const extra = [
      ...houseRows,
      { id: 99, client_full_name: 'Jane Doe', carrier: 'Aetna', commission: 150, classification: 'Agency Override' },
    ];
    const index = buildNameIndex(extra);
    const match = findOverrideMatch(prod(), extra, index);
    expect(match.matchCount).toBe(2);
    expect(match.override_net).toBe(0);
  });

  test('large corpus: indexed match equals unindexed on a sample', () => {
    const overrides = [];
    for (let i = 0; i < 800; i++) {
      overrides.push({
        id: i,
        client_full_name: `Client ${i} Smith`,
        carrier: i % 2 ? 'Humana' : 'Aetna',
        commission: 10,
        classification: 'Agency Override',
      });
    }
    overrides.push(...houseRows);
    const index = buildNameIndex(overrides);
    const unindexed = findOverrideMatch(prod(), overrides);
    const indexed = findOverrideMatch(prod(), overrides, index);
    expect(indexed.override_net).toBe(unindexed.override_net);
    expect(indexed.matchCount).toBe(2);
  });

  test('held_licensing works from slim hold_reason (no raw_data)', () => {
    const m = {
      production: { id: 3, client_name: 'Held Client', carrier: 'Humana', status: 'Active' },
      override: null,
      carrierBSI: { commission: 0, classification: 'Held', hold_reason: 'Not licensed in FL', member_state: 'FL' },
      carrierUploaded: true,
      lifecycle: 'missing',
    };
    expect(getThreeWayOverrideStatus(m)).toBe('held_licensing');
    expect(getHoldDetail(m)).toEqual({
      reason: 'Not licensed in FL',
      state: 'FL',
      county: null,
    });
  });
});

describe('assembleOverrideRecon', () => {
  test('paginates slim rows and keeps Paid/Not paid netting', () => {
    const production = [
      prod(),
      {
        id: 2,
        client_name: 'Jane Doe',
        carrier: 'Aetna',
        agent_name: 'Katy',
        status: 'Active',
        effective_date: '2026-02-01',
      },
    ];
    const overrides = [
      ...houseRows,
      {
        id: 20,
        client_full_name: 'Jane Doe',
        carrier: 'Aetna',
        commission: 150,
        classification: 'Agency Override',
      },
    ];
    const bsi = [
      {
        id: 30,
        client_full_name: 'Jane Doe',
        carrier: 'Aetna',
        commission: 200,
        classification: 'New Business',
        payment_period: '202602',
      },
    ];

    const page = assembleOverrideRecon(production, overrides, bsi, new Set(['aetna|202602']), {
      category: 'all',
      limit: 10,
      offset: 0,
    });

    expect(page.rows.every((r) => r.production && !r.production.raw_data)).toBe(true);
    expect(page.rows.every((r) => !r.override || r.override.allMatches == null)).toBe(true);
    expect(page.counts.paid).toBeGreaterThanOrEqual(1);
    expect(page.counts.cancelled).toBeGreaterThanOrEqual(1);
    expect(page.counts.missing).toBeGreaterThanOrEqual(1);

    const milagrosMissing = page.rows.find(
      (r) => r.production.client_name.includes('Milagros') && r.lifecycle === 'missing'
    );
    expect(milagrosMissing).toBeTruthy();
    expect(milagrosMissing.override.override_net).toBe(0);
    expect(milagrosMissing.status).not.toBe('paid');

    const janePaid = page.rows.find(
      (r) => r.production.client_name === 'Jane Doe' && r.category === 'paid'
    );
    expect(janePaid).toBeTruthy();
    expect(janePaid.status).toBe('paid');
  });

  test('category + offset slice does not download the whole set', () => {
    const production = [];
    const overrides = [];
    for (let i = 0; i < 25; i++) {
      production.push({
        id: i + 1,
        client_name: `Client Number${i} Smith`,
        carrier: 'Humana',
        agent_name: 'Katy',
        status: 'Active',
        effective_date: '2026-03-01',
        policy_number: `POL${i}`,
      });
    }
    const page = assembleOverrideRecon(production, overrides, [], new Set(), {
      category: 'missing',
      limit: 10,
      offset: 10,
    });
    expect(page.total).toBe(25);
    expect(page.rows).toHaveLength(10);
    expect(page.counts.missing).toBe(25);
    expect(page.offset).toBe(10);
  });

  test('search and override_status filters apply after matching', () => {
    const production = [
      prod({ agent_name: 'Alba' }),
      {
        id: 2,
        client_name: 'Jane Doe',
        carrier: 'Aetna',
        agent_name: 'Katy',
        status: 'Active',
        effective_date: '2026-02-01',
      },
    ];
    const overrides = [
      {
        id: 20,
        client_full_name: 'Jane Doe',
        carrier: 'Aetna',
        commission: 150,
        classification: 'Agency Override',
      },
    ];
    const page = assembleOverrideRecon(production, overrides, [], new Set(), {
      category: 'all',
      search: 'jane',
      limit: 50,
    });
    expect(page.rows.every((r) => r.production.client_name.toLowerCase().includes('jane'))).toBe(true);
    expect(page.counts.paid).toBeGreaterThanOrEqual(1);
    expect(page.counts.missing).toBe(0);
  });

  test('pg Date objects normalize so sale keys stay YYYY-MM-DD', () => {
    const production = [
      prod({
        effective_date: new Date(Date.UTC(2026, 0, 1)),
        upload_date: new Date(Date.UTC(2026, 5, 1)),
      }),
    ];
    const page = assembleOverrideRecon(production, houseRows, [], new Set(), {
      category: 'all',
      limit: 20,
    });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((r) => r.production.effective_date === '2026-01-01')).toBe(true);
    expect(page.counts.missing).toBe(1);
  });

  test('buildOverrideMatches still expands returnee lifecycle', () => {
    const rows = buildOverrideMatches([prod()], houseRows, [], new Set());
    expect(rows.map((r) => r.lifecycle).sort()).toEqual(['chargeback', 'missing', 'paid']);
  });
});

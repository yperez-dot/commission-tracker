'use strict';

const {
  normalizeReconPeriod,
  periodBatchVariants,
  periodDateBounds,
  collectReconPeriods,
  formatReconPeriodLabel,
  isSelectedPeriodSale,
  keepPeriodScopedMatch,
  stampProductionForPeriod,
  appendPaymentPeriodSql,
  appendProductionPeriodSql,
  corpusCacheKey,
} = require('../overrideReconPeriod');
const { assembleOverrideRecon } = require('../overrideReconAssemble');

describe('normalizeReconPeriod', () => {
  test('accepts YYYYMM and YYYY-MM and ISO dates', () => {
    expect(normalizeReconPeriod('202603')).toBe('202603');
    expect(normalizeReconPeriod('2026-03')).toBe('202603');
    expect(normalizeReconPeriod('2026-03-15')).toBe('202603');
    expect(normalizeReconPeriod('2026-03-01T00:00:00.000Z')).toBe('202603');
  });

  test('rejects invalid months and empty values', () => {
    expect(normalizeReconPeriod('')).toBe('');
    expect(normalizeReconPeriod(null)).toBe('');
    expect(normalizeReconPeriod('202613')).toBe('');
    expect(normalizeReconPeriod('Unknown')).toBe('');
    expect(normalizeReconPeriod('all')).toBe('');
  });
});

describe('period SQL helpers', () => {
  test('batch variants cover production YYYY-MM and commission YYYYMM', () => {
    expect(periodBatchVariants('202603')).toEqual(['202603', '2026-03']);
  });

  test('date bounds are a half-open month so effective_date can use the btree', () => {
    expect(periodDateBounds('202603')).toEqual({ start: '2026-03-01', endExclusive: '2026-04-01' });
    expect(periodDateBounds('202612')).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01' });
  });

  test('appendPaymentPeriodSql is sargable equality, not unbounded ILIKE', () => {
    const conds = [];
    const params = [];
    appendPaymentPeriodSql(conds, params, '2026-03');
    expect(conds).toEqual(['cr.payment_period = ANY($1)']);
    expect(params).toEqual([['202603', '2026-03']]);
  });

  test('appendProductionPeriodSql uses batch ANY + effective_date range', () => {
    const conds = [];
    const params = [];
    appendProductionPeriodSql(conds, params, '202603');
    expect(conds[0]).toContain('ap.upload_batch = ANY($1)');
    expect(conds[0]).toContain('ap.effective_date >= $2::date');
    expect(conds[0]).toContain('ap.effective_date < $3::date');
    expect(params).toEqual([['202603', '2026-03'], '2026-03-01', '2026-04-01']);
  });

  test('SQL helpers refuse to run without a period', () => {
    expect(() => appendPaymentPeriodSql([], [], '')).toThrow(/period/i);
    expect(() => appendProductionPeriodSql([], [], null)).toThrow(/period/i);
  });
});

describe('period picker + sale membership', () => {
  test('collectReconPeriods normalizes mixed batch formats', () => {
    expect(collectReconPeriods([
      { upload_batch: '2026-03' },
      { payment_period: '202602' },
      { period: '2026-02' },
      { payment_period: 'Unknown' },
    ])).toEqual(['202603', '202602']);
  });

  test('formatReconPeriodLabel', () => {
    expect(formatReconPeriodLabel('202603')).toBe('Mar 2026');
    expect(formatReconPeriodLabel('2026-01')).toBe('Jan 2026');
  });

  test('isSelectedPeriodSale uses effective_date month or batch when date is missing', () => {
    expect(isSelectedPeriodSale({ effective_date: '2026-03-01', upload_batch: '2026-04' }, '202603')).toBe(true);
    expect(isSelectedPeriodSale({ effective_date: '2026-01-01', upload_batch: '2026-03' }, '202603')).toBe(false);
    expect(isSelectedPeriodSale({ upload_batch: '2026-03' }, '202603')).toBe(true);
  });
});

describe('keepPeriodScopedMatch', () => {
  const marchSale = { production: { effective_date: '2026-03-01', upload_batch: '2026-03' } };
  const janInMarchFile = { production: { effective_date: '2026-01-01', upload_batch: '2026-03' } };

  test('keeps this-period new sales that are still Missing', () => {
    expect(keepPeriodScopedMatch({ ...marchSale, lifecycle: 'missing' }, '202603')).toBe(true);
  });

  test('drops 90-day leftovers with no remittance activity this period', () => {
    expect(keepPeriodScopedMatch({ ...janInMarchFile, lifecycle: 'missing' }, '202603')).toBe(false);
  });

  test('keeps older sales that have this period\'s override or BSI/held activity', () => {
    expect(keepPeriodScopedMatch({
      ...janInMarchFile,
      override: { payment_period: '202603', commission: -80 },
      lifecycle: 'chargeback',
    }, '202603')).toBe(true);
    expect(keepPeriodScopedMatch({
      ...janInMarchFile,
      carrierBSI: { payment_period: '202603', hold_reason: 'Not licensed' },
      lifecycle: 'missing',
    }, '202603')).toBe(true);
  });
});

describe('assembleOverrideRecon period scope', () => {
  test('stamps production payment_period so BSI keys use the selected month', () => {
    const stamped = stampProductionForPeriod(
      [{ id: 1, client_name: 'Jane Doe', carrier: 'Aetna', effective_date: '2026-01-01' }],
      '202603'
    );
    expect(stamped[0].payment_period).toBe('202603');
  });

  test('period filter keeps Paid/Missing/Cancelled for that month and drops leftover Missing', () => {
    const production = [
      {
        id: 1,
        client_name: 'March New',
        carrier: 'Aetna',
        agent_name: 'Katy',
        status: 'Active',
        effective_date: '2026-03-01',
        upload_batch: '2026-03',
      },
      {
        id: 2,
        client_name: 'January Leftover',
        carrier: 'Humana',
        agent_name: 'Katy',
        status: 'Active',
        effective_date: '2026-01-01',
        upload_batch: '2026-03',
      },
      {
        id: 3,
        client_name: 'Jane Doe',
        carrier: 'Aetna',
        agent_name: 'Katy',
        status: 'Active',
        effective_date: '2026-02-01',
        upload_batch: '2026-03',
      },
    ];
    const overrides = [
      {
        id: 20,
        client_full_name: 'Jane Doe',
        carrier: 'Aetna',
        commission: 150,
        classification: 'Agency Override',
        payment_period: '202603',
      },
    ];

    const page = assembleOverrideRecon(production, overrides, [], new Set(['aetna|202603']), {
      period: '202603',
      category: 'all',
      limit: 50,
    });

    const names = page.rows.map((r) => r.production.client_name).sort();
    expect(names).toContain('March New');
    expect(names).toContain('Jane Doe');
    expect(names).not.toContain('January Leftover');
    expect(page.period).toBe('202603');
    expect(page.counts.missing).toBeGreaterThanOrEqual(1);
    expect(page.counts.paid).toBeGreaterThanOrEqual(1);
    expect(page.rows.find((r) => r.production.client_name === 'Jane Doe').status).toBe('paid');
    expect(page.rows.find((r) => r.production.client_name === 'March New').status).not.toBe('paid');
  });

  test('same-period clawback still nets to Missing, not Paid', () => {
    const production = [{
      id: 1,
      client_name: 'Milagros Cambas De Rivas',
      carrier: 'Aetna',
      agent_name: 'Hernandez, Alba',
      status: 'Active',
      effective_date: '2026-03-01',
      upload_batch: '2026-03',
    }];
    const overrides = [
      {
        id: 10,
        client_full_name: 'CAMBAS DE RIVAS, MILAGROS',
        carrier: 'Aetna',
        commission: 80,
        classification: 'Agency Override',
        payment_period: '202603',
      },
      {
        id: 11,
        client_full_name: 'Milagros Cambas De Rivas',
        carrier: 'Aetna',
        commission: -80,
        classification: 'Agency Override Chargeback',
        payment_period: '202603',
      },
    ];
    const page = assembleOverrideRecon(production, overrides, [], new Set(), {
      period: '202603',
      category: 'all',
      limit: 20,
    });
    const missing = page.rows.find((r) => r.lifecycle === 'missing');
    expect(missing).toBeTruthy();
    expect(missing.override.override_net).toBe(0);
    expect(missing.status).not.toBe('paid');
    expect(page.counts.paid).toBeGreaterThanOrEqual(1);
    expect(page.counts.cancelled).toBeGreaterThanOrEqual(1);
    expect(page.counts.missing).toBeGreaterThanOrEqual(1);
  });

  test('corpus cache key is period-first', () => {
    expect(corpusCacheKey({ period: '2026-03', batch: '', carrier: '', agent: '' })).toBe('202603|||');
  });
});

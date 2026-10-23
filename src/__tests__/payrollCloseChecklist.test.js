const { buildCloseChecklist, canonicalCarrier, carriersInText, previousPeriods } = require('../payrollCloseChecklist');

const up = (o) => Object.assign({ id: 1, original_name: 'x.xlsx', display_title: '', carrier: 'UnitedHealthcare', record_count: 10, total: 100 }, o);
const allFive = () => [
  up({ id: 1, display_title: 'BSI · UHC · 09-2026', carrier: 'UnitedHealthcare' }),
  up({ id: 2, display_title: 'BSI · Humana · 09-2026', carrier: 'Humana' }),
  up({ id: 3, display_title: 'BSI · Devoted · 09-2026', carrier: 'Devoted' }),
  up({ id: 4, display_title: 'BSI · Aetna · 09-2026', carrier: 'Aetna' }),
  up({ id: 5, display_title: 'BSI · Freedom · 09-2026', carrier: 'Freedom' }),
];

describe('close checklist', () => {
  test('carrier names normalize', () => {
    expect(canonicalCarrier('UHC')).toBe('UnitedHealthcare');
    expect(canonicalCarrier('UnitedHealthcare Med Adv')).toBe('UnitedHealthcare');
    expect(carriersInText('BSI_AETNA_09.2026.xlsx')).toEqual(['Aetna']);
    expect(previousPeriods('202602', 3)).toEqual(['202601', '202512', '202511']);
  });

  test('all five carriers present -> can close', () => {
    const c = buildCloseChecklist({ period: '202609', uploads: allFive() });
    expect(c.canClose).toBe(true);
    expect(c.blockers).toEqual([]);
  });

  test('missing carrier blocks close', () => {
    const c = buildCloseChecklist({ period: '202609', uploads: allFive().slice(0, 4) });
    expect(c.canClose).toBe(false);
    expect(c.blockers.map((b) => b.carrier)).toEqual(['Freedom']);
  });

  test('"none this month" clears the blocker', () => {
    const c = buildCloseChecklist({
      period: '202609', uploads: allFive().slice(0, 4),
      nones: [{ carrier: 'Freedom', reason: 'No Freedom business this month' }],
    });
    expect(c.canClose).toBe(true);
    expect(c.carriers.find((x) => x.carrier === 'Freedom').status).toBe('none_this_month');
  });

  test('carrier seen in the last 3 months becomes expected', () => {
    const c = buildCloseChecklist({ period: '202609', uploads: allFive(), recentCarriers: ['Wellcare'] });
    expect(c.expectedCarriers).toContain('Wellcare');
    expect(c.canClose).toBe(false);
  });

  test('flags $0 total with records', () => {
    const ups = allFive();
    ups[1] = up({ id: 2, display_title: 'BSI · Humana · 09-2026', carrier: 'Humana', record_count: 21, total: 0 });
    const c = buildCloseChecklist({ period: '202609', uploads: ups });
    expect(c.warnings.map((w) => w.type)).toContain('zero_total');
    expect(c.carriers.find((x) => x.carrier === 'Humana').flags.zeroTotal).toBe(true);
  });

  test('flags an Aetna file stored as UnitedHealthcare', () => {
    const ups = allFive();
    ups[3] = up({ id: 4, original_name: 'BSI AETNA 09.2026.xlsx', display_title: 'BSI · Aetna · 09-2026', carrier: 'UnitedHealthcare', total: 0 });
    const c = buildCloseChecklist({ period: '202609', uploads: ups });
    const types = c.warnings.map((w) => w.type);
    expect(types).toContain('carrier_mismatch');
    expect(types).toContain('zero_total');
    // stored as UHC, so Aetna is missing
    expect(c.blockers.map((b) => b.carrier)).toEqual(['Aetna']);
  });

  test('auto title copied from the wrong stored carrier still flags via filename', () => {
    const ups = allFive();
    ups[3] = up({ id: 4, original_name: 'BSI AETNA 09.2026.xlsx', display_title: 'BSI · UHC · 09-2026', carrier: 'UnitedHealthcare' });
    const c = buildCloseChecklist({ period: '202609', uploads: ups });
    expect(c.uploads.find((u) => u.id === 4).flags.carrierMismatch).toBe(true);
    expect(c.uploads.find((u) => u.id === 1).flags.carrierMismatch).toBe(false);
  });

  test('deposit differences are warnings, never blockers', () => {
    const c = buildCloseChecklist({
      period: '202609', uploads: allFive(),
      depositWarnings: [{ payer: 'BSI', expected: 100, received: 80, difference: -20 }],
    });
    expect(c.canClose).toBe(true);
    expect(c.warnings.some((w) => w.type === 'deposit_difference')).toBe(true);
  });

  test('rows missing a stored THEI share show as a warning, not a blocker', () => {
    const c = buildCloseChecklist({ period: '202609', uploads: allFive(), missingShareWarnings: [{ payer: 'BSI', rows: 2 }] });
    expect(c.canClose).toBe(true);
    expect(c.warnings.find((w) => w.type === 'missing_thei_share').message).toMatch(/2 row/);
  });
});

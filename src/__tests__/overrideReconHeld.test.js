const { loadHeldLicensingRecon } = require('../overrideReconHeld');

function pool() {
  return { query: jest.fn(async () => ({ rows: [{ rows: [], held_total: '7', held_scanned: '9',
    meta: { agents: [], carriers: ['Aetna'], effectiveDates: [], batches: [] } }] })) };
}

test('all-period SQL caps pages/export and keeps total on an empty later page', async () => {
  const db = pool();
  const result = await loadHeldLicensingRecon(db, { limit: 99999, offset: 900 });
  expect(result.limit).toBe(500);
  expect(result.total).toBe(7);
  expect(result.rows).toEqual([]);
  expect(db.query.mock.calls[0][1]).toEqual([500, 900]);
  expect((await loadHeldLicensingRecon(db, { export: '1', limit: 99999 })).limit).toBe(20000);
  expect((await loadHeldLicensingRecon(db, { limit: -1, offset: -1 })).limit).toBe(1);
});

test('filters are bound in SQL and invalid sort input cannot enter SQL', async () => {
  const db = pool();
  await loadHeldLicensingRecon(db, { agents: 'Katy', carriers: 'Aetna', search: "O'Brien", effective_dates: '2026-03-01', sortCol: 'id; DROP TABLE uploads', sortDir: 'DESC; DROP TABLE uploads' });
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).not.toContain('DROP TABLE');
  expect(sql).not.toContain("O'Brien");
  expect(params).toEqual([['Katy'], ['aetna'], ['2026-03-01'], "%O'Brien%", 100, 0]);
  expect(sql).toContain('SELECT * FROM candidates WHERE');
});

test('other categories and statuses cannot widen the Held queue', async () => {
  const db = pool();
  const result = await loadHeldLicensingRecon(db, { category: 'paid', override_status: 'paid' });
  expect(result.total).toBe(0);
  expect(db.query.mock.calls[0][0]).toContain('SELECT * FROM candidates WHERE FALSE');
  expect(db.query.mock.calls[0][0]).toContain('SELECT * FROM filtered WHERE FALSE');
});

test('database errors propagate to the route error handler', async () => {
  await expect(loadHeldLicensingRecon({ query: async () => { throw new Error('query failed'); } })).rejects.toThrow('query failed');
});

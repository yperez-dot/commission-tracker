'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-override-recon-period';

const recorded = [];

jest.mock('../../db/database', () => ({
  getPool: () => ({
    query: jest.fn(async (sql, params = []) => {
      recorded.push({ sql: String(sql), params });
      if (/api_keys/.test(sql)) return { rows: [] };
      if (/DISTINCT upload_batch/.test(sql)) {
        return { rows: [{ period: '2026-03' }, { period: '202602' }] };
      }
      if (/FROM agency_production ap/.test(sql)) {
        return {
          rows: [{
            id: 1,
            agent_name: 'Katy',
            client_name: 'March New',
            carrier: 'Aetna',
            effective_date: '2026-03-01',
            upload_batch: '2026-03',
            status: 'Active',
          }],
        };
      }
      return { rows: [] };
    }),
  }),
}));

const jwt = require('jsonwebtoken');
const { clearOverrideReconCorpusCache } = require('../overrideReconPeriod');
const router = require('../../routes/agencyproduction');

function authHeader() {
  return `Bearer ${jwt.sign(
    { id: 1, name: 'Katy', email: 'katy@test.com', role: 'admin', agency: 'thei' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  )}`;
}

function invoke(pathAndQuery) {
  const url = new URL(pathAndQuery, 'http://local.test');
  const query = {};
  url.searchParams.forEach((value, key) => { query[key] = value; });
  const req = {
    method: 'GET',
    url: url.pathname + url.search,
    path: url.pathname,
    query,
    params: {},
    headers: { authorization: authHeader() },
    get(name) { return this.headers[String(name).toLowerCase()]; },
  };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        this.body = payload;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      setHeader() { return this; },
      end(payload) {
        this.body = payload;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };
    router.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

function corpusSql() {
  return recorded.filter((q) =>
    /FROM agency_production ap/.test(q.sql) ||
    /classification ILIKE '%override%'/.test(q.sql) ||
    /u\.category = 'bsi_statement'/.test(q.sql)
  );
}

describe('GET /override-recon period gate', () => {
  beforeEach(() => {
    recorded.length = 0;
    clearOverrideReconCorpusCache();
  });

  test('without period: periods only, no unbounded triple query', async () => {
    const { status, body } = await invoke('/override-recon');
    expect(status).toBe(200);
    expect(body.needsPeriod).toBe(true);
    expect(body.rows).toEqual([]);
    expect(body.defaultPeriod).toBe('202603');
    expect(corpusSql()).toHaveLength(0);
  });

  test('with period: every corpus query is period-scoped', async () => {
    const t0 = Date.now();
    const { status, body } = await invoke('/override-recon?period=202603&category=missing&limit=100');
    const ms = Date.now() - t0;
    expect(status).toBe(200);
    expect(body.needsPeriod).toBe(false);
    expect(body.period).toBe('202603');
    expect(body.scanned.production).toBe(1);

    const corpus = corpusSql();
    expect(corpus.length).toBeGreaterThanOrEqual(3);
    corpus.forEach((q) => {
      const sql = q.sql.replace(/\s+/g, ' ');
      const hasPeriod =
        sql.includes('payment_period = ANY') ||
        sql.includes('upload_batch = ANY') ||
        sql.includes('effective_date >=');
      expect(hasPeriod).toBe(true);
      expect(sql).not.toMatch(/LEFT JOIN LATERAL/);
    });
    expect(ms).toBeLessThan(5000);
  });

  test('second page hits cache and does not re-run the triple query', async () => {
    await invoke('/override-recon?period=202603&category=missing&limit=100');
    const afterFirst = corpusSql().length;
    expect(afterFirst).toBeGreaterThanOrEqual(3);
    await invoke('/override-recon?period=202603&category=paid&limit=100');
    expect(corpusSql().length).toBe(afterFirst);
  });
});

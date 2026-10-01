'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-override-recon-period';

const recorded = [];

jest.mock('../../db/database', () => ({
  getPool: () => ({
    query: jest.fn(async (sql, params = []) => {
      recorded.push({ sql: String(sql), params });
      if (/WITH held AS MATERIALIZED/.test(sql)) {
        return { rows: [{ rows: [
          { id: 91, classification: 'Held', hold_reason: 'not licensed', member_state: 'AL', payment_period: '202601', client_full_name: 'Alabama Member', carrier: 'Aetna' },
          { id: 92, classification: 'Held', hold_reason: 'not appointed', member_state: 'KS', payment_period: '202603', client_full_name: 'Kansas Member', carrier: 'Aetna' },
        ], held_total: 2, held_scanned: 2, meta: { agents: [], carriers: ['Aetna'], effectiveDates: [], batches: [] } }] };
      }
      if (/api_keys/.test(sql)) return { rows: [] };
      if (/DISTINCT upload_batch/.test(sql) || /DISTINCT payment_period/.test(sql)) {
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

  test('never selects payment_period from uploads (column does not exist)', async () => {
    await invoke('/override-recon/periods');
    await invoke('/override-recon?period=202603&category=missing&limit=100');
    const bad = recorded.filter((q) =>
      /FROM\s+uploads\b/i.test(q.sql) &&
      /payment_period/i.test(q.sql) &&
      !/JOIN\s+commission_records/i.test(q.sql) &&
      !/commission_records\s+cr/i.test(q.sql)
    );
    // Allow JOIN forms that read cr.payment_period while selecting from uploads.
    const bareUploadsPaymentPeriod = recorded.filter((q) => {
      const sql = q.sql.replace(/\s+/g, ' ');
      return (
        /FROM uploads(?!\s+\w*\s+JOIN)/i.test(sql) === false
          ? /SELECT[^;]*payment_period[^;]*FROM uploads\b/i.test(sql) &&
            !/JOIN commission_records/i.test(sql)
          : false
      ) || (
        /SELECT\s+carrier,\s*payment_period\s+FROM\s+uploads\b/i.test(sql)
      ) || (
        /SELECT\s+DISTINCT\s+payment_period\s+FROM\s+uploads\b/i.test(sql)
      );
    });
    expect(bareUploadsPaymentPeriod).toEqual([]);
  });
});

// The all-period route must never call the single-period corpus matcher.
describe('dedicated all-period Held–Licensing route', () => {
  beforeEach(() => { recorded.length = 0; clearOverrideReconCorpusCache(); });
  test('only queries Held licensing SQL, with SQL paging and states across periods', async () => {
    const { status, body } = await invoke('/override-recon/held-licensing?period=all&override_status=held_licensing&limit=100');
    expect(status).toBe(200);
    expect(body.period).toBe('all');
    expect(body.rows.map((r) => r.memberState)).toEqual(['AL', 'KS']);
    expect(body.rows.map((r) => r.carrierBSI.payment_period)).toEqual(['202601', '202603']);
    expect(body.rows.every((r) => r.status === 'held_licensing')).toBe(true);
    expect(body.rows.every((r) => !r.carrierBSI.raw_data)).toBe(true);
    const queries = recorded.filter((q) => !/api_keys/.test(q.sql));
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("u.category = 'bsi_statement' AND cr.classification = 'Held'");
    expect(queries[0].sql).toContain("ILIKE '%not licensed%'");
    expect(queries[0].sql).toContain("ILIKE '%not appointed%'");
    expect(queries[0].sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    expect(queries[0].params).toEqual([100, 0]);
    expect(queries[0].sql).not.toContain("classification ILIKE '%override%'");
    expect(queries[0].sql).not.toContain('buildOverrideMatches');
  });
  test('period=all on the old route cannot bypass the period gate', async () => {
    const { body } = await invoke('/override-recon?period=all');
    expect(body.needsPeriod).toBe(true);
    expect(corpusSql()).toHaveLength(0);
  });
});

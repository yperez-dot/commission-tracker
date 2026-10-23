/**
 * @jest-environment node
 */
'use strict';

const crypto = require('crypto');

process.env.JWT_SECRET = 'test-only-jwt-secret-for-auth-mfa-suite-0123456789';
process.env.TOTP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
delete process.env.OLICOMM_API_KEY;

// ─── In-memory stand-in for the users / backup codes / auth_events tables ────
const mockDb = { users: [], codes: [], events: [], nextCode: 1, apiKeys: [] };

function mockHandle(sql, p = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const user = (id) => mockDb.users.find((u) => u.id === Number(id));
  if (/^(ALTER TABLE|CREATE (TABLE|INDEX))/.test(s) || /^(BEGIN|COMMIT|ROLLBACK)$/.test(s) || /pg_advisory_xact_lock/.test(s)) return { rows: [] };
  if (/FROM api_keys/.test(s)) return { rows: mockDb.apiKeys.filter((k) => k.key_hash === p[0]) };
  if (/FROM users WHERE email = \$1/.test(s)) return { rows: mockDb.users.filter((u) => u.email === p[0]).map((u) => ({ ...u })) };
  if (/FROM users WHERE id = \$1/.test(s)) { const u = user(p[0]); return { rows: u ? [{ ...u }] : [] }; }
  if (/^UPDATE users SET totp_pending_secret_enc = \$2/.test(s)) { user(p[0]).totp_pending_secret_enc = p[1]; return { rows: [] }; }
  if (/SET totp_secret_enc = \$2, totp_pending_secret_enc = NULL/.test(s)) {
    const u = user(p[0]);
    if (!u || u.totp_enabled_at) return { rows: [] };
    Object.assign(u, { totp_secret_enc: p[1], totp_pending_secret_enc: null, totp_enabled_at: new Date(), totp_last_step: p[2] });
    return { rows: [{ id: u.id }] };
  }
  if (/^UPDATE users SET totp_last_step = \$2/.test(s)) {
    const u = user(p[0]);
    if (u && (u.totp_last_step == null || u.totp_last_step < p[1])) { u.totp_last_step = p[1]; return { rows: [{ id: u.id }] }; }
    return { rows: [] };
  }
  if (/SET totp_secret_enc = NULL/.test(s)) {
    const u = user(p[0]);
    if (!u) return { rows: [] };
    Object.assign(u, { totp_secret_enc: null, totp_pending_secret_enc: null, totp_enabled_at: null, totp_last_step: null, session_version: (u.session_version || 0) + 1 });
    return { rows: [{ id: u.id }] };
  }
  if (/^UPDATE users SET session_version/.test(s)) { const u = user(p[0]); u.session_version += 1; return { rows: [] }; }
  if (/^UPDATE users SET password_hash = \$1 WHERE id = \$2/.test(s)) { const u = user(p[1]); if (u) u.password_hash = p[0]; return { rows: [] }; }
  if (/^DELETE FROM user_backup_codes/.test(s)) { mockDb.codes = mockDb.codes.filter((c) => c.user_id !== p[0]); return { rows: [] }; }
  if (/^INSERT INTO user_backup_codes/.test(s)) { mockDb.codes.push({ id: mockDb.nextCode++, user_id: p[0], code_hash: p[1], used_at: null }); return { rows: [] }; }
  if (/^SELECT id, code_hash FROM user_backup_codes/.test(s)) return { rows: mockDb.codes.filter((c) => c.user_id === p[0] && !c.used_at) };
  if (/^UPDATE user_backup_codes SET used_at/.test(s)) {
    const c = mockDb.codes.find((x) => x.id === p[0] && !x.used_at);
    if (!c) return { rows: [] };
    c.used_at = new Date();
    return { rows: [{ id: c.id }] };
  }
  if (/COUNT\(\*\)::int AS n FROM user_backup_codes/.test(s)) return { rows: [{ n: mockDb.codes.filter((c) => c.user_id === p[0] && !c.used_at).length }] };
  if (/^INSERT INTO auth_events/.test(s)) { mockDb.events.push({ event_type: p[0], user_id: p[1], actor_user_id: p[2], email: p[3], detail: p[6] && JSON.parse(p[6]) }); return { rows: [] }; }
  if (/FROM auth_events e/.test(s)) return { rows: mockDb.events.slice().reverse() };
  if (/FROM users ORDER BY created_at DESC/.test(s)) return { rows: mockDb.users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, mfa_enabled: !!u.totp_enabled_at })) };
  throw new Error(`unexpected SQL in test: ${s.slice(0, 80)}`);
}

jest.mock('../../db/database', () => ({
  getPool: () => ({
    query: async (sql, params) => mockHandle(sql, params),
    connect: async () => ({ query: async (sql, params) => mockHandle(sql, params), release: () => {} }),
  }),
}));

const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authRouter = require('../../routes/auth');
const { requireAuth, requireAdmin } = authRouter;
const { currentCode } = require('../totp');
const { decryptSecret } = require('../authCrypto');
const { sha256hex } = require('../serviceAuth');

const PASSWORD = 'correct horse battery staple';
const PW_HASH = bcrypt.hashSync(PASSWORD, 4);

function seedUsers() {
  mockDb.users = [
    { id: 1, name: 'Admin One', email: 'admin1@example.test', password_hash: PW_HASH, role: 'admin', agency: '', session_version: 0, totp_secret_enc: null, totp_pending_secret_enc: null, totp_enabled_at: null, totp_last_step: null },
    { id: 2, name: 'Admin Two', email: 'admin2@example.test', password_hash: PW_HASH, role: 'admin', agency: '', session_version: 0, totp_secret_enc: null, totp_pending_secret_enc: null, totp_enabled_at: null, totp_last_step: null },
    { id: 3, name: 'Agent Three', email: 'agent3@example.test', password_hash: PW_HASH, role: 'agent', agency: '', session_version: 0, totp_secret_enc: null, totp_pending_secret_enc: null, totp_enabled_at: null, totp_last_step: null },
  ];
  mockDb.codes = [];
  mockDb.events = [];
  mockDb.apiKeys = [];
}

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.get('/api/data', requireAuth, (req, res) => res.json({ ok: true, who: req.user.email, authType: req.user.authType || null }));
  app.get('/api/admin-data', requireAuth, requireAdmin, (req, res) => res.json({ ok: true }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  seedUsers();
  Object.values(authRouter._limiters).forEach((l) => l.clearAll());
});

function call(method, path, { body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`${base}${path}`, {
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const post = (path, body, opts = {}) => call('POST', path, { body, ...opts });

async function passwordStep(email, password = PASSWORD, headers) {
  return post('/api/auth/login', { email, password }, { headers });
}

/** Full enrollment for a user; returns { token, secret, backupCodes }. */
async function enroll(email) {
  const login = await passwordStep(email);
  expect(login.status).toBe(200);
  expect(login.body.mfaEnrollRequired).toBe(true);
  const start = await post('/api/auth/mfa/enroll/start', { mfaToken: login.body.mfaToken });
  expect(start.status).toBe(200);
  const u = mockDb.users.find((x) => x.email === email);
  const secret = decryptSecret(u.totp_pending_secret_enc);
  const confirm = await post('/api/auth/mfa/enroll/confirm', { mfaToken: login.body.mfaToken, code: currentCode(secret) });
  expect(confirm.status).toBe(200);
  return { token: confirm.body.token, secret, backupCodes: confirm.body.backupCodes };
}

describe('password step', () => {
  test('returns only an mfa-pending token, never a session', async () => {
    const r = await passwordStep('admin1@example.test');
    expect(r.status).toBe(200);
    expect(r.body.token).toBeUndefined();
    expect(r.body.mfaRequired).toBe(true);
    const claims = jwt.decode(r.body.mfaToken);
    expect(claims.typ).toBe('mfa_pending');
    expect(claims.exp - claims.iat).toBe(300);
  });

  test('wrong password and unknown email give the same error (no enumeration)', async () => {
    const a = await passwordStep('admin1@example.test', 'wrong password here');
    const b = await passwordStep('nobody@example.test', 'wrong password here');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(mockDb.events.filter((e) => e.event_type === 'login_failed')).toHaveLength(2);
  });

  test('fails closed when TOTP_ENCRYPTION_KEY is missing', async () => {
    const saved = process.env.TOTP_ENCRYPTION_KEY;
    delete process.env.TOTP_ENCRYPTION_KEY;
    try {
      const r = await passwordStep('admin1@example.test');
      expect(r.status).toBe(503);
      expect(r.body.mfaToken).toBeUndefined();
      expect(r.body.token).toBeUndefined();
    } finally {
      process.env.TOTP_ENCRYPTION_KEY = saved;
    }
  });
});

describe('mfa-pending token', () => {
  test('cannot access protected data or admin routes', async () => {
    const r = await passwordStep('admin1@example.test');
    const pending = r.body.mfaToken;
    expect((await call('GET', '/api/data', { token: pending })).status).toBe(401);
    expect((await call('GET', '/api/admin-data', { token: pending })).status).toBe(401);
    expect((await call('GET', '/api/auth/me', { token: pending })).status).toBe(401);
    expect((await call('GET', '/api/auth/users', { token: pending })).status).toBe(401);
  });

  test('old pre-2FA style tokens (no mfa claim) are rejected', async () => {
    const legacy = jwt.sign({ id: 1, email: 'admin1@example.test', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    expect((await call('GET', '/api/data', { token: legacy })).status).toBe(401);
  });

  test('expired pending token is refused', async () => {
    const expired = jwt.sign({ uid: 1, typ: 'mfa_pending', purpose: 'enroll', sv: 0 }, process.env.JWT_SECRET,
      { expiresIn: -10, audience: 'olicomm-mfa', issuer: 'olicomm' });
    const r = await post('/api/auth/mfa/enroll/start', { mfaToken: expired });
    expect(r.status).toBe(401);
  });

  test('an access token cannot be used as a pending token', async () => {
    const { token } = await enroll('admin1@example.test');
    const r = await post('/api/auth/mfa/verify', { mfaToken: token, code: '123456' });
    expect(r.status).toBe(401);
  });
});

describe('forced enrollment', () => {
  test('user without 2FA must enroll; session only after confirming a code; 10 backup codes once', async () => {
    const login = await passwordStep('admin1@example.test');
    expect(login.body.mfaEnrollRequired).toBe(true);
    // Can't skip to verify.
    expect((await post('/api/auth/mfa/verify', { mfaToken: login.body.mfaToken, code: '000000' })).status).toBe(409);

    const start = await post('/api/auth/mfa/enroll/start', { mfaToken: login.body.mfaToken });
    expect(start.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(start.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/OliComm:/);
    const u = mockDb.users[0];
    expect(u.totp_pending_secret_enc).toMatch(/^v1:/); // encrypted at rest
    expect(u.totp_pending_secret_enc).not.toContain(start.body.manualKey.replace(/\s/g, ''));

    const bad = await post('/api/auth/mfa/enroll/confirm', { mfaToken: login.body.mfaToken, code: '000000' });
    expect(bad.status).toBe(401);
    expect(u.totp_enabled_at).toBeNull();

    const secret = decryptSecret(u.totp_pending_secret_enc);
    const ok = await post('/api/auth/mfa/enroll/confirm', { mfaToken: login.body.mfaToken, code: currentCode(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.backupCodes).toHaveLength(10);
    expect(new Set(ok.body.backupCodes).size).toBe(10);
    expect(mockDb.codes.every((c) => !ok.body.backupCodes.some((code) => c.code_hash.includes(code)))).toBe(true);
    expect((await call('GET', '/api/data', { token: ok.body.token })).body.ok).toBe(true);
    expect(mockDb.events.some((e) => e.event_type === 'mfa_enrolled' && e.user_id === 1)).toBe(true);

    // Next sign-in goes to verify, not enroll.
    const again = await passwordStep('admin1@example.test');
    expect(again.body.mfaEnrollRequired).toBe(false);
  });
});

describe('TOTP verification', () => {
  test('valid code signs in; invalid code is refused; same code cannot be replayed', async () => {
    const { secret } = await enroll('admin1@example.test');
    // Enrollment consumed the current step; use a fresh window by moving last_step back.
    mockDb.users[0].totp_last_step -= 2;
    const login = await passwordStep('admin1@example.test');

    const wrong = await post('/api/auth/mfa/verify', { mfaToken: login.body.mfaToken, code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.token).toBeUndefined();

    const code = currentCode(secret);
    const ok = await post('/api/auth/mfa/verify', { mfaToken: login.body.mfaToken, code });
    expect(ok.status).toBe(200);
    const claims = jwt.decode(ok.body.token);
    expect(claims.typ).toBe('access');
    expect(claims.mfa).toBe(true);
    expect(claims.exp - claims.iat).toBe(12 * 3600);
    expect((await call('GET', '/api/data', { token: ok.body.token })).body.who).toBe('admin1@example.test');

    const login2 = await passwordStep('admin1@example.test');
    const replay = await post('/api/auth/mfa/verify', { mfaToken: login2.body.mfaToken, code });
    expect(replay.status).toBe(401);
  });
});

describe('backup codes', () => {
  test('each backup code works exactly once', async () => {
    const { backupCodes } = await enroll('admin1@example.test');
    const first = await passwordStep('admin1@example.test');
    const ok = await post('/api/auth/mfa/verify', { mfaToken: first.body.mfaToken, code: backupCodes[3].toLowerCase() });
    expect(ok.status).toBe(200);
    expect(ok.body.backupCodesRemaining).toBe(9);
    expect(mockDb.events.some((e) => e.event_type === 'backup_code_used')).toBe(true);

    const second = await passwordStep('admin1@example.test');
    const reuse = await post('/api/auth/mfa/verify', { mfaToken: second.body.mfaToken, code: backupCodes[3] });
    expect(reuse.status).toBe(401);
    const other = await post('/api/auth/mfa/verify', { mfaToken: second.body.mfaToken, code: backupCodes[4] });
    expect(other.status).toBe(200);
  });
});

describe('rate limiting', () => {
  test('5 wrong passwords lock that account+IP for 15 minutes, even with the right password', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await passwordStep('admin1@example.test', 'nope nope nope')).status).toBe(401);
    }
    const locked = await passwordStep('admin1@example.test');
    expect(locked.status).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(800);
    // A different IP is not locked by that account+IP counter.
    const otherIp = await passwordStep('admin1@example.test', PASSWORD, { 'X-Forwarded-For': '203.0.113.9' });
    expect(otherIp.status).toBe(200);
  });

  test('locked message is identical for real and unknown emails', async () => {
    for (let i = 0; i < 5; i += 1) {
      await passwordStep('admin1@example.test', 'nope nope nope');
      await passwordStep('ghost@example.test', 'nope nope nope');
    }
    const a = await passwordStep('admin1@example.test');
    const b = await passwordStep('ghost@example.test');
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(a.body).toEqual(b.body);
  });

  test('5 wrong codes lock code verification', async () => {
    const { secret } = await enroll('admin1@example.test');
    mockDb.users[0].totp_last_step -= 2;
    const login = await passwordStep('admin1@example.test');
    for (let i = 0; i < 5; i += 1) {
      expect((await post('/api/auth/mfa/verify', { mfaToken: login.body.mfaToken, code: '000000' })).status).toBe(401);
    }
    const blocked = await post('/api/auth/mfa/verify', { mfaToken: login.body.mfaToken, code: currentCode(secret) });
    expect(blocked.status).toBe(429);
    expect(blocked.body.token).toBeUndefined();
  });
});

describe('admin reset of 2FA', () => {
  test('admin resets another user: logged, their sessions die, they must re-enroll', async () => {
    const admin = await enroll('admin1@example.test');
    const target = await enroll('admin2@example.test');
    expect((await call('GET', '/api/data', { token: target.token })).status).toBe(200);

    const r = await post('/api/auth/users/2/mfa/reset', { reason: 'lost phone' }, { token: admin.token });
    expect(r.status).toBe(200);
    expect(mockDb.users[1].totp_enabled_at).toBeNull();
    expect(mockDb.codes.filter((c) => c.user_id === 2)).toHaveLength(0);
    const ev = mockDb.events.find((e) => e.event_type === 'mfa_reset');
    expect(ev).toMatchObject({ user_id: 2, actor_user_id: 1 });

    expect((await call('GET', '/api/data', { token: target.token })).status).toBe(401);
    const login = await passwordStep('admin2@example.test');
    expect(login.body.mfaEnrollRequired).toBe(true);
  });

  test('admins cannot reset their own 2FA; non-admins cannot reset anyone', async () => {
    const admin = await enroll('admin1@example.test');
    expect((await post('/api/auth/users/1/mfa/reset', {}, { token: admin.token })).status).toBe(400);
    const agent = await enroll('agent3@example.test');
    expect((await post('/api/auth/users/1/mfa/reset', {}, { token: agent.token })).status).toBe(403);
    expect(mockDb.users[0].totp_enabled_at).not.toBeNull();
  });

  test('admin password reset signs the user out everywhere and enforces policy', async () => {
    const admin = await enroll('admin1@example.test');
    const target = await enroll('admin2@example.test');
    expect((await call('PATCH', '/api/auth/users/2/password', { body: { password: 'short' }, token: admin.token })).status).toBe(400);
    const ok = await call('PATCH', '/api/auth/users/2/password', { body: { password: 'a much longer passphrase 42' }, token: admin.token });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/api/data', { token: target.token })).status).toBe(401);
    expect(mockDb.events.some((e) => e.event_type === 'password_reset_by_admin')).toBe(true);
  });
});

describe('service-to-service auth is unaffected by 2FA', () => {
  test('OLICOMM_API_KEY env key still works without any MFA step', async () => {
    process.env.OLICOMM_API_KEY = 'svc_test_key_not_real_0123456789';
    try {
      const r = await call('GET', '/api/data', { headers: { 'x-api-key': 'svc_test_key_not_real_0123456789' } });
      expect(r.status).toBe(200);
      expect(r.body.authType).toBe('api_key');
    } finally {
      delete process.env.OLICOMM_API_KEY;
    }
  });

  test('hashed api_keys rows still work as Bearer tokens', async () => {
    mockDb.apiKeys.push({ key_hash: sha256hex('olicomm_row_key_for_test'), user_id: 0, name: 'Max', email: 'max@example.test', role: 'admin' });
    const r = await call('GET', '/api/admin-data', { token: 'olicomm_row_key_for_test' });
    expect(r.status).toBe(200);
  });

  test('API keys cannot reset anyone\'s 2FA', async () => {
    mockDb.apiKeys.push({ key_hash: sha256hex('olicomm_row_key_for_test'), user_id: 0, name: 'Max', email: 'max@example.test', role: 'admin' });
    await enroll('admin2@example.test');
    const r = await post('/api/auth/users/2/mfa/reset', {}, { token: 'olicomm_row_key_for_test' });
    expect(r.status).toBe(403);
  });
});

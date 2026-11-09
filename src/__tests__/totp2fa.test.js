'use strict';

const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-olicomm-2fa-unit';

jest.mock('../../db/database', () => ({
  getPool: () => ({
    query: jest.fn().mockRejectedValue(Object.assign(new Error('no db in unit test'), { code: 'ECONNREFUSED' })),
  }),
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(async () => 'data:image/png;base64,TEST'),
}));

const jwt = require('jsonwebtoken');
const {
  generateTotpSecret,
  totpAt,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
  consumeBackupCode,
  encryptTotpSecret,
  decryptTotpSecret,
  buildOtpauthUri,
} = require('../totp');
const {
  issueSessionToken,
  issueTemp2faToken,
  isTemp2faPayload,
  non2faLoginResponse,
  requireAuth,
  TEMP_2FA_PURPOSE,
} = require('../../routes/auth');

const user = {
  id: 42,
  name: 'Yahoska Perez',
  email: 'yahoska@healthexps.com',
  role: 'admin',
  agency: '',
  totp_enabled: false,
};

describe('TOTP crypto + verify', () => {
  test('encrypt/decrypt round-trip with JWT_SECRET-derived key', () => {
    const secret = generateTotpSecret();
    const enc = encryptTotpSecret(secret);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain(secret);
    expect(decryptTotpSecret(enc)).toBe(secret);
  });

  test('verifyTotp accepts current code and ±1 step window', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(secret, totpAt(secret, now, 0), { timeMs: now })).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now, -1), { timeMs: now })).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now, 1), { timeMs: now })).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now, 2), { timeMs: now })).toBe(false);
    expect(verifyTotp(secret, '000000', { timeMs: now })).toBe(false);
  });

  test('otpauth URI includes issuer and secret', () => {
    const secret = generateTotpSecret();
    const uri = buildOtpauthUri(secret, 'yahoska@healthexps.com');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('secret=' + secret);
    expect(uri).toContain('OliComm');
  });
});

describe('backup codes', () => {
  test('single-use: matching code is removed; second use fails', () => {
    const codes = generateBackupCodes(3);
    expect(codes).toHaveLength(3);
    const hashes = codes.map(hashBackupCode);
    const first = consumeBackupCode(codes[1], hashes);
    expect(first.ok).toBe(true);
    expect(first.remainingHashes).toHaveLength(2);
    const again = consumeBackupCode(codes[1], first.remainingHashes);
    expect(again.ok).toBe(false);
    expect(again.remainingHashes).toHaveLength(2);
    const other = consumeBackupCode(codes[0], first.remainingHashes);
    expect(other.ok).toBe(true);
    expect(other.remainingHashes).toHaveLength(1);
  });
});

describe('non-2FA login response unchanged', () => {
  test('shape is { token, user: { id, name, email, role, agency } } only', () => {
    const res = non2faLoginResponse(user);
    expect(Object.keys(res).sort()).toEqual(['token', 'user']);
    expect(Object.keys(res.user).sort()).toEqual(['agency', 'email', 'id', 'name', 'role']);
    expect(res.user).not.toHaveProperty('totp_enabled');
    const decoded = jwt.verify(res.token, process.env.JWT_SECRET);
    expect(decoded.purpose).toBeUndefined();
    expect(decoded.id).toBe(42);
    expect(decoded.email).toBe('yahoska@healthexps.com');
  });
});

describe('temp 2FA token cannot access APIs', () => {
  test('temp token payload is marked 2fa_pending and expires in ~5 minutes', () => {
    const token = issueTemp2faToken(user);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(isTemp2faPayload(decoded)).toBe(true);
    expect(decoded.purpose).toBe(TEMP_2FA_PURPOSE);
    expect(decoded.role).toBeUndefined();
    const ttl = decoded.exp - decoded.iat;
    expect(ttl).toBeLessThanOrEqual(5 * 60);
    expect(ttl).toBeGreaterThan(4 * 60);
  });

  test('requireAuth rejects temp tokens with 401', (done) => {
    const token = issueTemp2faToken(user);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    requireAuth(req, res, () => {
      done(new Error('next() should not be called for temp 2FA tokens'));
    });
    setTimeout(() => {
      try {
        expect(res.statusCode).toBe(401);
        expect(String(res.body && res.body.error || '')).toMatch(/2FA|Unauthorized|Complete/i);
        done();
      } catch (err) {
        done(err);
      }
    }, 80);
  });

  test('session token from issueSessionToken is accepted by jwt.verify without purpose', () => {
    const token = issueSessionToken(user);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(isTemp2faPayload(decoded)).toBe(false);
    expect(decoded.role).toBe('admin');
  });
});

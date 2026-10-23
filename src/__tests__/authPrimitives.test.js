/**
 * @jest-environment node
 */
'use strict';

const crypto = require('crypto');
const {
  decodeKey, encryptSecret, decryptSecret, generateBackupCodes, hashBackupCode, verifyBackupCodeHash, normalizeBackupCode,
} = require('../authCrypto');
const { FailureLimiter, clientIp } = require('../authRateLimit');
const { passwordProblem } = require('../passwordPolicy');
const { generateTotpSecret, verifyTotp, currentCode } = require('../totp');
const { jwtSecretWarnings } = require('../authTokens');

describe('authCrypto', () => {
  const key = crypto.randomBytes(32);

  test('accepts 32-byte base64 or hex keys only', () => {
    expect(decodeKey(key.toString('base64'))).toHaveLength(32);
    expect(decodeKey(key.toString('hex'))).toHaveLength(32);
    expect(decodeKey('too-short')).toBeNull();
    expect(decodeKey('')).toBeNull();
  });

  test('AES-GCM round trip; tampering is detected; wrong key fails', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc, key)).toBe('JBSWY3DPEHPK3PXP');
    const parts = enc.split(':');
    parts[3] = Buffer.from('AAAAAAAAAAAAAAAA').toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
    expect(() => decryptSecret(enc, crypto.randomBytes(32))).toThrow();
    expect(() => encryptSecret('x', null)).toThrow('MFA_NOT_CONFIGURED');
  });

  test('backup codes: 10 unique, hashed with salt, normalized compare', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/));
    const h1 = hashBackupCode(codes[0]);
    const h2 = hashBackupCode(codes[0]);
    expect(h1).not.toBe(h2);
    expect(verifyBackupCodeHash(` ${codes[0].toLowerCase()} `, h1)).toBe(true);
    expect(verifyBackupCodeHash(codes[1], h1)).toBe(false);
    expect(normalizeBackupCode('ab-c d')).toBe('ABCD');
  });
});

describe('totp', () => {
  test('accepts ±1 step drift, rejects older and replayed steps', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = verifyTotp(currentCode(secret, now), secret, null, now);
    expect(step).toBe(Math.floor(now / 30000));
    expect(verifyTotp(currentCode(secret, now - 30000), secret, null, now)).toBe(step - 1);
    expect(verifyTotp(currentCode(secret, now - 120000), secret, null, now)).toBeNull();
    expect(verifyTotp(currentCode(secret, now), secret, step, now)).toBeNull();
    expect(verifyTotp('12345', secret, null, now)).toBeNull();
  });
});

describe('FailureLimiter', () => {
  test('locks after N failures for the lock period, then frees', () => {
    let t = 0;
    const lim = new FailureLimiter({ maxFailures: 5, windowMs: 900000, lockMs: 900000, now: () => t });
    for (let i = 0; i < 4; i += 1) lim.fail('k');
    expect(lim.lockedFor('k')).toBe(0);
    lim.fail('k');
    expect(lim.lockedFor('k')).toBe(900000);
    t += 899999;
    expect(lim.lockedFor('k')).toBe(1);
    t += 1;
    expect(lim.lockedFor('k')).toBe(0);
  });

  test('failures outside the window do not accumulate', () => {
    let t = 0;
    const lim = new FailureLimiter({ maxFailures: 3, windowMs: 1000, lockMs: 5000, now: () => t });
    lim.fail('k'); lim.fail('k');
    t = 2000;
    lim.fail('k');
    expect(lim.lockedFor('k')).toBe(0);
  });

  test('clientIp uses the right-most X-Forwarded-For hop', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' } })).toBe('9.9.9.9');
    expect(clientIp({ headers: {}, ip: '5.5.5.5' })).toBe('5.5.5.5');
  });
});

describe('password policy and JWT secret checks', () => {
  test('rejects short, common, and name-based passwords', () => {
    expect(passwordProblem('short')).toMatch(/12/);
    expect(passwordProblem('password123')).toMatch(/12/);
    expect(passwordProblem('aaaaaaaaaaaaaaa')).toMatch(/repeated/);
    expect(passwordProblem('katrina-rocks-2026', { email: 'katrina@example.test' })).toMatch(/email/);
    expect(passwordProblem('blue river candle 88')).toBeNull();
    expect(passwordProblem('x'.repeat(73))).toMatch(/72/);
  });

  test('flags weak JWT secrets without returning the value', () => {
    expect(jwtSecretWarnings('')).toEqual(['JWT_SECRET is not set']);
    expect(jwtSecretWarnings('abc').join(' ')).not.toContain('abc ');
    expect(jwtSecretWarnings(crypto.randomBytes(48).toString('base64'))).toEqual([]);
  });
});

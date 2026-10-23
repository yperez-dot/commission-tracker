'use strict';

/**
 * Crypto helpers for two-factor sign-in.
 *
 * - TOTP secrets are encrypted at rest with AES-256-GCM using TOTP_ENCRYPTION_KEY
 *   (32 random bytes, base64 or hex). The key never lives in the database.
 * - Backup codes are random, shown once, and stored only as salted scrypt hashes.
 */

const crypto = require('crypto');

const KEY_ENV = 'TOTP_ENCRYPTION_KEY';
const ENC_VERSION = 'v1';
const BACKUP_CODE_COUNT = 10;
// Crockford-style alphabet without look-alikes (no 0/O, 1/I/L).
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

let warnedMissingKey = false;

function decodeKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) buf = Buffer.from(value, 'hex');
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    buf = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }
  if (!buf || buf.length !== 32) return null;
  return buf;
}

/** Returns the 32-byte key, or null (and logs once) if missing or malformed. */
function getEncryptionKey(env = process.env) {
  const key = decodeKey(env[KEY_ENV]);
  if (!key && !warnedMissingKey) {
    warnedMissingKey = true;
    console.error(
      `SECURITY: ${KEY_ENV} is missing or not 32 bytes (base64/hex). ` +
      'Two-factor sign-in is disabled and browser logins will fail closed until it is set on Railway. ' +
      'API-key access (OLICOMM_API_KEY / api_keys) is unaffected.'
    );
  }
  return key;
}

function isMfaConfigured(env = process.env) {
  return !!decodeKey(env[KEY_ENV]);
}

function encryptSecret(plaintext, key = getEncryptionKey()) {
  if (!key) throw new Error('MFA_NOT_CONFIGURED');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

function decryptSecret(payload, key = getEncryptionKey()) {
  if (!key) throw new Error('MFA_NOT_CONFIGURED');
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== ENC_VERSION) throw new Error('BAD_CIPHERTEXT');
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

function randomBackupCode() {
  let out = '';
  for (let i = 0; i < 10; i += 1) out += BACKUP_ALPHABET[crypto.randomInt(BACKUP_ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Uppercases and strips spaces/dashes so "abcde-fghjk" and "ABCDEFGHJK" match. */
function normalizeBackupCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function looksLikeBackupCode(code) {
  const n = normalizeBackupCode(code);
  return n.length === 10;
}

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function hashBackupCode(code) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(normalizeBackupCode(code), salt, 32, SCRYPT_PARAMS);
  return `s1:${salt.toString('base64')}:${hash.toString('base64')}`;
}

function verifyBackupCodeHash(code, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 's1') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const actual = crypto.scryptSync(normalizeBackupCode(code), salt, expected.length, SCRYPT_PARAMS);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function generateBackupCodes(count = BACKUP_CODE_COUNT) {
  const codes = new Set();
  while (codes.size < count) codes.add(randomBackupCode());
  return [...codes];
}

function _resetWarningsForTests() { warnedMissingKey = false; }

module.exports = {
  KEY_ENV,
  BACKUP_CODE_COUNT,
  decodeKey,
  getEncryptionKey,
  isMfaConfigured,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  normalizeBackupCode,
  looksLikeBackupCode,
  hashBackupCode,
  verifyBackupCodeHash,
  _resetWarningsForTests,
};

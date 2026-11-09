'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { encryptTotpSecret, decryptTotpSecret } = require('./totpCrypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ISSUER = 'OliComm';
const STEP_SECONDS = 30;
const DIGITS = 6;
const BACKUP_COUNT = 10;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str) {
  const cleaned = String(str || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i -= 1) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const str = String(code % 10 ** DIGITS);
  return str.padStart(DIGITS, '0');
}

function totpAt(secretBase32, timeMs = Date.now(), windowOffset = 0) {
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS) + windowOffset;
  return hotp(secretBase32, counter);
}

/** Accept current step ± windowSteps (default 1). */
function verifyTotp(secretBase32, code, opts = {}) {
  const windowSteps = opts.windowSteps == null ? 1 : opts.windowSteps;
  const timeMs = opts.timeMs == null ? Date.now() : opts.timeMs;
  const expected = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(expected)) return false;
  for (let w = -windowSteps; w <= windowSteps; w += 1) {
    if (totpAt(secretBase32, timeMs, w) === expected) return true;
  }
  return false;
}

function buildOtpauthUri(secretBase32, accountName, issuer = ISSUER) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function generateBackupCodes(count = BACKUP_COUNT) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    // 8 chars, groups of 4 for readability: ABCD-EFGH
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

function hashBackupCode(code) {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return bcrypt.hashSync(normalized, 8);
}

function backupCodeMatches(code, hash) {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized || !hash) return false;
  try {
    return bcrypt.compareSync(normalized, hash);
  } catch {
    return false;
  }
}

/**
 * Consume one matching backup code. Returns { ok, remainingHashes }.
 * Single-use: matching hash is removed.
 */
function consumeBackupCode(code, hashes) {
  const list = Array.isArray(hashes) ? hashes.slice() : [];
  for (let i = 0; i < list.length; i += 1) {
    if (backupCodeMatches(code, list[i])) {
      list.splice(i, 1);
      return { ok: true, remainingHashes: list };
    }
  }
  return { ok: false, remainingHashes: list };
}

function parseBackupHashes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function serializeBackupHashes(hashes) {
  return JSON.stringify(Array.isArray(hashes) ? hashes : []);
}

module.exports = {
  ISSUER,
  STEP_SECONDS,
  DIGITS,
  BACKUP_COUNT,
  generateTotpSecret,
  totpAt,
  verifyTotp,
  buildOtpauthUri,
  generateBackupCodes,
  hashBackupCode,
  backupCodeMatches,
  consumeBackupCode,
  parseBackupHashes,
  serializeBackupHashes,
  encryptTotpSecret,
  decryptTotpSecret,
  base32Encode,
  base32Decode,
};

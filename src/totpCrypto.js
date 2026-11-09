'use strict';

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'v1:';

/**
 * Encryption key for TOTP secrets at rest.
 * Prefers TOTP_ENC_KEY (32+ chars or hex); falls back to JWT_SECRET-derived key.
 */
function getTotpEncKey(env = process.env) {
  const explicit = String(env.TOTP_ENC_KEY || '').trim();
  if (explicit) {
    if (/^[0-9a-fA-F]{64}$/.test(explicit)) {
      return Buffer.from(explicit, 'hex');
    }
    return crypto.createHash('sha256').update(`olicomm-totp-enc:${explicit}`).digest();
  }
  const jwt = String(env.JWT_SECRET || '').trim();
  if (!jwt) {
    throw new Error('JWT_SECRET or TOTP_ENC_KEY required to encrypt TOTP secrets');
  }
  return crypto.createHash('sha256').update(`olicomm-totp-enc:${jwt}`).digest();
}

function encryptTotpSecret(plain, env = process.env) {
  if (!plain) return null;
  const key = getTotpEncKey(env);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptTotpSecret(blob, env = process.env) {
  if (!blob) return null;
  const raw = String(blob);
  if (!raw.startsWith(PREFIX)) {
    // Legacy / unexpected plaintext — treat as plain base32 (should not happen in prod).
    return raw;
  }
  const buf = Buffer.from(raw.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const key = getTotpEncKey(env);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = {
  getTotpEncKey,
  encryptTotpSecret,
  decryptTotpSecret,
};

'use strict';

/** RFC 6238 TOTP (30s, 6 digits, SHA-1 — what Google/Microsoft Authenticator expect). */

const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const ISSUER = 'OliComm';
const STEP_SECONDS = 30;

const totp = authenticator.clone({ step: STEP_SECONDS, digits: 6, window: 1 });

function generateTotpSecret() {
  return totp.generateSecret(20); // 160-bit, base32
}

function otpauthUri(email, secret) {
  return totp.keyuri(String(email || 'user'), ISSUER, secret);
}

async function qrDataUrl(uri) {
  return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
}

function normalizeTotpCode(code) {
  return String(code || '').replace(/\s+/g, '');
}

function looksLikeTotp(code) {
  return /^\d{6}$/.test(normalizeTotpCode(code));
}

/**
 * Verifies a code allowing ±1 step of clock drift. Returns the matched time
 * step (integer) or null. Codes at or before `lastStep` are rejected so a code
 * can't be replayed.
 */
function verifyTotp(code, secret, lastStep = null, nowMs = Date.now()) {
  const token = normalizeTotpCode(code);
  if (!looksLikeTotp(token) || !secret) return null;
  const opts = totp.clone({ epoch: nowMs });
  const delta = opts.checkDelta(token, secret);
  if (delta === null || delta === undefined) return null;
  const step = Math.floor(nowMs / 1000 / STEP_SECONDS) + delta;
  if (lastStep !== null && lastStep !== undefined && step <= Number(lastStep)) return null;
  return step;
}

/** Test helper: the code an authenticator would show at nowMs. */
function currentCode(secret, nowMs = Date.now()) {
  return totp.clone({ epoch: nowMs }).generate(secret);
}

module.exports = { ISSUER, generateTotpSecret, otpauthUri, qrDataUrl, verifyTotp, looksLikeTotp, currentCode };

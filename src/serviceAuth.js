'use strict';

const crypto = require('crypto');

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function secretsEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractApiToken(req) {
  const auth = String((req && req.headers && req.headers.authorization) || '');
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const headerKey = req && req.headers && (req.headers['x-api-key'] || req.headers['x-olicomm-api-key']);
  if (headerKey) return String(headerKey).trim();
  return '';
}

function envApiKeyMatches(token) {
  const envKey = process.env.OLICOMM_API_KEY || '';
  if (!envKey || !token) return false;
  return secretsEqual(token, envKey);
}

function servicePrincipal(overrides = {}) {
  return {
    id: Number(overrides.id || process.env.OLICOMM_API_USER_ID || 0) || 0,
    name: overrides.name || process.env.OLICOMM_API_USER_NAME || 'Igor',
    email: overrides.email || process.env.OLICOMM_API_USER_EMAIL || 'igor@healthexps.com',
    role: overrides.role || 'admin',
    agency: overrides.agency || '',
    authType: 'api_key',
  };
}

module.exports = {
  sha256hex,
  secretsEqual,
  extractApiToken,
  envApiKeyMatches,
  servicePrincipal,
};

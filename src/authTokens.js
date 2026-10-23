'use strict';

/**
 * Session tokens.
 *
 * Two kinds of JWT, signed with JWT_SECRET but never interchangeable:
 *   - access:      full session, 12h, audience "olicomm-api", typ "access", mfa=true
 *   - mfa_pending: issued after the password step only, 5 min, audience
 *                  "olicomm-mfa", typ "mfa_pending". It can only call the
 *                  /api/auth/mfa/* endpoints. requireAuth rejects it.
 * Both carry `sv` (users.session_version). Bumping it (password reset, 2FA
 * reset, user deleted) invalidates every outstanding token for that user.
 */

const jwt = require('jsonwebtoken');

const ACCESS_AUDIENCE = 'olicomm-api';
const PENDING_AUDIENCE = 'olicomm-mfa';
const ISSUER = 'olicomm';
const ACCESS_TTL = process.env.SESSION_TTL || '12h';
const PENDING_TTL = '5m';
const ALGORITHMS = ['HS256'];

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  return s;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    agency: user.agency || '',
  };
}

function signAccessToken(user) {
  return jwt.sign(
    { ...publicUser(user), typ: 'access', mfa: true, sv: Number(user.session_version || 0) },
    secret(),
    { expiresIn: ACCESS_TTL, audience: ACCESS_AUDIENCE, issuer: ISSUER, subject: String(user.id), algorithm: 'HS256' }
  );
}

/** purpose: 'verify' (user has 2FA) or 'enroll' (must set it up now). */
function signPendingToken(user, purpose) {
  return jwt.sign(
    { uid: user.id, typ: 'mfa_pending', purpose, sv: Number(user.session_version || 0) },
    secret(),
    { expiresIn: PENDING_TTL, audience: PENDING_AUDIENCE, issuer: ISSUER, subject: String(user.id), algorithm: 'HS256' }
  );
}

/** Throws unless the token is a full (post-2FA) access token. */
function verifyAccessToken(token) {
  const claims = jwt.verify(token, secret(), { audience: ACCESS_AUDIENCE, issuer: ISSUER, algorithms: ALGORITHMS });
  if (claims.typ !== 'access' || claims.mfa !== true) throw new Error('NOT_ACCESS_TOKEN');
  return claims;
}

/** Throws unless the token is an unexpired mfa-pending token. */
function verifyPendingToken(token) {
  const claims = jwt.verify(token, secret(), { audience: PENDING_AUDIENCE, issuer: ISSUER, algorithms: ALGORITHMS });
  if (claims.typ !== 'mfa_pending' || !claims.uid) throw new Error('NOT_PENDING_TOKEN');
  return claims;
}

/** Startup check — warn (never print) if the JWT secret looks weak. */
function jwtSecretWarnings(value = process.env.JWT_SECRET) {
  const s = String(value || '');
  const warnings = [];
  if (!s) warnings.push('JWT_SECRET is not set');
  else {
    if (s.length < 32) warnings.push('JWT_SECRET is shorter than 32 characters');
    if (new Set(s).size < 10) warnings.push('JWT_SECRET has very low character variety');
  }
  return warnings;
}

module.exports = {
  ACCESS_AUDIENCE,
  PENDING_AUDIENCE,
  ACCESS_TTL,
  PENDING_TTL,
  publicUser,
  signAccessToken,
  signPendingToken,
  verifyAccessToken,
  verifyPendingToken,
  jwtSecretWarnings,
};

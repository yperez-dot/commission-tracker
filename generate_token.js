#!/usr/bin/env node
'use strict';

/**
 * Mint a session JWT for local/ops use (bypasses the sign-in screen).
 * Requires JWT_SECRET, USER_ID and EMAIL in the environment — never hardcode secrets or real emails.
 * The token is only accepted for a user who has two-factor turned on and whose
 * session_version matches (SESSION_VERSION, default 0). Prefer OLICOMM_API_KEY for automations.
 *
 *   JWT_SECRET=... USER_ID=1 EMAIL=admin@example.com ROLE=admin node generate_token.js
 */
const { signAccessToken } = require('./src/authTokens');

if (!process.env.JWT_SECRET || !process.env.USER_ID || !process.env.EMAIL) {
  console.error('ERROR: JWT_SECRET, USER_ID and EMAIL env vars are required');
  process.exit(1);
}

const token = signAccessToken({
  id: parseInt(process.env.USER_ID, 10),
  email: process.env.EMAIL,
  role: process.env.ROLE || 'admin',
  name: process.env.NAME || '',
  agency: process.env.AGENCY || '',
  session_version: parseInt(process.env.SESSION_VERSION || '0', 10),
});

console.log('Bearer ' + token);

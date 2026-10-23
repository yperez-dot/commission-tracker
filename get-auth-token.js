#!/usr/bin/env node
'use strict';

/**
 * Login helper — passwords must come from the environment, never the repo.
 * Two-factor is required: pass the current authenticator code (or a backup code) as OTP.
 * The user must already have two-factor set up (do that once in the browser).
 *
 *   API_URL=https://... EMAIL=... PASSWORD=... OTP=123456 node get-auth-token.js
 *
 * Automations should use OLICOMM_API_KEY instead of this script.
 */
const API_URL = process.env.API_URL || process.env.REACT_APP_API_URL;
const email = process.env.EMAIL;
const password = process.env.PASSWORD;
const otp = process.env.OTP;

if (!API_URL || !email || !password || !otp) {
  console.error('Usage: API_URL=... EMAIL=... PASSWORD=... OTP=<authenticator code> node get-auth-token.js');
  process.exit(1);
}

async function post(path, body) {
  const response = await fetch(`${API_URL.replace(/\/$/, '')}/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: await response.json().catch(() => ({})) };
}

async function login() {
  const step1 = await post('/login', { email, password });
  if (!step1.ok || !step1.data.mfaToken) {
    console.error('Login failed:', step1.data.error || 'unknown error');
    process.exit(1);
  }
  if (step1.data.mfaEnrollRequired) {
    console.error('This account has not set up two-factor yet. Sign in once in the browser to set it up.');
    process.exit(1);
  }
  const step2 = await post('/mfa/verify', { mfaToken: step1.data.mfaToken, code: otp });
  if (!step2.ok || !step2.data.token) {
    console.error('Two-factor failed:', step2.data.error || 'unknown error');
    process.exit(1);
  }
  console.log('Token:', step2.data.token);
  console.log(`  -H "Authorization: Bearer ${step2.data.token}"`);
}

login().catch((err) => {
  console.error(err);
  process.exit(1);
});

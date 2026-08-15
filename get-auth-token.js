#!/usr/bin/env node
'use strict';

/**
 * Login helper — passwords must come from the environment, never the repo.
 *
 *   API_URL=https://... EMAIL=... PASSWORD=... node get-auth-token.js
 */
const API_URL = process.env.API_URL || process.env.REACT_APP_API_URL;
const email = process.env.EMAIL;
const password = process.env.PASSWORD;

if (!API_URL || !email || !password) {
  console.error('Usage: API_URL=... EMAIL=... PASSWORD=... node get-auth-token.js');
  process.exit(1);
}

async function login() {
  const response = await fetch(`${API_URL.replace(/\/$/, '')}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok || !data.token) {
    console.error('Login failed:', data);
    process.exit(1);
  }
  console.log('Token:', data.token);
  console.log(`  -H "Authorization: Bearer ${data.token}"`);
}

login().catch((err) => {
  console.error(err);
  process.exit(1);
});

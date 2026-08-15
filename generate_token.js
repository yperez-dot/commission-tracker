#!/usr/bin/env node
'use strict';

/**
 * Mint a JWT for local/ops use.
 * Requires JWT_SECRET in the environment — never hardcode secrets.
 *
 *   JWT_SECRET=... node generate_token.js
 *   JWT_SECRET=... EMAIL=yperez@healthexps.com ROLE=admin node generate_token.js
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET env var is required');
  process.exit(1);
}

const email = process.env.EMAIL || 'yperez@healthexps.com';
const role = process.env.ROLE || 'admin';
const name = process.env.NAME || 'Yahoska Perez';
const id = parseInt(process.env.USER_ID || '1', 10);

const token = jwt.sign(
  { id, email, role, name, agency: process.env.AGENCY || '' },
  JWT_SECRET,
  { expiresIn: process.env.EXPIRES || '24h' }
);

console.log('Bearer ' + token);

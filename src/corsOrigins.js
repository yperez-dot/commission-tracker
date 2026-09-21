'use strict';

const DEFAULT_CORS_ORIGINS = [
  'https://olicomm.healthexps.com',
  'https://melodic-cendol-e1dc49.netlify.app',
  'http://localhost:3000',
  'https://tools.healthexps.com',
  'https://olicomm.healthxps.com',
];

const CORS_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'x-agency-override',
  'x-api-key',
  'x-olicomm-api-key',
];

function parseOriginList(value) {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function uniqueOrigins(origins) {
  const seen = new Set();
  const result = [];
  for (const origin of origins) {
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    result.push(origin);
  }
  return result;
}

/**
 * Allowed browser origins. Defaults always apply; CORS_ORIGINS (comma-separated)
 * and FRONTEND_URL add extra hostnames without a code change.
 */
function resolveCorsOrigins(env = process.env) {
  return uniqueOrigins([
    ...DEFAULT_CORS_ORIGINS,
    ...parseOriginList(env.CORS_ORIGINS),
    ...parseOriginList(env.FRONTEND_URL),
  ]);
}

function corsOptions(env = process.env) {
  return {
    origin: resolveCorsOrigins(env),
    credentials: true,
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
  };
}

module.exports = {
  DEFAULT_CORS_ORIGINS,
  CORS_METHODS,
  CORS_ALLOWED_HEADERS,
  parseOriginList,
  resolveCorsOrigins,
  corsOptions,
};

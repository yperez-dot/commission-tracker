'use strict';

const http = require('http');
const express = require('express');
const cors = require('cors');
const {
  DEFAULT_CORS_ORIGINS,
  CORS_METHODS,
  CORS_ALLOWED_HEADERS,
  parseOriginList,
  resolveCorsOrigins,
  corsOptions,
} = require('../corsOrigins');

function preflight(app, origin, path = '/api/auth/login') {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      }, (res) => {
        const headers = res.headers;
        res.resume();
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, headers }));
        });
      });
      req.on('error', (err) => {
        server.close(() => reject(err));
      });
      req.end();
    });
  });
}

describe('corsOrigins', () => {
  test('parseOriginList splits comma-separated hosts and trims', () => {
    expect(parseOriginList(' https://a.example ,https://b.example, ')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(parseOriginList('')).toEqual([]);
    expect(parseOriginList(undefined)).toEqual([]);
  });

  test('defaults include the custom domain, Netlify app, and localhost', () => {
    expect(DEFAULT_CORS_ORIGINS).toEqual(expect.arrayContaining([
      'https://olicomm.healthexps.com',
      'https://melodic-cendol-e1dc49.netlify.app',
      'http://localhost:3000',
      'https://tools.healthexps.com',
    ]));
  });

  test('resolveCorsOrigins uses defaults when env is empty', () => {
    expect(resolveCorsOrigins({})).toEqual(DEFAULT_CORS_ORIGINS);
  });

  test('CORS_ORIGINS and FRONTEND_URL add extra hosts without dropping defaults', () => {
    const origins = resolveCorsOrigins({
      CORS_ORIGINS: 'https://preview.example.com, https://olicomm.healthexps.com',
      FRONTEND_URL: 'https://tools.healthexps.com',
    });
    expect(origins).toEqual(expect.arrayContaining([
      'https://olicomm.healthexps.com',
      'https://melodic-cendol-e1dc49.netlify.app',
      'http://localhost:3000',
      'https://preview.example.com',
      'https://tools.healthexps.com',
    ]));
    expect(origins.filter((o) => o === 'https://olicomm.healthexps.com')).toHaveLength(1);
  });

  test('corsOptions keeps credentials and the same methods/headers', () => {
    const options = corsOptions({});
    expect(options.credentials).toBe(true);
    expect(options.methods).toEqual(CORS_METHODS);
    expect(options.allowedHeaders).toEqual(CORS_ALLOWED_HEADERS);
    expect(options.origin).toEqual(DEFAULT_CORS_ORIGINS);
  });

  test('OPTIONS from olicomm.healthexps.com reflects that origin', async () => {
    const app = express();
    app.use(cors(corsOptions({})));
    app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));

    const { status, headers } = await preflight(app, 'https://olicomm.healthexps.com');
    expect(status).toBe(204);
    expect(headers['access-control-allow-origin']).toBe('https://olicomm.healthexps.com');
    expect(headers['access-control-allow-credentials']).toBe('true');
  });

  test('OPTIONS from the Netlify origin still reflects that origin', async () => {
    const app = express();
    app.use(cors(corsOptions({})));
    app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));

    const { headers } = await preflight(app, 'https://melodic-cendol-e1dc49.netlify.app');
    expect(headers['access-control-allow-origin']).toBe('https://melodic-cendol-e1dc49.netlify.app');
  });

  test('OPTIONS from an unknown origin does not reflect that origin', async () => {
    const app = express();
    app.use(cors(corsOptions({})));
    app.post('/api/auth/login', (_req, res) => res.json({ ok: true }));

    const { headers } = await preflight(app, 'https://evil.example');
    expect(headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

'use strict';

const {
  sha256hex,
  secretsEqual,
  extractApiToken,
  envApiKeyMatches,
  servicePrincipal,
} = require('../serviceAuth');

describe('serviceAuth', () => {
  const originalKey = process.env.OLICOMM_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OLICOMM_API_KEY;
    else process.env.OLICOMM_API_KEY = originalKey;
  });

  test('extracts Bearer token', () => {
    expect(extractApiToken({ headers: { authorization: 'Bearer abc123' } })).toBe('abc123');
  });

  test('extracts x-api-key header', () => {
    expect(extractApiToken({ headers: { 'x-api-key': 'xyz' } })).toBe('xyz');
  });

  test('returns empty when missing', () => {
    expect(extractApiToken({ headers: {} })).toBe('');
  });

  test('envApiKeyMatches is timing-safe and exact', () => {
    process.env.OLICOMM_API_KEY = 'olicomm_test_key';
    expect(envApiKeyMatches('olicomm_test_key')).toBe(true);
    expect(envApiKeyMatches('wrong')).toBe(false);
    expect(envApiKeyMatches('')).toBe(false);
  });

  test('sha256hex is stable', () => {
    expect(sha256hex('abc')).toBe(sha256hex('abc'));
    expect(sha256hex('abc')).not.toBe(sha256hex('abd'));
    expect(sha256hex('abc')).toMatch(/^[a-f0-9]{64}$/);
  });

  test('secretsEqual rejects different lengths', () => {
    expect(secretsEqual('aa', 'a')).toBe(false);
    expect(secretsEqual('same', 'same')).toBe(true);
  });

  test('servicePrincipal defaults to Igor admin', () => {
    const user = servicePrincipal();
    expect(user.name).toBe('Igor');
    expect(user.role).toBe('admin');
    expect(user.authType).toBe('api_key');
  });
});

'use strict';

/**
 * In-memory failure counter with lockout.
 * Default: 5 failures inside 15 minutes locks that key for 15 minutes.
 * Single Railway instance → in-memory is enough; it resets on redeploy.
 */

const FIFTEEN_MIN = 15 * 60 * 1000;

class FailureLimiter {
  constructor({ maxFailures = 5, windowMs = FIFTEEN_MIN, lockMs = FIFTEEN_MIN, now = () => Date.now() } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
    this.now = now;
    this.entries = new Map();
  }

  _get(key) {
    const t = this.now();
    let e = this.entries.get(key);
    if (e && e.lockedUntil && e.lockedUntil <= t) e = null;
    if (e && !e.lockedUntil && t - e.first > this.windowMs) e = null;
    if (!e) this.entries.delete(key);
    return e || null;
  }

  /** ms remaining on a lock, or 0 when the key may try again. */
  lockedFor(key) {
    const e = this._get(key);
    if (!e || !e.lockedUntil) return 0;
    return Math.max(0, e.lockedUntil - this.now());
  }

  /** Records a failure. Returns true if this failure caused (or continues) a lock. */
  fail(key) {
    const t = this.now();
    let e = this._get(key);
    if (!e) { e = { first: t, count: 0, lockedUntil: 0 }; this.entries.set(key, e); }
    e.count += 1;
    if (e.count >= this.maxFailures) e.lockedUntil = t + this.lockMs;
    this._prune();
    return !!e.lockedUntil;
  }

  reset(key) { this.entries.delete(key); }

  clearAll() { this.entries.clear(); }

  _prune() {
    if (this.entries.size < 5000) return;
    for (const key of [...this.entries.keys()]) this._get(key);
  }
}

/**
 * Client IP. Railway's edge proxy appends the real client address as the LAST
 * X-Forwarded-For entry, so we take the right-most value (client-supplied
 * entries to the left are ignored and can't be used to dodge the limiter).
 */
function clientIp(req) {
  const xff = String((req && req.headers && req.headers['x-forwarded-for']) || '');
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length) return parts[parts.length - 1];
  return (req && (req.ip || (req.socket && req.socket.remoteAddress))) || 'unknown';
}

module.exports = { FailureLimiter, clientIp, FIFTEEN_MIN };

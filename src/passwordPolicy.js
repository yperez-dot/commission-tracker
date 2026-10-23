'use strict';

const MIN_LENGTH = 12;
const MAX_BYTES = 72; // bcrypt ignores bytes past 72

const COMMON = new Set([
  'password', 'password1', 'password123', '123456789012', 'qwertyuiop12',
  'olicomm', 'olicomm123', 'healthexperts', 'letmein12345', 'welcome12345',
]);

/** Returns an error string, or null if the password is acceptable. */
function passwordProblem(password, { email = '', name = '' } = {}) {
  const pw = String(password || '');
  if (pw.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  if (Buffer.byteLength(pw, 'utf8') > MAX_BYTES) return `Password must be at most ${MAX_BYTES} characters`;
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common';
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be one repeated character';
  const local = String(email || '').toLowerCase().split('@')[0];
  if (local && local.length >= 4 && lower.includes(local)) return 'Password cannot contain your email name';
  const first = String(name || '').toLowerCase().split(/\s+/)[0];
  if (first && first.length >= 4 && lower.includes(first)) return 'Password cannot contain your name';
  return null;
}

module.exports = { passwordProblem, MIN_LENGTH, MAX_BYTES };

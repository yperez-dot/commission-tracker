# Two-factor sign-in (TOTP) and auth hardening

## How sign-in works

1. **Email + password.** The API checks the password and returns only a short-lived
   (5 minute) *mfa-pending* token. That token can't open any page or API; it only
   works on `/api/auth/mfa/*`.
2. **Code.**
   - Already set up → enter the 6-digit code from the authenticator app (or one
     backup code).
   - Not set up yet → OliComm shows a QR code. Scan it with Google Authenticator,
     Microsoft Authenticator, 1Password or Authy, type the code to confirm, and save
     the 10 backup codes (shown once). Nobody can use the app until this is done.
3. A full session token (12 hours) is issued only after step 2.

Sessions issued before this change (old 7-day tokens) stop working on deploy, so
everyone signs in again once and sets up two-factor.

## Required Railway variable (set BEFORE merging)

| Variable | What it is |
|---|---|
| `TOTP_ENCRYPTION_KEY` | 32 random bytes, base64 (or 64 hex chars). Encrypts each user's authenticator secret at rest (AES-256-GCM). |

Generate one on any machine:

```
openssl rand -base64 32
```

or

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste the output into Railway → Backend → Variables → `TOTP_ENCRYPTION_KEY`. Keep a copy
in your password manager. **Don't change or lose it**: if it changes, every saved
authenticator stops working and each person needs a 2FA reset.

If the variable is missing or malformed, the server logs a `SECURITY:` error and the
password step returns 503 for everyone (fails closed). API keys keep working.

Optional: `SESSION_TTL` (default `12h`).

## Recovery

- Lost phone → sign in with a backup code (each works once).
- Out of backup codes / lost everything → another admin opens **User Accounts** and clicks
  **Reset 2FA**. That user is signed out everywhere and sets up two-factor at next sign-in.
  Admins can't reset their own 2FA. API keys can't reset anyone's.
- New backup codes: `POST /api/auth/mfa/backup-codes` with a current code (old codes stop working).

## Limits and lockouts

- 5 wrong passwords for the same email from the same IP → 15 minute lock.
  20 wrong passwords from one IP (any emails) → 15 minute lock.
- 5 wrong codes for the same account from the same IP → 15 minute lock.
  10 wrong codes for one account from anywhere → 15 minute lock.
- A code can't be reused (replay protection); clock drift of ±30 seconds is accepted.
- Wrong email and wrong password give the same message and similar timing.
- Counters live in memory and reset on redeploy (one Railway instance).

## Security log

Table `auth_events` (created automatically): `login_failed`, `login_locked`,
`login_password_ok`, `login_success`, `mfa_failed`, `mfa_locked`, `mfa_enrolled`,
`mfa_reset`, `backup_code_used`, `backup_codes_regenerated`, `password_reset_by_admin`,
`user_created`, `user_deleted`. Admins can view it on **User Accounts → Show security log**
or `GET /api/auth/events`.

## Sessions

- Password reset, 2FA reset or deleting a user bumps `users.session_version`, which
  invalidates that user's existing tokens immediately.
- Each request re-reads the user's role from the database, so a role change applies
  on the next request.

## Service-to-service access

Unchanged: `Authorization: Bearer $OLICOMM_API_KEY`, `x-api-key`, or a hashed row in
`api_keys`. These skip 2FA by design (no human), so treat the keys like passwords and
revoke them (`api_keys.revoked_at`) if leaked. Anything that logged in with
email+password via `/api/auth/login` must switch to an API key.

## Schema (self-applying, idempotent)

On first auth request, under a Postgres advisory lock:
`users` gains `totp_secret_enc`, `totp_pending_secret_enc`, `totp_enabled_at`,
`totp_last_step`, `session_version`; new tables `user_backup_codes` (scrypt hashes) and
`auth_events`.

## Password policy (new and reset passwords)

At least 12 characters, at most 72 bytes, not a common password, not your email name or
first name. Existing passwords keep working; older hashes are upgraded to bcrypt cost 12
on next sign-in.

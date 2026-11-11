# OliComm Full Audit — Security, Quality, Bugs

**Date:** 2026-08-12  
**Scope:** Full repository (`yperez-dot/commission-tracker`)  
**Auditor:** Cursor Cloud Agent (independent pass)  
**Repo visibility:** Private GitHub repo (reduces blast radius; does **not** make leaked secrets safe)

---

## Verdict

**This system is not production-safe from a security standpoint.**  
Business logic and parsers show real care and iteration, but authorization is inconsistently applied, production database credentials are committed in plain text across ~28 files, JWT secrets are weak/defaulted, and several money-moving endpoints are callable by any logged-in user (and in one case, by anyone with network access — no auth at all).

If you only fix five things, fix these first:

1. Rotate and purge all leaked DB credentials + JWT secret  
2. Add auth to `routes/edit-commission.js`  
3. Lock down destructive routes (delete upload, BOB wipe, batch delete, data-fix endpoints) to admin  
4. Stop shipping one-off ops scripts with hardcoded Railway URLs in the app repo  
5. Treat agent isolation as broken until exact-match + per-resource checks exist

---

## Severity legend

| Level | Meaning |
|-------|---------|
| **P0** | Act now — active credential leak or unauthenticated write |
| **P1** | High — authz hole, PHI/financial exposure, destructive as any user |
| **P2** | Medium — quality/reliability that will cause wrong pay or outages |
| **P3** | Lower — maintainability / hygiene |

---

## P0 — Critical security

### 1. Production Postgres credentials committed in git

At least **28 tracked files** contain a live Railway Postgres connection string (host `metro.proxy.rlwy.net`, user `postgres`, password in cleartext). Examples:

- `fix-olicomm-agents-direct.js`
- `railway-query.js` (fallback URL)
- `get_user_credentials.js`
- `backfill-mbi-from-raw-data.js`
- `check-nhp-railway.js` (different password)
- dozens of `check_*.js` / `update-*.js` / `normalize-*.js` one-offs

**Impact:** Anyone with repo access (or a leaked clone) has full DBA access to production commission/MBI/client data.  
**Action:** Rotate Railway DB password immediately; revoke the old one; scrub from git history (`git filter-repo` / BFG); never commit connection strings again.

### 2. `.env` tracked in git with weak JWT secret

- `.gitignore` lists `.env`, but `.env` **is tracked** (`git ls-files` shows it).
- Contents include `JWT_SECRET=healthexperts-secret-change-in-production`.
- Same default is hardcoded as a fallback in `routes/auth.js` and again in `generate_token.js`.

**Impact:** Anyone who knows the secret can forge admin JWTs (`generate_token.js` already does this for Yahoska).  
**Action:** Rotate JWT secret on Railway; force logout all sessions; remove `.env` from tracking; fail hard if `JWT_SECRET` unset in production.

### 3. Unauthenticated commission edit / revert / audit API

`routes/edit-commission.js` is mounted at `/api` in `server.js` and **never calls `requireAuth`**.

Endpoints:

- `PUT /api/commission/:id/edit` — mutate commission / THEI / BSI / classification
- `POST /api/commission/:id/revert`
- `GET /api/commission/:id/audit`

**Impact:** Unauthenticated remote write to money fields. `editedBy` is a free-form client string — not tied to a real user.  
**Action:** Require auth + admin (or tightly scoped permission) immediately.

### 4. Unauthenticated GHL probe

`GET /api/ghl/test` has no auth. If `GHL_API_TOKEN` / `GHL_LOCATION_ID` are set, it proxies a live GHL search and returns opportunity counts / errors.

---

## P1 — High: authorization & data exposure

### 5. "Any authenticated user" can destroy data

These require login but **not admin**:

| Route | Risk |
|-------|------|
| `DELETE /api/files/uploads/:id` | Delete any upload (+ cascaded commission rows) |
| `DELETE /api/medicarepro/batch/:batch` | Wipe MedicarePro batch |
| `DELETE /api/agency-production/upload/:id` | Wipe production upload |
| `DELETE /api/agency-production/batch/:batch` | Wipe production batch |
| `POST /api/bob/bulk-delete` | Delete BOB by carrier or IDs |
| `DELETE /api/bob/:id` | Delete BOB client |
| `POST`/`PATCH /api/agent-statements` | Create/alter payment statements |
| `POST /api/files/fix-aetna-classifications` | Mass UPDATE classifications |
| `POST /api/records/fix-med-lob` | Mass UPDATE LOB |
| `POST /api/records/fix-aca-classifications` | Mass UPDATE ACA classifications |

An agent account (or a stolen agent JWT) can erase or rewrite production books.

### 6. Agent isolation is porous

- Commission filtering uses `agent_name ILIKE '%${req.user.name}%'` — substring match, not exact.
- Even with that filter, agents can still hit **unscoped** datasets: payroll summary (all agents), agent statements, MedicarePro, agency production, recon exports, LOA export (`/:id/export` lacks `requireAdmin` while list/get require it).
- Frontend admin gates are UI-only; API must enforce.

### 7. Privilege escalation via role assignment

`POST /api/auth/users` accepts arbitrary `role` from the body (`role || 'agent'`). A compromised admin session (or buggy client) can mint more admins with no allowlist.

### 8. PHI / sensitive financial data handling

Commission `raw_data` and dedicated MBI backfill scripts store Medicare Beneficiary Identifiers. Combined with open DB credentials and weak JWT:

- HIPAA-relevant identifiers are in a DB reachable with leaked passwords
- No encryption at rest beyond whatever Railway provides
- Tokens live in `localStorage` (XSS → full session theft)
- No rate limiting, helmet, CSRF strategy, or login lockout

### 9. SSL verification disabled

`db/database.js` and many scripts use `ssl: { rejectUnauthorized: false }` in production — MITM risk on DB connections.

### 10. Dangerous "ops" endpoints left in the running app

- `DELETE /api/admin/cleanup-upload-374` hardcoded in `server.js` ("temporary")
- Schema introspection via `GET /api/auth/_schema/:table` (gated by `SETUP_SECRET`, OK if secret strong and set; still should be removed)
- Startup job scans **all** `commission_records` and UPDATEs agent names one-by-one (`server.js` `normalizeOnStartup`) — race/perf risk on every deploy

### 11. Hardcoded weak passwords in helper scripts

`get-auth-token.js` attempts production login with `temp123` / `test123` against the live Railway URL.

---

## P2 — Bugs & correctness risks

### 12. Carrier normalization collapses "United of Omaha" → UHC

Duplicated in `routes/records.js`, `src/utils/reconMatching.js`, `AgencyProductionRecon.js`, `MissingRenewals.js`:

```js
if (c.includes('uhc') || c.includes('united')) return 'unitedhealthcare';
```

**"United of Omaha"** (BSI life carrier) contains `united` → mis-keyed as UnitedHealthcare. That poisons recon matching and agency isolation logic that already treats United of Omaha as a BSI carrier.

### 13. Transaction bug in commission revert

In `edit-commission.js` revert handler, the code begins a transaction on `client` but reads with `pool.query(...)`. The subsequent rollback/commit may not cover that read path cleanly; error handling can leave inconsistent state under concurrency.

### 14. `manual-payments` module is authless and unmounted

`routes/manual-payments.js` has zero auth, JSON-file storage under `data/`. It is **not** registered in `server.js`, but the frontend (`Reconciliation.js`) still calls `/manual-payments`. Feature is half-dead / inconsistent.

### 15. Agency override header trust model

`X-Agency-Override` is accepted for admins and always sent from the frontend. Logic is mostly admin-gated on the server for records, but the pattern is easy to get wrong on new routes (several routes ignore agency filtering entirely).

### 16. Historical payroll / ACA correctness debt

Repo docs (`CRITICAL_ACA_PAYROLL_ISSUE.md`, etc.) document real production pay bugs (`producer_payable = 0`, missing Eduardo, statement exports showing `$0.00`). Some fixes appear later in git history; there is no automated regression suite proving they stay fixed. **Money correctness relies on manual checklists.**

### 17. Dependency vulnerabilities

`npm audit`: **43** issues (**2 critical, 21 high**). Notably:

- `xlsx` — Prototype Pollution + ReDoS (you parse untrusted carrier uploads with it)
- `react-scripts` transitive chain — high

Uploading malicious Excel/PDF is a realistic attack surface for an authenticated agent.

### 18. Large request bodies / no abuse controls

`express.json({ limit: '50mb' })`, 20MB uploads, 5-minute server timeouts — fine for Aetna files, but with no rate limits this is a cheap DoS / cost amplifier (Anthropic calls on upload).

---

## P3 — Code quality & architecture

### 19. God-file: `routes/files.js` (~5,174 lines)

Parsers, AI mapping, upload orchestration, BSI split rules, one-off fixes, and HTTP routes live in one file. This is the #1 maintainability risk. A parser bug or merge conflict here is how payroll breaks.

### 20. Documentation sprawl vs. product code

Root is littered with session notes, deploy panic checklists, and one-off SQL/JS fix scripts (~100+ operational artifacts). Signal-to-noise for new contributors is poor; secrets hide in the noise.

### 21. Schema managed by `CREATE/ALTER IF NOT EXISTS` on boot

`db/database.js` mutates schema at startup; SQL migrations exist separately and are inconsistently applied via ad-hoc scripts. No single source of truth; drift is inevitable.

### 22. No real test harness

Many `test-*.js` scripts are manual probes against production DB, not CI-runnable unit/integration tests. No `npm test`. Parser regressions are discovered in production pay cycles.

### 23. Duplicated business rules

Carrier normalization, name normalization, BSI carrier lists, and recon matching are copy-pasted across frontend pages and backend routes — already flagged with `TODO(Commit 8)` comments that were never finished.

### 24. Frontend auth model

- JWT in `localStorage` (7-day expiry, no refresh/rotation/revocation list)
- Client-side page router (no React Router) — workable, but admin pages only hidden in nav
- CORS locked to one Netlify origin + localhost — good, but credentials/header combo is broad

### 25. Error leakage

Many handlers return `err.message` to clients; global error middleware returns `message: err.message`. Useful for debugging; bad for production (schema/query disclosure).

---

## What is working / credit where due

Honest positives — this is not a toy:

- Parameterized SQL is used in most places (dynamic WHERE clauses are generally built from fixed column names + bound params; sort columns are allowlisted in records).
- bcrypt for password hashing; JWT auth exists and many admin routes are correctly gated.
- Deep domain investment: BSI 50/50 split, ACA pass-through, override recon, plan-change detection, audit trail design for manual edits.
- Duplicate-upload UX (409 soft warning) is thoughtfully built.
- Prior internal audits (`AUDIT_RESULTS_2026-06-18.md`) show process discipline around **parser correctness** — but they focused on financial parse accuracy, not security.

---

## Recommended remediation order

1. **Credential incident response** — rotate Railway Postgres + JWT + any passwords that may match `temp123`; invalidate sessions; audit DB access logs if available.  
2. **Auth hotfix PR** — `requireAuth` + `requireAdmin` on edit-commission; admin-only on all DELETE/mass-UPDATE routes; remove or fully gate GHL test; remove cleanup-374.  
3. **Purge secrets** — delete one-off scripts with embedded URLs from the repo (or move to a private ops vault); untrack `.env`; rewrite history.  
4. **Agent tenancy** — exact agent match; deny by default on payroll/BOB/medicarepro/agency-production for non-admin.  
5. **Parser module split** — carve `files.js` into `parsers/*` + thin route file; shared `normalizeCarrier` that special-cases United of Omaha / UnitedHealthcare.  
6. **Tests that protect money** — golden-file parser tests + payroll aggregate fixtures in CI; stop probing prod from scripts checked into main.  
7. **Hardening** — helmet, rate limit login, reject missing JWT_SECRET in prod, shorter token TTL, httpOnly cookie session if feasible, enable proper SSL verify.

---

## Scorecard (honest)

| Area | Score (1–10) | Notes |
|------|--------------|-------|
| Security | **2** | Live DB passwords in repo; unauthenticated money edits |
| AuthZ consistency | **3** | Admin checks scattered; many destructive routes open to any user |
| Data integrity / payroll correctness | **5** | Domain logic is serious; insufficient automated proof |
| Code organization | **3** | 5k-line route file; root full of ops debris |
| Operability / deploy hygiene | **4** | Railway/Netlify work, but panic docs and leftover "temporary" endpoints |
| Test coverage | **2** | Manual prod scripts ≠ tests |
| Overall production readiness | **3** | Usable internally **only if** you accept high breach + wrong-pay risk |

**Bottom line:** OliComm has valuable domain logic and has clearly been battle-tested for commission parsing. It has **not** been engineered as a secure multi-user financial system. Treat the credential leak as an incident, then close the unauthenticated edit hole before the next feature.

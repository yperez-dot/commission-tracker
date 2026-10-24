# OliComm Platform Audit — 2026-08-15

Full review of security, bugs, incomplete features, and recommended additions for the THEI/BSI commission tracker (OliComm).

**Scope:** React frontend, Express API, Postgres, parsers, recon, payroll, Missing Renewals, auth.  
**Method:** Code review + live DB checks (Missing Renewals / Humana) + prior production incidents.

---

## Executive summary

| Area | Grade | One-line |
|------|-------|----------|
| Core monthly loop (upload → recon → pay → renewals) | Strong | Real and used in production |
| Security / secrets | Critical gaps | DB passwords + JWT secret in git; authz holes |
| Matching / money logic | Fragile | Multiple `normName`/`normCarrier` copies; Sales Recon drift |
| Missing Renewals | Improved | Stub-month default fixed (#25); Humana chase list is real |
| Incomplete features | Medium debt | Plan-change UI, edit modal, manual-pay, NHP periods, notes |
| Ops / observability | Weak | Ping-only health; boot-time full-table rewrite; one-off admin endpoints |

**Do first (this week):** rotate leaked credentials, lock payroll/BOB mutations to admin, unify carrier/name normalization (Omaha + middle initials).

---

## 1. Security

### CRITICAL — rotate immediately

1. **Production DB credentials committed** in ~30 tracked scripts (`railway-query.js`, `fix-olicomm-agents-direct.js`, `check-nhp-railway.js`, import/repair scripts, etc.). Anyone with repo access can hit production Postgres.
2. **`JWT_SECRET=healthexperts-secret-change-in-production`** tracked in `.env` (despite `.gitignore`) and hardcoded in `generate_token.js` (mints admin tokens).
3. **Hardcoded login passwords** in `get-auth-token.js` (`temp123` / `test123`).

**Actions:** Rotate Railway DB password(s) + JWT secret; force password resets for any seeded/temp accounts; purge secrets from git history; keep only `DATABASE_URL` / env-based config.

### HIGH — authorization & injection

| Finding | Where | Risk |
|---------|-------|------|
| SQL string interpolation of `req.user.name` | `routes/bob.js` (agent filter `ILIKE '%${name}%'`) | Agent-scope bypass / SQLi if JWT name forged |
| Payroll payout mark paid/unpaid | `routes/payroll.js` PUT/DELETE — `requireAuth` only | Any logged-in user can rewrite “paid” |
| Agent statements create/patch | `routes/agent_statements.js` | IDOR — mutate any agent’s statement |
| BOB PATCH / policy-status / upload | `routes/bob.js` | Agents can alter other books / term policies |
| Cross-agent financial reads | override/lina/medicarepro/sales-tracker | Commission/client leakage |
| Upload filename from client | `routes/files.js`, `bob.js` | Path traversal via `originalname` |
| Commission upload not admin-only | `routes/files.js` | Injected statements → wrong payroll |

### MEDIUM

- No login rate limiting (`routes/auth.js`)
- 7-day JWTs, no revocation on password change
- Postgres `ssl: { rejectUnauthorized: false }` (`db/database.js`)
- 50mb JSON body limit; some multers lack `fileSize`
- Stored XSS sinks: `dangerouslySetInnerHTML` / `innerHTML` with client names (`BookOfBusiness.js`, upload preview modals, Missing Renewals toast)
- Temp `DELETE /api/admin/cleanup-upload-374` still mounted (`server.js`)
- Weak password policy on create/reset

### Already solid

- Most routes behind JWT; many destructive ops use `requireAdmin`
- bcrypt password hashes; JWT_SECRET required at boot
- Parameterized queries common; records ORDER BY allowlisted
- CORS allowlist (not `*`); main upload size + extension filter
- Manual commission edit has audit trail (`edit-commission.js`)

---

## 2. Bugs & money logic

### Confirmed

| # | Bug | Impact |
|---|-----|--------|
| 1 | **Sales Recon `normName` ≠ Missing Renewals** — Recon does not strip trailing middle initials on `LAST, FIRST L.` | False unpaid/paid |
| 2 | **`United of Omaha` → UHC** in Recon / Agency Recon / Missing Renewals / records normalize (files.js already carves out Omaha) | Life book matches Medicare UHC |
| 3 | **Empty carrier `includes('')`** is true in JS — blank carrier matches anything | False matches |
| 4 | **Sales Recon period-agnostic** + displays first match commission (oldest by `created_at ASC`) | Wrong paid status/amount |
| 5 | **Hard caps** (`limit=5000`/`50000`) ignored `total` on Recon/Payroll/Agency Recon | Silent undercount |
| 6 | **Manual payments UI dead** — FE calls `/manual-payments`; route not mounted in `server.js` | Feature no-ops |
| 7 | **`edit-commission` revert** uses `pool.query` inside `client` transaction | Broken isolation |
| 8 | **Boot-time full-table agent rename** on every deploy (`server.js`) | Race with uploads; slow under AEP |
| 9 | **Missing Renewals FE still duplicates** name/carrier helpers for client history drawer | Dual-maintenance drift |
| 10 | Stub Aug/Sep periods still selectable (default fixed in #25) | Can still show “all missing” if picked |

### Likely / fragile

- Agent tenancy via `ILIKE '%name%'` (substring “Perez” leakage)
- First-year renewals skip only if `effective_date` parses
- Held-licensing still UHC-skewed in places
- Dashboard/BOB silent `catch` failures
- No AbortController on fast period switches (stale UI)

### Missing Renewals (prod spot-check Jul 2026)

- Defaulting to Sep stub was the “all missing” illusion — **fixed in #25**
- Jul Humana **was uploaded**; 61 Humana missings (~48 unique) are real absences, not matcher failure
- Cross-carrier search: almost no plan moves in DB; Melissa Albury = Humana **dental** + UHC MA (dual product)

---

## 3. Incomplete / abandoned

| Item | Status |
|------|--------|
| Plan-change detector | Backend runs post-upload; **no UI** |
| `EditCommissionModal` | Built; **never wired** into All Data / recon |
| Manual payments | Route exists; **not mounted** |
| Missing Renewals notes | Status badges live; notes always `null` |
| Smart renewals auto-resolve on upload | Spec’d; not built |
| NHP statement-month → `payment_period` | Helper exists; still uses upload-date month |
| Client commission history modal | Spec’d; not built |
| Email branded statements | Spec’d; download-only |
| GHL | Stub `/test` only |
| Notion sales-tracker | Mounted; fragile without `NOTION_TOKEN` |
| MedicarePro SUP type normalization | Still open |
| Aetna MBI bleed cleanup | Code fixed; data decision pending |
| 1099 / ADP UI | API exists; no year-end page |

---

## 4. Architecture snapshot

```
Uploads (statements / MedicarePro / agency prod / BSI)
  → commission_records + side tables
  → Plan-change detect (backend only)
Recon: Sales · Override · Missing Renewals · Writer chargebacks
Payroll: Agent payouts · House/Lina/LOA · History
```

- **Frontend:** `src/App.js` + `src/pages/*` (Netlify)
- **API:** `server.js` + `routes/*` (Railway) — `files.js` ~5.3k LOC is the parser core
- **Engines:** `missingRenewalsLogic`, `overrideRateEngine` / statement builders, `bsiBookAttribution`, `reconHelpers`, `theiPrincipalAgents`
- **Tests:** Strong on engines/statements; weak on Sales/Agency recon matchers, payroll caps, parsers in CI

---

## 5. What to add next (ranked)

### P0 — this week
1. Credential rotation + secret purge  
2. Admin-gate payroll mutations, agent-statements writes, BOB policy/upload  
3. Shared `normName` / `normalizeCarrier` (Omaha carve-out + MI strip) used everywhere  
4. Fix empty-carrier match; warn/paginate when `records.length < total`

### P1 — quick wins
5. Mount manual-payments **or** remove UI  
6. Wire `EditCommissionModal` into All Data  
7. Missing Renewals free-text notes  
8. NHP period-from-statement-month  
9. Remove cleanup-374 + stop boot full-table normalize (migrate to one-shot script)

### P2 — product leverage
10. Plan-change review UI (detector already runs)  
11. Auto-resolve Missing Renewals when upload pays a chased client  
12. Within-batch upload dedupe guard (Upload 374 class)  
13. Email statements from Payroll  
14. Client history drill-down on All Data  
15. 1099/ADP export page  

### P3 — polish / ops
16. Login rate limit + shorter JWT / version bump  
17. Escape XSS sinks; helmet/CSP  
18. `/api/health` with DB check  
19. Structured upload audit log (carrier counts, skips, splits)  
20. Parser golden-file CI + recon matcher unit tests  

---

## 6. Suggested workstreams

| Stream | Outcome |
|--------|---------|
| **Security hardening** | Rotate secrets; admin gates; SQLi fix; upload filename harden |
| **Matching unification** | One shared module; delete FE copies; Omaha + MI + empty-carrier tests |
| **Close orphans** | Manual pay, edit modal, plan-change UI, renewals notes |
| **AEP readiness** | In-batch dedupe; remove boot normalize; health/observability; NHP periods |

---

## 7. Out of scope / not found broken

- Missing Renewals **server** path (`/bob/missing-renewals-check`) is coherent after #25  
- Override/Lina/THE remittance statement builders have solid unit tests  
- Agency switcher + THEI-only recon nav is intentional and clear  

---

*Generated by Cloud Agent audit run. Prioritize P0 security before AEP volume.*

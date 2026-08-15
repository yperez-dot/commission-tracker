# House / Override Statement Takeover Readiness

**Repo:** commission-tracker · audited on `main` @ `f781e98` (2026-08-15)  
**Parties:** Lina, BSI, THEI, Integrity, Marco

---

## Executive verdict

| Party | Status | One-line |
|-------|--------|----------|
| **Lina** | **Needs work** | UI + Excel builder ready; holds / Jan–May BSI PDF parity / Med Supp peel gaps block clean takeover |
| **BSI** | **Needs work** | House Excel wired; correctness depends on clean `bsi_share` from uploads + Alba peels; historical months messy |
| **THEI** | **Needs work** | NHP vs BSI remittance split is wired; double-feed / remittance half-model vs full-pot risk remains |
| **Integrity** | **Blocked** | UI exists, but NHP stores Chris/Horacio cuts in `sub_agent_override` while Integrity statements read `producer_payable` |
| **Marco** | **Needs work** | House Excel wired for BSI-book / upload peels; NHP path never applies Marco $10; remittance rows never set `sub_agent_override` |

### Top 3 engineering fixes (by statement correctness impact)

1. **NHP Integrity field mapping** — Write Christian/Horacio (and CAM 50%) producer cuts to `producer_payable`, not `sub_agent_override`, so House Statements type `integrity` includes NHP money. Today those dollars are stranded. (`routes/files.js` ~1569–1590 vs `overrideStatementBuilder.js` ~168–181)
2. **Unify override split application** — Route NHP / THE remittance / BSI book through `overrideSplitMath.splitFullOverridePot` (with source-aware half vs full pot) so Marco $10 and Integrity 50/25/25 are consistent on every feed. Today NHP skips Marco entirely; remittance sets Marco peel to 0.
3. **Lina holds + Med Supp / needsReview peel** — Statement Excel omits Held balances BSI showed; rate engine has no Med Supp / United of Omaha table (falls to `needsReview` → full amount in `producer_payable`, zero THEI/BSI peel). Blocks “same as BSI PDF” takeover.

---

## 1. Where admins create / download statements (UI)

| Location | Nav | What it does |
|----------|-----|--------------|
| **Agent Payouts** | Payroll → Agent Payouts (`src/App.js` `payroll`, `src/pages/Payroll.js`) | Lists producer payables. **Lina** gets branded Excel via `/api/lina-statements/export`. Other agents: CSV. Marco/Integrity **excluded** from this tab (agency peels). |
| **House Statements** | Payroll → House Statements (`payroll-overrides`, `HouseOverridesPanel`) | Type + period → preview → Excel per payee / export all / export all types. Calls `/api/override-statements/*`. |
| **LOA Statements** | Payroll → LOA | Manual LOA comps (e.g. Carolina) — separate from house overrides. |
| **Upload feeds** | Upload / BSI Statements | Populate `commission_records` shares that statements later sum. |

**House Statement types exposed in UI** (`routes/override-statements.js` `OVERRIDE_UI_TYPES`):

- `thei_nhp` — THEI share, NHP source only  
- `thei_bsi` — THEI share, BSI / BSI_PAYEE remittance sources  
- `bsi_override` — BSI share  
- `marco` — Marco $10 peel  
- `integrity` — Integrity producer_payable  

**Not in UI:** combined `thei_override`, builder type `alba` (Lina uses dedicated route), CSV export (CLI/backup only), `buildTheiBsiBreakdown` (no route).

---

## 2. Party → source modules

| Party | Statement assembly | Amount field | Upstream money / split | Excel / export |
|-------|-------------------|--------------|------------------------|----------------|
| **Lina** | `linaCompensationStatement.js` + `routes/lina-statements.js` | `producer_payable` | `bsiBookAttribution` + `overrideRateEngine` on BSI book; Agent Payouts filter | Lina Excel workbook |
| **BSI** | `overrideStatementBuilder` type `bsi_override` | `bsi_share` | Upload splits (`files.js`), remittance mirror, Alba peel | `overrideExcelStatement` |
| **THEI** | `thei_nhp` / `thei_bsi` (scripts: `thei_override`) | `thei_share` | NHP parser; THE remittance (`theRemittanceStatement`); BSI book peels; Agency Override | `overrideExcelStatement` |
| **Integrity** | type `integrity` | `producer_payable` on Agency Override | `splitFullOverridePot` / upload Integrity branch / remittance ×4 gross | House Excel |
| **Marco** | type `marco` | `sub_agent_override` | `splitFullOverridePot` Marco branch / upload Marco branch | House Excel |

Shared schedule lists: `payeeSchedules.js` (`STATEMENT_TYPES`, agent matchers).

---

## 3. Plain-language money + formulas

### Lina (agent production — not House Statements)

**Included:** New Business / Renewal / Chargeback / Agent Commission / classification `commission` for Alba/Lina name variants. **Excluded:** Agency Override, Held.

**Field:** `producer_payable`  
**Formula (BSI book peel):**  
`totalOverride = rate(carrier, state, yearType)`  
`thei_share = bsi_share = totalOverride / 2`  
`producer_payable = commission − totalOverride`  
(`overrideRateEngine.js` ~354–356; `bsiBookAttribution.js` ~188–191)

**Statement balance:** `Σ producer_payable` (gross positives + chargebacks).

### THEI (house)

**Included:** Agency Override rows with `thei_share ≠ 0` (or commission fallback), **plus** Alba rate-peeled agent-production rows that still carry `thei_share`.  
**NHP report:** `source = NHP` only.  
**BSI remittance report:** `source ∈ {BSI, BSI_PAYEE}`.

**Field:** `thei_share`  
**Standard Agency Override (full pot):** `thei = pot / 2`  
**After Marco $10:** `thei = (pot − ±10) / 2`  
**Integrity:** `thei = pot × 0.25`  
**THE remittance half-model:** statement amount already = THEI half → `thei = amount`, `bsi = amount`, `gross = 2×`  
**Alba peel:** `thei = rate/2` on production rows  

(`overrideSplitMath.js` 29–101; `overrideStatementBuilder.js` 93–131; `theRemittanceStatement.js` 236–248)

### BSI (house)

Same row universe as THEI house (overrides + Alba peels). **Field:** `bsi_share`. Twin of THEI on standard/Marco/Alba; Integrity also 25%.

### Integrity (agency schedule — House Statements)

**Included:** Agency Override only, agents matching Christian Munoz / Horacio Mendieta / CAM Insurance Solutions Corp.

**Field:** `producer_payable`  
**Full-pot formula:** `producer = pot × 0.5`, `thei = pot × 0.25`, `bsi = pot × 0.25`  
**Remittance (amount = THEI’s 25%):** `thei = amt`, `bsi = amt`, `producer = amt × 2`, `gross = amt × 4`

### Marco (IRS Swan peel — House Statements)

**Included:** Agency Override for Marco agent list (Jendy excluded from period ≥ `202606`).

**Field:** `sub_agent_override`  
**Formula:** first override occurrence per policy with `|pot| ≥ 10`: `sub = ±10`, then `thei = bsi = (pot − sub) / 2`; later occurrences: no $10, plain 50/50.

---

## 4. Unit tests — coverage & adequacy

| Area | Tests | Adequate? |
|------|-------|-----------|
| `payeeSchedules` + `overrideStatementBuilder` | `overrideStatements.test.js` (~18 cases) | **Good** for classify/build; thin on chargeback signs, multi-payee Integrity, source edge cases |
| `overrideSplitMath` | same file | **Good** for happy paths; no `|pot| < 10` Marco, no Jendy cutoff in split math tests |
| `overrideExcelStatement` | `overrideExcelStatement.test.js` (3) | **Smoke only** — titles/filenames/dates, not money totals |
| Lina Excel builder | `linaCompensationStatement.test.js` (4) | **Adequate** for filter + balance; no Held / workbook cell asserts |
| BSI→Lina PDF fixture parser | `bsiPayeeCompensationStatement.test.js` (5) | Good for sample parse; **not** production statement math |
| BSI Alba peel | `bsiBookAttribution.test.js` (8) | Strong for UHC peel; limited carrier matrix |
| Rate engine | `commissionEngine.test.js` (large) | Strong rates/certGap/orphan gate |
| THE remittance | `theRemittanceStatement.test.js` (4) | Good sample fixture; no Marco remittance assert |
| Routes / Payroll UI | — | **None** for `/override-statements` or `/lina-statements` HTTP |

**Gap:** no test that NHP Chris/Horacio fixed cuts land on Integrity statements; no test that NHP Marco agents populate `sub_agent_override`.

---

## 5. Bugs / TODOs / blockers for takeover

| Severity | Issue | Why it blocks |
|----------|-------|---------------|
| **P0** | NHP Integrity cuts in `sub_agent_override`, statements read `producer_payable` | Integrity House Excel understates / misses NHP producer pay |
| **P0** | NHP never applies Marco $10 | Marco statements empty for NHP book; THEI/BSI overstated by $10/policy |
| **P1** | THE remittance always `subAgentOverride = 0` | Marco peel not reconstructible from remittance-only data |
| **P1** | Lina Holds omitted from Excel; footer says “pending BSI confirmation” | BSI PDF Balance ≠ OliComm detail (documented $210 / $100 gaps Jun/Jul held) |
| **P1** | Med Supp / United of Omaha: no rate table → `needsReview` → no THEI/BSI peel | Wrong Lina vs house split on those products |
| **P1** | UHC non-SNP PPO rates “not wired” (`overrideRateEngine.js` ~97–98) | Wrong pot if PPO appears on BSI Plan Type |
| **P1** | Freedom / Elevance `certGap` | Contractual override not paid; flagged but easy to mis-pay if ignored |
| **P2** | Dual feeds (THE remittance + BSI Agency Override same policy) | Phantom double house pay without `shouldProcessBSIOverrideRow` discipline |
| **P2** | Historical THEI Jan–Jul “messy — reconcile before paying” | Operational, not just code |
| **P2** | Lina Jan–May BSI PDF compare still pending | Cannot claim parity takeover yet |
| **Partial payments** | Sales Recon tracks agent deposit partials (`salesReconPayment.js`); **not** wired into House Statement builders | House Excel always full Σ shares for period — no partial-pay statement mode |

---

## 6. Orphan / missing UI wiring

| Exists in code | Reachable from admin UI? |
|----------------|--------------------------|
| `STATEMENT_TYPES.THEI_OVERRIDE` combined | **No** — scripts (`export-override-statements.js`, `generate-thei-override-statements.js`) only; UI uses NHP/BSI split |
| `STATEMENT_TYPES.ALBA` in `overrideStatementBuilder` | **No** — production Lina uses `linaCompensationStatement` + Agent Payouts |
| `buildTheiBsiBreakdown` | **No** API / UI |
| CSV `/override-statements/export` | **No** UI (Excel only); CLI ok |
| `bsiPayeeCompensationStatement` | Parse-only fixture for BSI→Alba PDF layout; not a download path |
| LOA Statements | Wired (separate product) |

**Intentionally separated (not orphans):** Lina on Agent Payouts; Marco/Integrity on House Statements only.

---

## Key formula line refs

```29:84:src/overrideSplitMath.js
function splitFullOverridePot(pot, opts = {}) {
  // Integrity: 50 / 25 / 25
  // Marco: ±$10 then 50/50 remainder
  // else: 50/50
}
```

```90:101:src/overrideSplitMath.js
function splitTheRemittanceHalf(halfAmount) {
  // gross = 2× half; thei = bsi = half
}
```

```117:197:src/overrideStatementBuilder.js
function classifyOverrideLine(row, statementType) {
  // THEI → thei_share; BSI → bsi_share; Marco → sub_agent_override; Integrity/ALBA → producer_payable
}
```

```354:356:src/overrideRateEngine.js
  const theiShare = Math.round(totalOverride * 0.5 * 100) / 100;
  const bsiShare  = Math.round(totalOverride * 0.5 * 100) / 100;
  const albaComp  = Math.round((commission - totalOverride) * 100) / 100;
```

```236:248:src/theRemittanceStatement.js
    if (isIntegrityAgent(agent)) {
      // thei=bsi=amount; producer=2×; gross=4×
    } else {
      const split = splitTheRemittanceHalf(amount);
    }
```

```1569:1590:routes/files.js
        if (isChristianOrHoracio && isSpecialCarrier && isNewBusiness && grossCommission > 0) {
          subAgentOverride = fixedRate;  // ← should feed Integrity producer_payable
          producerPayable = 0;
        }
```

---

## Readiness summary

- **Lina — Needs work:** Download path ready; holds + Med Supp/Omaha peel + Jan–May PDF parity remaining.  
- **BSI — Needs work:** Export ready; depends on upload-time `bsi_share` quality and historical cleanup.  
- **THEI — Needs work:** Split NHP/BSI UI ready; feed dual-model and Integrity/Marco upstream bugs affect balances.  
- **Integrity — Blocked:** Statement UI ready but NHP producer dollars not in `producer_payable`.  
- **Marco — Needs work:** BSI/upload path OK; NHP + remittance paths do not populate peel field.

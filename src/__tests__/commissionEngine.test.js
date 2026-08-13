/**
 * Unit Tests — OliComm Commission Engine
 *
 * Target file: src/overrideRateEngine.js
 *
 * Four test areas:
 *   1. Excel serial-date conversion         [PENDING — excelSerialToDate() not yet implemented]
 *   2. Product family canonicalization      [PENDING — canonicalizeProductFamily() not yet implemented]
 *   3. Composite key normalization          [PENDING — sortedTokenKey() not yet implemented]
 *   4. No financial output for unresolved   [LIVE    — calculateAlbaOverrideSplit()]
 *
 * Live helper tests (bonus, all functions exported from overrideRateEngine.js):
 *   5. resolveYearType()
 *   6. resolveAetnaStateGroup()
 *   7. calculateAlbaOverrideSplit() — full split math (happy paths)
 *   8. shouldProcessBSIOverrideRow()
 *   9. OVERRIDE_RATE_TABLE data integrity
 *
 * No DB mocking needed: overrideRateEngine.js is pure computation with no I/O.
 */

'use strict';

const {
  calculateAlbaOverrideSplit,
  shouldProcessBSIOverrideRow,
  resolveYearType,
  resolveAetnaStateGroup,
  OVERRIDE_RATE_TABLE,
  AETNA_FL_PLAN_CROSSWALK,
} = require('../overrideRateEngine');

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper: verify no financial output on a needsReview result
// ─────────────────────────────────────────────────────────────────────────────
const FINANCIAL_FIELDS = ['theiShare', 'bsiShare', 'albaComp', 'totalOverride'];

function expectNoFinancials(result) {
  FINANCIAL_FIELDS.forEach((field) => {
    expect(result[field]).toBeUndefined();
  });
}

// =============================================================================
// 1. Excel serial-date conversion
//
// TODO: implement excelSerialToDate(serial) in overrideRateEngine.js (or a new
//       src/utils/dateUtils.js) and export it.
//
//       Algorithm:
//         - Excel epoch: Jan 1 1900 = serial 1
//         - Formula: new Date(Date.UTC(1900, 0, 1) + (serial - 1) * 86400000)
//         - Edge: Excel treats 1900 as a leap year; serial 60 is "Feb 29 1900"
//           (a phantom date). Adjust: if serial >= 60, subtract 1 day.
//         - Return { year, month, day } plain object (month is 1-indexed).
//         - Return null for null, undefined, NaN, 0, or negative values.
// =============================================================================
describe('excelSerialToDate()', () => {
  // TODO: export excelSerialToDate from overrideRateEngine.js (or dateUtils.js)
  //   const { excelSerialToDate } = require('../overrideRateEngine');
  //   or: const { excelSerialToDate } = require('../utils/dateUtils');

  it.todo('46023 → { year: 2026, month: 1, day: 1 }  (Jan 1 2026)');
  it.todo('45931 → { year: 2025, month: 11, day: 1 } (Nov 1 2025)');
  it.todo('46174 → { year: 2026, month: 6, day: 1 }  (Jun 1 2026)');
  it.todo('null → null');
  it.todo('undefined → null');
  it.todo('NaN → null');
  it.todo('0 → null (invalid — Excel serial 0 is "Jan 0 1900", treated as absent)');
  it.todo('negative number → null');
});

// =============================================================================
// 2. Product family canonicalization
//
// TODO: implement canonicalizeProductFamily(product, productType) in
//       overrideRateEngine.js and export it.
//
//       Input signals (from Humana BSI CSV observed values):
//         product col:     "Medicare Advantage HMO" | "Medicare Advantage PPO" |
//                          "MAPD" | "PDP" | "Med Supp Plan G"
//         productType col: "Medicare Advantage" | "Prescription Drug" | ""
//
//       Rules (in priority order):
//         - Both MA and PDP signals present → 'AMBIGUOUS'
//         - Contains 'MA' / 'MAPD' / 'Medicare Advantage' (either field) → 'MA_MAPD'
//         - Contains 'PDP' / 'Prescription Drug' (either field) → 'PDP'
//         - Contains 'Med Supp' / 'Medigap' / 'Supplement' → 'MED_SUPP'
//         - Null, undefined, or both empty → 'UNKNOWN'
//         - Unrecognized combination → 'UNKNOWN'
// =============================================================================
describe('canonicalizeProductFamily()', () => {
  // TODO: export canonicalizeProductFamily from overrideRateEngine.js
  //   const { canonicalizeProductFamily } = require('../overrideRateEngine');

  // Real observed values from Humana BSI CSV ─────────────────────────────────
  it.todo('("Medicare Advantage HMO", "Medicare Advantage") → "MA_MAPD"');
  it.todo('("Medicare Advantage PPO", "Medicare Advantage") → "MA_MAPD"');
  it.todo('("MAPD", "")                                     → "MA_MAPD"');
  it.todo('("PDP", "Prescription Drug")                     → "PDP"');
  it.todo('("PRESCRIPTION DRUG", "")                        → "PDP" (case-insensitive)');

  // Med Supp ─────────────────────────────────────────────────────────────────
  // Accept either 'MED_SUPP' (if implemented) or 'UNKNOWN' (if not yet handled)
  it.todo('("Med Supp Plan G", "") → "MED_SUPP" (or "UNKNOWN" if not yet implemented)');

  // Edge / null cases ────────────────────────────────────────────────────────
  it.todo('(null, null)                                      → "UNKNOWN"');
  it.todo('("", "")                                          → "UNKNOWN"');

  // Ambiguous: both MA and PDP signals present ───────────────────────────────
  it.todo('("Medicare Advantage HMO", "PDP") → "AMBIGUOUS" (conflicting signals)');
});

// =============================================================================
// 3. Composite key normalization — crosswalk join key (sortedTokenKey)
//
// TODO: implement sortedTokenKey(name) in overrideRateEngine.js (or nameUtils.js)
//       and export it.
//
//       Algorithm (mirrors the SQL crosswalk join used in OliComm dedup):
//         1. Coerce to string; return '' for null/undefined
//         2. Uppercase
//         3. Remove punctuation (commas, periods, apostrophes, hyphens, etc.)
//         4. Split on whitespace
//         5. Drop tokens whose length === 1 (middle initials: "F", "A", etc.)
//         6. Sort remaining tokens alphabetically
//         7. Join without separator
//
//       "PABLO ROBLES" and "ROBLES, PABLO" must produce the same key.
//       "CARLOS GARCIA BLANCO" and "GARCIA BLANCO, CARLOS A" must also match.
// =============================================================================
describe('sortedTokenKey() — composite crosswalk join key', () => {
  // TODO: export sortedTokenKey from overrideRateEngine.js or nameUtils.js
  //   const { sortedTokenKey } = require('../overrideRateEngine');

  // Basic two-token names ────────────────────────────────────────────────────
  it.todo('"PABLO ROBLES"  → "PABLOROBLES"');
  it.todo('"ROBLES, PABLO" → "PABLOROBLES" (comma format → identical key)');

  // Middle initial dropping ──────────────────────────────────────────────────
  it.todo('"RAMON YNOA F"   → "RAMONYNOA" (single-char "F" dropped)');
  it.todo('"YNOA, RAMON F"  → "RAMONYNOA" (comma + middle initial)');

  // Three-token compound surnames ────────────────────────────────────────────
  // Tokens: ["CARLOS","GARCIA","BLANCO"] → sorted: ["BLANCO","CARLOS","GARCIA"]
  // → "BLANCOCARLOSGARCIA"
  it.todo('"CARLOS GARCIA BLANCO"      → "BLANCOCARLOSGARCIA"');
  // "A" is dropped; tokens: ["GARCIA","BLANCO","CARLOS"] → sorted same → same key
  it.todo('"GARCIA BLANCO, CARLOS A"   → "BLANCOCARLOSGARCIA" (matches above)');

  // Edge cases ───────────────────────────────────────────────────────────────
  it.todo('single-char-only input "A"  → "" (all tokens dropped)');
  it.todo('null                        → ""');
  it.todo('undefined                   → ""');
});

// =============================================================================
// 4. No financial output for unresolved rows
//    calculateAlbaOverrideSplit() — live equivalent of observeSplit()
//
//    Rule: when needsReview: true, the returned object must NOT contain any of:
//          theiShare, bsiShare, albaComp, totalOverride
//
//    Bucket analogy (from OliComm spec language):
//      NEEDS_REVIEW         → carrier unknown, year type missing, Aetna FL plan unknown
//      NEEDS_STATE          → (not yet applicable; engine falls to 'National' for unknown states)
//      NEEDS_PR_RATE        → no rate entry for resolved carrier/stateGroup
//      CHARGEBACK_DEFER     → (not yet implemented in this engine)
//      WITHIN_FMV_* / EXCEEDS_FMV_* → only rows with needsReview: false and a resolved
//                             stateGroup may have non-null financial proposed values
// =============================================================================
describe('calculateAlbaOverrideSplit() — no financial output for unresolved rows', () => {

  // ── NEEDS_REVIEW: cannot determine year type ─────────────────────────────
  describe('NEEDS_REVIEW — year type indeterminate', () => {
    it('returns needsReview:true with no financial fields when all year-type fields are absent', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'FL',
        commission: 300,
        // compType, firstYearRenewal, salesEvent, commissionAction all omitted
      });
      expect(result.needsReview).toBe(true);
      expect(result.reason).toMatch(/year type/i);
      expectNoFinancials(result);
    });

    it('empty compType string + no other year-type fields → needsReview:true', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'FL',
        commission: 300,
        compType: '',  // blank → falls through, but nothing else supplied
      });
      expect(result.needsReview).toBe(true);
      expectNoFinancials(result);
    });
  });

  // ── NEEDS_PR_RATE: carrier not in rate table ──────────────────────────────
  describe('NEEDS_PR_RATE — carrier not in rate table', () => {
    it('returns needsReview:true for an unrecognized carrier', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UNKNOWN_CARRIER_XYZ',
        memberState: 'FL',
        commission: 500,
        compType: 'N',
      });
      expect(result.needsReview).toBe(true);
      expect(result.reason).toMatch(/no rate table/i);
      expectNoFinancials(result);
    });

    it('Freedom row with state that resolves to "National" → needsReview:true (no National group in Freedom table)', () => {
      // Freedom rate table has CSNP_DSNP and Non_SNP_HMO_POS only — no National.
      // STATE_GROUPS.Freedom is empty → all states fall to 'National' → no rate found.
      const result = calculateAlbaOverrideSplit({
        carrier: 'Freedom',
        memberState: 'FL',
        commission: 250,
        compType: 'N',
      });
      expect(result.needsReview).toBe(true);
      expect(result.reason).toMatch(/no rate for freedom/i);
      expectNoFinancials(result);
    });
  });

  // ── NEEDS_REVIEW: Aetna FL with unresolvable plan ID ─────────────────────
  describe('NEEDS_REVIEW — Aetna FL plan ID missing or unknown', () => {
    it('returns needsReview:true for an Aetna FL row with an unrecognized plan ID', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        commission: 400,
        planId: 'H9999-XXX',
        salesEvent: 'New Business',
      });
      expect(result.needsReview).toBe(true);
      expect(result.reason).toMatch(/unknown fl plan id/i);
      expectNoFinancials(result);
    });

    it('returns needsReview:true for an Aetna FL row with no planId supplied', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        commission: 400,
        salesEvent: 'New Business',
        // planId omitted
      });
      expect(result.needsReview).toBe(true);
      expectNoFinancials(result);
    });
  });

  // ── Non-commissionable rows: RESOLVED to $0 (not "unresolved") ───────────
  // These ARE successfully resolved — just the override is zero.
  // Financial fields are present but all equal 0 (except albaComp = commission).
  describe('Non-commissionable rows — resolved, zero override (NOT flagged needsReview)', () => {
    it('Aetna FL PPO H5521-270 → nonCommissionable:true, override=0, thei=0', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        commission: 150,
        planId: 'H5521-270',
        salesEvent: 'New Business',
      });
      expect(result.needsReview).toBe(false);
      expect(result.nonCommissionable).toBe(true);
      expect(result.totalOverride).toBe(0);
      expect(result.theiShare).toBe(0);
      expect(result.bsiShare).toBe(0);
      expect(result.albaComp).toBe(150); // 150 − 0
    });

    it('Aetna FL PPO H5521-710 → nonCommissionable:true, override=0', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        commission: 200,
        planId: 'H5521-710',
        firstYearRenewal: 'First Year',
      });
      expect(result.needsReview).toBe(false);
      expect(result.nonCommissionable).toBe(true);
      expect(result.totalOverride).toBe(0);
      expect(result.albaComp).toBe(200);
    });
  });

  // ── WITHIN_FMV / EXCEEDS_FMV analogue: only resolved rows have financials ─
  describe('Rows with resolved rate → financial values present and non-null', () => {
    it('UHC National Initial → theiShare and bsiShare are defined and numeric', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'FL',
        commission: 300,
        compType: 'N',
      });
      expect(result.needsReview).toBe(false);
      expect(typeof result.theiShare).toBe('number');
      expect(typeof result.bsiShare).toBe('number');
      expect(typeof result.albaComp).toBe('number');
      expect(typeof result.totalOverride).toBe('number');
    });

    it('certGap rows (Elevance) still have financial values — amounts are contractually owed', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Elevance',
        memberState: 'FL',
        commission: 250,
        compType: 'N',
      });
      expect(result.needsReview).toBe(false);
      expect(result.certGap).toBe(true);
      expect(typeof result.theiShare).toBe('number');
      expect(result.theiShare).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// 5. resolveYearType() — priority chain
// =============================================================================
describe('resolveYearType()', () => {

  describe('Priority 1 — compType (UHC Comp Type field)', () => {
    it('"R" → "Renewal"', () => {
      expect(resolveYearType({ compType: 'R' })).toBe('Renewal');
    });

    it('"N" → "Initial"', () => {
      expect(resolveYearType({ compType: 'N' })).toBe('Initial');
    });

    it('"A" (any non-R value) → "Initial"', () => {
      expect(resolveYearType({ compType: 'A' })).toBe('Initial');
    });

    it('compType "R" overrides commissionAction "New" (Comp Type is authoritative)', () => {
      expect(resolveYearType({ compType: 'R', commissionAction: 'New' })).toBe('Renewal');
    });

    it('empty-string compType falls through to Priority 2', () => {
      const result = resolveYearType({ compType: '', firstYearRenewal: 'First Year' });
      expect(result).toBe('Initial');
    });

    it('whitespace-only compType falls through (treated as empty)', () => {
      const result = resolveYearType({ compType: '   ', firstYearRenewal: 'Renewal Year' });
      expect(result).toBe('Renewal');
    });
  });

  describe('Priority 2 — firstYearRenewal (Humana / Devoted AML portal)', () => {
    it('"First Year" → "Initial"', () => {
      expect(resolveYearType({ firstYearRenewal: 'First Year' })).toBe('Initial');
    });

    it('"Renewal Year" → "Renewal"', () => {
      expect(resolveYearType({ firstYearRenewal: 'Renewal Year' })).toBe('Renewal');
    });

    it('case-insensitive: "renewal year" → "Renewal"', () => {
      expect(resolveYearType({ firstYearRenewal: 'renewal year' })).toBe('Renewal');
    });

    it('bare "Renewal" (contains "renewal") → "Renewal"', () => {
      expect(resolveYearType({ firstYearRenewal: 'Renewal' })).toBe('Renewal');
    });
  });

  describe('Priority 3 — salesEvent (Aetna BSI CSV / UHC THEI direct)', () => {
    it('"New Business" → "Initial"', () => {
      expect(resolveYearType({ salesEvent: 'New Business' })).toBe('Initial');
    });

    it('"PRONEW" (Aetna pro-rated new business) → "Initial"', () => {
      expect(resolveYearType({ salesEvent: 'PRONEW' })).toBe('Initial');
    });

    it('"pronew" lowercase → "Initial" (case-insensitive)', () => {
      expect(resolveYearType({ salesEvent: 'pronew' })).toBe('Initial');
    });

    it('"Renewal" → "Renewal"', () => {
      expect(resolveYearType({ salesEvent: 'Renewal' })).toBe('Renewal');
    });

    it('"Involuntary Pro-Rata" (not New Business or PRONEW) → "Renewal"', () => {
      expect(resolveYearType({ salesEvent: 'Involuntary Pro-Rata' })).toBe('Renewal');
    });
  });

  describe('Priority 4 — commissionAction fallback (UHC, Comp Type blank)', () => {
    it('"New" → "Initial"', () => {
      expect(resolveYearType({ commissionAction: 'New' })).toBe('Initial');
    });

    it('"Renewal" → "Renewal"', () => {
      expect(resolveYearType({ commissionAction: 'Renewal' })).toBe('Renewal');
    });
  });

  describe('All year-type signals absent', () => {
    it('empty object → null', () => {
      expect(resolveYearType({})).toBeNull();
    });

    it('object with only non-year-type fields → null', () => {
      expect(resolveYearType({ carrier: 'UHC', memberState: 'FL', commission: 300 })).toBeNull();
    });
  });
});

// =============================================================================
// 6. resolveAetnaStateGroup() — Aetna FL plan-type-aware routing
// =============================================================================
describe('resolveAetnaStateGroup()', () => {

  describe('Florida — plan-type-aware routing', () => {
    it('FL + H1609-043 (DSNP) → group:"Florida DSNP"', () => {
      const r = resolveAetnaStateGroup('FL', 'H1609-043');
      expect(r.group).toBe('Florida DSNP');
      expect(r.nonCommissionable).toBeFalsy();
    });

    it('FL + H1609-073 (DSNP) → group:"Florida DSNP"', () => {
      expect(resolveAetnaStateGroup('FL', 'H1609-073').group).toBe('Florida DSNP');
    });

    it('FL + H1609-089 (DSNP) → group:"Florida DSNP"', () => {
      expect(resolveAetnaStateGroup('FL', 'H1609-089').group).toBe('Florida DSNP');
    });

    it('FL + H1609-018 (HMO_CSNP) → group:"Florida HMO_CSNP"', () => {
      const r = resolveAetnaStateGroup('FL', 'H1609-018');
      expect(r.group).toBe('Florida HMO_CSNP');
    });

    it('FL + H1609-025 (HMO_CSNP) → group:"Florida HMO_CSNP"', () => {
      expect(resolveAetnaStateGroup('FL', 'H1609-025').group).toBe('Florida HMO_CSNP');
    });

    it('FL + H1609-063 (HMO_CSNP) → group:"Florida HMO_CSNP"', () => {
      expect(resolveAetnaStateGroup('FL', 'H1609-063').group).toBe('Florida HMO_CSNP');
    });

    it('FL + H5521-270 (PPO_NONCOMM) → nonCommissionable:true', () => {
      const r = resolveAetnaStateGroup('FL', 'H5521-270');
      expect(r.nonCommissionable).toBe(true);
      expect(r.group).toBe('PPO_NONCOMM');
    });

    it('FL + H5521-710 (PPO_NONCOMM) → nonCommissionable:true', () => {
      const r = resolveAetnaStateGroup('FL', 'H5521-710');
      expect(r.nonCommissionable).toBe(true);
    });

    it('FL + unknown plan ID → group:null with reason string', () => {
      const r = resolveAetnaStateGroup('FL', 'H9999-XXX');
      expect(r.group).toBeNull();
      expect(r.reason).toMatch(/unknown fl plan id.*h9999-xxx/i);
    });

    it('FL + null planId → group:null with reason string', () => {
      const r = resolveAetnaStateGroup('FL', null);
      expect(r.group).toBeNull();
      expect(r.reason).toBeTruthy();
    });
  });

  describe('Non-Florida states (standard crosswalk)', () => {
    it('CA → "CA_NJ"', () => {
      expect(resolveAetnaStateGroup('CA', null).group).toBe('CA_NJ');
    });

    it('NJ → "CA_NJ"', () => {
      expect(resolveAetnaStateGroup('NJ', null).group).toBe('CA_NJ');
    });

    it('CT → "CT_PA_DC"', () => {
      expect(resolveAetnaStateGroup('CT', null).group).toBe('CT_PA_DC');
    });

    it('PA → "CT_PA_DC"', () => {
      expect(resolveAetnaStateGroup('PA', null).group).toBe('CT_PA_DC');
    });

    it('DC → "CT_PA_DC"', () => {
      expect(resolveAetnaStateGroup('DC', null).group).toBe('CT_PA_DC');
    });

    it('GA (not in Aetna crosswalk) → "National"', () => {
      expect(resolveAetnaStateGroup('GA', null).group).toBe('National');
    });

    it('TX (not in Aetna crosswalk) → "National"', () => {
      expect(resolveAetnaStateGroup('TX', null).group).toBe('National');
    });
  });
});

// =============================================================================
// 7. calculateAlbaOverrideSplit() — full split math (happy paths)
// =============================================================================
describe('calculateAlbaOverrideSplit() — correct split math', () => {

  // ── UHC ──────────────────────────────────────────────────────────────────
  describe('UHC', () => {
    it('National Initial: override=150, thei=75, bsi=75, albaComp=150', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'FL',   // not in UHC STATE_GROUPS → resolves to National
        commission: 300,
        compType: 'N',
      });
      expect(result.needsReview).toBe(false);
      expect(result.yearType).toBe('Initial');
      expect(result.stateGroup).toBe('National');
      expect(result.totalOverride).toBe(150);
      expect(result.theiShare).toBe(75);
      expect(result.bsiShare).toBe(75);
      expect(result.albaComp).toBe(150); // 300 − 150
    });

    it('National Renewal: override=75, thei=37.50, bsi=37.50', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'FL',
        commission: 200,
        compType: 'R',
      });
      expect(result.needsReview).toBe(false);
      expect(result.yearType).toBe('Renewal');
      expect(result.totalOverride).toBe(75);
      expect(result.theiShare).toBe(37.5);
      expect(result.bsiShare).toBe(37.5);
      expect(result.albaComp).toBe(125); // 200 − 75
    });

    it('California Initial: override=175, thei=87.50, bsi=87.50', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'CA',
        commission: 350,
        compType: 'N',
      });
      expect(result.needsReview).toBe(false);
      expect(result.stateGroup).toBe('California');
      expect(result.totalOverride).toBe(175);
      expect(result.theiShare).toBe(87.5);
      expect(result.bsiShare).toBe(87.5);
    });

    it('California Renewal: override=105, thei=52.50, bsi=52.50', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'CA',
        commission: 200,
        compType: 'R',
      });
      expect(result.totalOverride).toBe(105);
      expect(result.theiShare).toBe(52.5);
      expect(result.bsiShare).toBe(52.5);
    });

    it('CT (CT_PA_DC group) Initial: stateGroup="CT_PA_DC", override=150', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'CT',
        commission: 300,
        compType: 'N',
      });
      expect(result.stateGroup).toBe('CT_PA_DC');
      expect(result.totalOverride).toBe(150);
    });

    it('NJ Initial: override=150 (NJ rate = National rate for UHC)', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'NJ',
        commission: 300,
        compType: 'N',
      });
      expect(result.stateGroup).toBe('New Jersey');
      expect(result.totalOverride).toBe(150);
    });
  });

  // ── Aetna ─────────────────────────────────────────────────────────────────
  describe('Aetna', () => {
    it('FL DSNP Initial (H1609-043): override=240, thei=120, bsi=120', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        planId: 'H1609-043',
        commission: 500,
        salesEvent: 'New Business',
      });
      expect(result.needsReview).toBe(false);
      expect(result.yearType).toBe('Initial');
      expect(result.stateGroup).toBe('Florida DSNP');
      expect(result.totalOverride).toBe(240);
      expect(result.theiShare).toBe(120);
      expect(result.bsiShare).toBe(120);
    });

    it('FL DSNP Renewal: override=240 flat (Initial === Renewal for DSNP)', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        planId: 'H1609-073',
        commission: 400,
        salesEvent: 'Renewal',
      });
      expect(result.yearType).toBe('Renewal');
      expect(result.stateGroup).toBe('Florida DSNP');
      expect(result.totalOverride).toBe(240);
    });

    it('FL HMO_CSNP Initial (H1609-018): override=240', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        planId: 'H1609-018',
        commission: 400,
        salesEvent: 'New Business',
      });
      expect(result.stateGroup).toBe('Florida HMO_CSNP');
      expect(result.totalOverride).toBe(240);
    });

    it('FL HMO_CSNP Renewal (H1609-025): override=45, thei=22.50', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        planId: 'H1609-025',
        commission: 150,
        salesEvent: 'Renewal',
      });
      expect(result.yearType).toBe('Renewal');
      expect(result.stateGroup).toBe('Florida HMO_CSNP');
      expect(result.totalOverride).toBe(45);
      expect(result.theiShare).toBe(22.5);
      expect(result.bsiShare).toBe(22.5);
    });

    it('FL PRONEW salesEvent → yearType=Initial', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        planId: 'H1609-018',
        commission: 300,
        salesEvent: 'PRONEW',
      });
      expect(result.yearType).toBe('Initial');
      expect(result.totalOverride).toBe(240);
    });

    it('Non-FL National Initial: override=125', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'GA',
        commission: 250,
        salesEvent: 'New Business',
      });
      expect(result.stateGroup).toBe('National');
      expect(result.totalOverride).toBe(125);
    });

    it('Non-FL CA_NJ (CA) Renewal: override=50', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'CA',
        commission: 100,
        salesEvent: 'Renewal',
      });
      expect(result.stateGroup).toBe('CA_NJ');
      expect(result.totalOverride).toBe(50);
    });

    it('Non-FL CT_PA_DC Initial: override=125', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'CT',
        commission: 200,
        salesEvent: 'New Business',
      });
      expect(result.stateGroup).toBe('CT_PA_DC');
      expect(result.totalOverride).toBe(125);
    });
  });

  // ── Humana ────────────────────────────────────────────────────────────────
  describe('Humana', () => {
    it('National (FL) Initial: override=150, thei=75', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Humana',
        memberState: 'FL',
        commission: 300,
        firstYearRenewal: 'First Year',
      });
      expect(result.needsReview).toBe(false);
      expect(result.stateGroup).toBe('National');
      expect(result.totalOverride).toBe(150);
      expect(result.theiShare).toBe(75);
    });

    it('National (FL) Renewal: override=75', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Humana',
        memberState: 'FL',
        commission: 200,
        firstYearRenewal: 'Renewal Year',
      });
      expect(result.yearType).toBe('Renewal');
      expect(result.totalOverride).toBe(75);
    });

    it('CT_DC_PA (CT) Initial: stateGroup="CT_DC_PA", override=150', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Humana',
        memberState: 'CT',
        commission: 300,
        firstYearRenewal: 'First Year',
      });
      expect(result.stateGroup).toBe('CT_DC_PA');
      expect(result.totalOverride).toBe(150);
    });

    it('CA_NJ (CA) Renewal: stateGroup="CA_NJ", override=75', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Humana',
        memberState: 'CA',
        commission: 150,
        firstYearRenewal: 'Renewal Year',
      });
      expect(result.stateGroup).toBe('CA_NJ');
      expect(result.totalOverride).toBe(75);
    });
  });

  // ── Devoted ───────────────────────────────────────────────────────────────
  describe('Devoted', () => {
    it('National (FL) Initial: override=100, thei=50', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Devoted',
        memberState: 'FL',
        commission: 250,
        firstYearRenewal: 'First Year',
      });
      expect(result.needsReview).toBe(false);
      expect(result.stateGroup).toBe('National');
      expect(result.totalOverride).toBe(100);
      expect(result.theiShare).toBe(50);
      expect(result.bsiShare).toBe(50);
    });

    it('PA group Renewal: stateGroup="PA", override=80', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Devoted',
        memberState: 'PA',
        commission: 200,
        firstYearRenewal: 'Renewal Year',
      });
      expect(result.stateGroup).toBe('PA');
      expect(result.totalOverride).toBe(80);
    });

    it('TX group Initial: stateGroup="TX", override=100', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Devoted',
        memberState: 'TX',
        commission: 200,
        firstYearRenewal: 'First Year',
      });
      expect(result.stateGroup).toBe('TX');
      expect(result.totalOverride).toBe(100);
    });
  });

  // ── HealthSpring ──────────────────────────────────────────────────────────
  describe('HealthSpring', () => {
    it('National Initial: override=180', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'HealthSpring',
        memberState: 'FL',
        commission: 350,
        compType: 'N',
      });
      expect(result.stateGroup).toBe('National');
      expect(result.totalOverride).toBe(180);
    });

    it('CT_DC_PA (CT) Initial: stateGroup="CT_DC_PA", override=180', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'HealthSpring',
        memberState: 'CT',
        commission: 350,
        compType: 'N',
      });
      expect(result.stateGroup).toBe('CT_DC_PA');
      expect(result.totalOverride).toBe(180);
    });

    it('NJ Initial: stateGroup="NJ", override=180', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'HealthSpring',
        memberState: 'NJ',
        commission: 350,
        compType: 'N',
      });
      expect(result.stateGroup).toBe('NJ');
      expect(result.totalOverride).toBe(180);
    });
  });

  // ── Elevance (certGap carrier — entitled but NOT currently being paid) ────
  describe('Elevance — certGap:true (contractually owed but not yet received)', () => {
    it('National Initial: certGap:true, override=125, thei=62.50, bsi=62.50', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Elevance',
        memberState: 'FL', // not CT or CA → National
        commission: 250,
        compType: 'N',
      });
      expect(result.needsReview).toBe(false);
      expect(result.certGap).toBe(true);
      expect(result.totalOverride).toBe(125);
      expect(result.theiShare).toBe(62.5);
      expect(result.bsiShare).toBe(62.5);
    });

    it('National Renewal: certGap:true, override=95', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Elevance',
        memberState: 'FL',
        commission: 200,
        compType: 'R',
      });
      expect(result.certGap).toBe(true);
      expect(result.totalOverride).toBe(95);
    });

    it('CT_SNP Initial: stateGroup="CT_SNP", certGap:true', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Elevance',
        memberState: 'CT',
        commission: 250,
        compType: 'N',
      });
      expect(result.stateGroup).toBe('CT_SNP');
      expect(result.certGap).toBe(true);
      expect(result.totalOverride).toBe(125);
    });
  });

  // ── Split math precision ──────────────────────────────────────────────────
  describe('Split math precision and invariants', () => {
    it('theiShare + bsiShare === totalOverride (no rounding leakage)', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'GA',
        commission: 200,
        salesEvent: 'New Business',
      });
      // $125 override: each share = 62.50
      expect(result.theiShare + result.bsiShare).toBe(result.totalOverride);
    });

    it('albaComp === commission − totalOverride (within floating-point tolerance)', () => {
      const commission = 450;
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'FL',
        commission,
        compType: 'N',
      });
      expect(result.albaComp).toBeCloseTo(commission - result.totalOverride, 2);
    });

    it('albaComp can be negative when carrier paid less than the override amount', () => {
      // UHC National Initial override = $150; commission = $100 → albaComp = -50
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'FL',
        commission: 100,
        compType: 'N',
      });
      expect(result.albaComp).toBe(-50);
    });

    it('rawCommission is echoed back in result', () => {
      const commission = 300;
      const result = calculateAlbaOverrideSplit({
        carrier: 'UHC',
        memberState: 'FL',
        commission,
        compType: 'N',
      });
      expect(result.rawCommission).toBe(commission);
    });

    it('planId is echoed in result for Aetna FL rows', () => {
      const result = calculateAlbaOverrideSplit({
        carrier: 'Aetna',
        memberState: 'FL',
        planId: 'H1609-043',
        commission: 400,
        salesEvent: 'New Business',
      });
      expect(result.planId).toBe('H1609-043');
    });
  });
});

// =============================================================================
// 8. shouldProcessBSIOverrideRow() — orphan vs. already-paid gating
// =============================================================================
describe('shouldProcessBSIOverrideRow()', () => {
  const theStmtRowsByPolicy = {
    'POL123456': { thei_share: 75 },
    'POL999999': { thei_share: 120 },
    'POL-TRIM ': { thei_share: 50 },  // key already trimmed by caller convention
  };

  it('policy present in THE stmt map → process:false', () => {
    const result = shouldProcessBSIOverrideRow(
      { policyNumber: 'POL123456' },
      theStmtRowsByPolicy,
    );
    expect(result.process).toBe(false);
    expect(result.reason).toMatch(/already paid/i);
    expect(result.existingTheiShare).toBe(75);
  });

  it('second known policy → process:false with correct existingTheiShare', () => {
    const result = shouldProcessBSIOverrideRow(
      { policyNumber: 'POL999999' },
      theStmtRowsByPolicy,
    );
    expect(result.process).toBe(false);
    expect(result.existingTheiShare).toBe(120);
  });

  it('orphaned row (policy not in map) → process:true, no reason', () => {
    const result = shouldProcessBSIOverrideRow(
      { policyNumber: 'POL_NEW_ORPHAN' },
      theStmtRowsByPolicy,
    );
    expect(result.process).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.existingTheiShare).toBeUndefined();
  });

  it('trims leading/trailing whitespace from policyNumber before lookup', () => {
    const result = shouldProcessBSIOverrideRow(
      { policyNumber: '  POL123456  ' },
      theStmtRowsByPolicy,
    );
    expect(result.process).toBe(false);
  });

  it('empty policyNumber string → process:true (no match for empty key)', () => {
    const result = shouldProcessBSIOverrideRow(
      { policyNumber: '' },
      theStmtRowsByPolicy,
    );
    expect(result.process).toBe(true);
  });

  it('missing policyNumber field → process:true (undefined → empty string)', () => {
    const result = shouldProcessBSIOverrideRow(
      {},
      theStmtRowsByPolicy,
    );
    expect(result.process).toBe(true);
  });

  it('empty THE stmt map → always process:true', () => {
    const result = shouldProcessBSIOverrideRow(
      { policyNumber: 'POL123456' },
      {},
    );
    expect(result.process).toBe(true);
  });
});

// =============================================================================
// 9. OVERRIDE_RATE_TABLE data integrity (contract-level assertions)
// =============================================================================
describe('OVERRIDE_RATE_TABLE — data integrity', () => {
  const carriers = Object.keys(OVERRIDE_RATE_TABLE);

  it('contains entries for all eight expected carriers', () => {
    const expected = ['UHC', 'Aetna', 'Humana', 'HealthSpring', 'Devoted', 'Optimum', 'Freedom', 'Elevance'];
    expected.forEach((c) => expect(carriers).toContain(c));
  });

  it('every non-null, non-certGap rate entry has both Initial and Renewal keys as numbers', () => {
    carriers.forEach((carrier) => {
      const table = OVERRIDE_RATE_TABLE[carrier];
      Object.entries(table).forEach(([group, rates]) => {
        if (rates === null) return; // non-commissionable marker — valid
        expect(typeof rates).toBe('object');
        expect(typeof rates.Initial).toBe('number');
        expect(typeof rates.Renewal).toBe('number');
      });
    });
  });

  it('all rates are non-negative', () => {
    carriers.forEach((carrier) => {
      Object.values(OVERRIDE_RATE_TABLE[carrier]).forEach((rates) => {
        if (rates === null) return;
        expect(rates.Initial).toBeGreaterThanOrEqual(0);
        expect(rates.Renewal).toBeGreaterThanOrEqual(0);
      });
    });
  });

  it('UHC National Initial = 150 (contract-verified)', () => {
    expect(OVERRIDE_RATE_TABLE.UHC.National.Initial).toBe(150);
  });

  it('UHC National Renewal = 75 (contract-verified)', () => {
    expect(OVERRIDE_RATE_TABLE.UHC.National.Renewal).toBe(75);
  });

  it('Aetna Florida DSNP is flat: Initial === Renewal === 240', () => {
    const dsnp = OVERRIDE_RATE_TABLE.Aetna['Florida DSNP'];
    expect(dsnp.Initial).toBe(240);
    expect(dsnp.Renewal).toBe(240);
  });

  it('Aetna Florida HMO_CSNP: Initial=240, Renewal=45 (different tiers)', () => {
    const hmo = OVERRIDE_RATE_TABLE.Aetna['Florida HMO_CSNP'];
    expect(hmo.Initial).toBe(240);
    expect(hmo.Renewal).toBe(45);
  });

  it('Freedom and Elevance entries all have certGap:true', () => {
    Object.values(OVERRIDE_RATE_TABLE.Freedom).forEach((r) => {
      expect(r.certGap).toBe(true);
    });
    Object.values(OVERRIDE_RATE_TABLE.Elevance).forEach((r) => {
      expect(r.certGap).toBe(true);
    });
  });

  it('all AETNA_FL_PLAN_CROSSWALK plan types are one of the three valid types', () => {
    const validTypes = new Set(['HMO_CSNP', 'DSNP', 'PPO_NONCOMM']);
    Object.entries(AETNA_FL_PLAN_CROSSWALK).forEach(([planId, planType]) => {
      expect(validTypes.has(planType)).toBe(true);
    });
  });

  it('AETNA_FL_PLAN_CROSSWALK contains all expected plan IDs (uploads 487 + 503–507)', () => {
    const expectedPlanIds = [
      // From uploads 503–507
      'H1609-018', 'H1609-043', 'H1609-063', 'H1609-080',
      'H1609-086', 'H1609-093', 'H5521-270',
      // From upload 487 (added 2026-08-04)
      'H1609-025', 'H1609-073', 'H1609-084', 'H1609-089', 'H5521-710',
    ];
    expectedPlanIds.forEach((id) => {
      expect(AETNA_FL_PLAN_CROSSWALK).toHaveProperty(id);
    });
  });
});

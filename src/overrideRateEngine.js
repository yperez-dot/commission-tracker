/**
 * Override Rate Engine — Alba Hernandez House Rows Only
 *
 * Applies ONLY to rows where:
 *   agent_name = 'Alba Hernandez'
 *   AND Writing Agent Name in raw_data = 'Broker Society Insurance'
 *   (i.e., no downline agent — BSI is writing agent, Alba is the payee)
 *
 * Source: THEI._BSI_Override_Rate_Reference_ALL_CARRIERS (July 08, 2026)
 * All rates verified against primary contracts.
 *
 * DO NOT apply to any other agent's rows.
 * DO NOT touch the database without backup → dry-run → explicit approval.
 */

'use strict';

// ---------------------------------------------------------------------------
// Aetna FL Plan ID → plan type (CMS-verified, 2026-08-04)
// ---------------------------------------------------------------------------
const AETNA_FL_PLAN_CROSSWALK = {
  // ── From uploads 503–507 (AETNA_BSI_STATEMENT_202602–202606) ─────────────
  // All confirmed from CMS/aetna-medicareadvantage.com, 2026-08-04
  'H1609-018': 'HMO_CSNP',   // Aetna Medicare Select (HMO)
  'H1609-043': 'DSNP',       // Aetna Medicare Dual Select (HMO D-SNP)
  'H1609-063': 'HMO_CSNP',   // Aetna Medicare Select (HMO) — confirmed by Yahoska
  'H1609-080': 'HMO_CSNP',   // Aetna Medicare Chronic Care (HMO C-SNP) — same rate as HMO (Yahoska confirmed)
  'H1609-086': 'HMO_CSNP',   // Aetna Medicare Select (HMO) — confirmed by Yahoska
  'H1609-093': 'HMO_CSNP',   // Aetna Medicare Select (HMO)
  'H5521-270': 'PPO_NONCOMM', // Aetna Medicare Signature (PPO) — non-commissionable (Yahoska confirmed)

  // ── From upload 487 (AETNA_BSI_STATEMENT_202601) ─────────────────────────
  // Added 2026-08-04 after needsReview surfaced in dry-run v2
  // All confirmed independently from CMS/aetna-medicareadvantage.com sources
  'H1609-025': 'HMO_CSNP',   // Aetna Medicare Select (HMO) — confirmed Yahoska + aetna-medicareadvantage.com
  'H1609-073': 'DSNP',       // Aetna Medicare Full Dual Select (HMO D-SNP) — confirmed Yahoska + aetna-medicareadvantage.com
  'H1609-084': 'HMO_CSNP',   // Aetna Medicare Chronic Care (HMO C-SNP) — same rate as HMO (confirmed Yahoska)
  'H1609-089': 'DSNP',       // Aetna Medicare Full Dual Select (HMO D-SNP) — confirmed aetna-medicareadvantage.com + medicareadvantage.com
  'H5521-710': 'PPO_NONCOMM', // Aetna Medicare Signature (PPO) — non-commissionable (confirmed aetna-medicareadvantage.com)
};

// ---------------------------------------------------------------------------
// STATE_GROUPS[carrier][stateCode] → group key used in OVERRIDE_RATE_TABLE
// States not listed → 'National' (the fallback)
// ---------------------------------------------------------------------------
const STATE_GROUPS = {
  UHC: {
    CA: 'California',
    NJ: 'New Jersey',
    CT: 'CT_PA_DC', PA: 'CT_PA_DC', DC: 'CT_PA_DC',
  },
  Aetna: {
    // FL is handled separately (plan-type-aware, see resolveAetnaStateGroup)
    CA: 'CA_NJ', NJ: 'CA_NJ',
    CT: 'CT_PA_DC', PA: 'CT_PA_DC', DC: 'CT_PA_DC',
  },
  Humana: {
    CT: 'CT_DC_PA', DC: 'CT_DC_PA', PA: 'CT_DC_PA',
    CA: 'CA_NJ',    NJ: 'CA_NJ',
  },
  HealthSpring: {
    CT: 'CT_DC_PA', DC: 'CT_DC_PA', PA: 'CT_DC_PA',
    NJ: 'NJ',
  },
  Devoted: {
    PA: 'PA',
    TX: 'TX',
  },
  Optimum: {},    // no state-level splits — all rows use plan-type group
  Freedom: {},    // no state-level splits — ⚠️ NOT CURRENTLY BEING PAID
  Elevance: {
    CT: 'CT_SNP',
    CA: 'CA_SNP',
  },
};

// ---------------------------------------------------------------------------
// OVERRIDE_RATE_TABLE[carrier][stateGroup][yearType] → total override $
//
// yearType: 'Initial' | 'Renewal'
// totalOverride = the gross override amount BSI receives from carrier
// theiShare = totalOverride × 0.50 (confirmed 50/50 Alba split)
// bsiShare  = totalOverride × 0.50
// albaComp  = rawCommission − totalOverride  (what Alba was paid above the split)
//
// ⚠️ Freedom, Elevance: rates are contractually correct but NOT currently being
//    paid due to BSI/Alba certification gap. Flag rows for review, do NOT update splits.
// ---------------------------------------------------------------------------
const OVERRIDE_RATE_TABLE = {
  UHC: {
    National:    { Initial: 150, Renewal: 75 },
    California:  { Initial: 175, Renewal: 105 },
    'New Jersey':{ Initial: 150, Renewal: 75 },
    CT_PA_DC:    { Initial: 150, Renewal: 75 },
  },

  Aetna: {
    National:           { Initial: 125, Renewal: 45 },
    CT_PA_DC:           { Initial: 125, Renewal: 45 },
    CA_NJ:              { Initial: 135, Renewal: 50 },
    'Florida DSNP':     { Initial: 240, Renewal: 240 }, // flat — Initial = Renewal
    'Florida HMO_CSNP': { Initial: 240, Renewal: 45 },
    PDP_NONCOMM:        null,  // non-commissionable ($0)
    PPO_NONCOMM:        null,  // non-commissionable (Yahoska confirmed 2026-08-04)
  },

  Humana: {
    National:  { Initial: 150, Renewal: 75 },
    CT_DC_PA:  { Initial: 150, Renewal: 75 },
    CA_NJ:     { Initial: 150, Renewal: 75 }, // inferred, strong match
    PDP:       { Initial: 19,  Renewal: 8  },
  },

  HealthSpring: {
    National:  { Initial: 180, Renewal: 75 },
    CT_DC_PA:  { Initial: 180, Renewal: 75 },
    NJ:        { Initial: 180, Renewal: 75 },
    PDP:       { Initial: 13.5, Renewal: 8 },
  },

  Devoted: {
    National:  { Initial: 100, Renewal: 80 },
    PA:        { Initial: 100, Renewal: 80 },
    TX:        { Initial: 100, Renewal: 80 },
  },

  Optimum: {
    CSNP_DSNP:    { Initial: 150, Renewal: 100 },
    Non_SNP_HMO:  { Initial: 150, Renewal: 100 },
  },

  // ⚠️ NOT CURRENTLY BEING PAID — BSI/Alba certification gap
  // Rates are contractually correct but override is $0 in practice until fixed
  Freedom: {
    CSNP_DSNP:     { Initial: 150, Renewal: 100, certGap: true },
    Non_SNP_HMO_POS: { Initial: 150, Renewal: 100, certGap: true },
  },

  // ⚠️ NOT CURRENTLY BEING PAID — BSI/Alba certification gap
  Elevance: {
    National:  { Initial: 125, Renewal: 95, certGap: true },
    CT_SNP:    { Initial: 125, Renewal: 95, certGap: true },
    CA_SNP:    { Initial: 125, Renewal: 95, certGap: true },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve Aetna state group — plan-type-aware for FL rows.
 * For FL, requires planId to determine DSNP vs HMO/CSNP.
 */
function resolveAetnaStateGroup(state, planId) {
  if (state === 'FL') {
    const planType = planId ? AETNA_FL_PLAN_CROSSWALK[planId] : null;
    if (!planType) {
      return { group: null, reason: `Unknown FL Plan ID: ${planId}` };
    }
    if (planType === 'PPO_NONCOMM') {
      return { group: 'PPO_NONCOMM', nonCommissionable: true };
    }
    if (planType === 'DSNP') {
      return { group: 'Florida DSNP' };
    }
    return { group: 'Florida HMO_CSNP' };
  }
  const group = STATE_GROUPS.Aetna[state] || 'National';
  return { group };
}

/**
 * Determine yearType ('Initial' | 'Renewal') from row fields.
 *
 * Priority order (confirmed field availability per carrier/upload type):
 *
 * 1. compType (UHC BSI + UHC main-route THEI statements)
 *    raw_data key: 'Comp Type'
 *    'R' = Renewal rate tier. Anything else = Initial.
 *    Authoritative: Commission Action says 'New' but Comp Type = 'R' → still Renewal.
 *    Skip if empty string (e.g. PDP rows where Comp Type is blank).
 *
 * 2. firstYearRenewal (Humana AML portal, Devoted AML portal)
 *    raw_data key: 'First Year/Renewal'
 *    Values: 'First Year' → Initial | 'Renewal Year' (or contains 'Renewal') → Renewal
 *    This field IS reliable for Humana/Devoted — no Comp Type equivalent needed.
 *
 * 3. salesEvent (Aetna BSI CSV uploads 503–507, UHC THEI direct statement)
 *    raw_data key: 'Sales Event'
 *    'New Business' → Initial | anything else ('Renewal', 'Involuntary Pro-Rata', etc.) → Renewal
 *
 * 4. commissionAction fallback (UHC when Comp Type is blank)
 *    raw_data key: 'Commission Action'
 *    'New' → Initial | 'Renewal' → Renewal
 *
 * @param {object} row
 *   compType        {string}  from raw_data 'Comp Type'       (UHC)
 *   firstYearRenewal{string}  from raw_data 'First Year/Renewal' (Humana/Devoted)
 *   salesEvent      {string}  from raw_data 'Sales Event'     (Aetna, UHC direct)
 *   commissionAction{string}  from raw_data 'Commission Action' (UHC fallback)
 */
function resolveYearType(row) {
  // 1. UHC Comp Type — authoritative rate-tier signal
  //    'R' = Renewal rate tier regardless of what Commission Action says.
  //    Guard: skip if empty string (PDP rows have blank Comp Type).
  if (row.compType && row.compType.trim()) {
    return row.compType.trim() === 'R' ? 'Renewal' : 'Initial';
  }

  // 2. Humana / Devoted AML portal — 'First Year/Renewal' field
  //    Values observed: 'First Year' | 'Renewal Year' (not bare 'Renewal')
  if (row.firstYearRenewal) {
    if (row.firstYearRenewal === 'First Year')              return 'Initial';
    if (row.firstYearRenewal.toLowerCase().includes('renewal')) return 'Renewal';
  }

  // 3. Aetna BSI CSV + UHC THEI direct statement — 'Sales Event' field
  //    'New Business' = Initial; everything else (Renewal, Involuntary Pro-Rata, etc.) = Renewal
  if (row.salesEvent) {
    // PRONEW = Aetna code for pro-rated New Business = Initial (confirmed 2026-08-04)
    const se = row.salesEvent.toUpperCase();
    return (se === 'NEW BUSINESS' || se === 'PRONEW') ? 'Initial' : 'Renewal';
  }

  // 4. Fallback — Commission Action (UHC when Comp Type is blank)
  if (row.commissionAction) {
    return row.commissionAction === 'New' ? 'Initial' : 'Renewal';
  }

  return null; // all fields missing — caller flags for review
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Calculate Alba Hernandez override split for a single house row.
 *
 * @param {object} row
 *   carrier        {string}  'UHC' | 'Aetna' | 'Humana' | 'Devoted' | etc.
 *   memberState    {string}  2-letter state code (e.g., 'FL', 'CA')
 *   commission     {number}  raw commission amount from carrier statement
 *   planId         {string}  Aetna FL only — Plan ID (e.g., 'H1609-043')
 *   commissionAction  {string}  'New' | 'Renewal' (optional shorthand)
 *   firstYearRenewal  {string}  'First Year' | 'Renewal' (AML portal field)
 *   salesEvent     {string}  raw Sales Event from Aetna raw_data
 *
 * @returns {object}
 *   needsReview    {boolean}
 *   reason         {string}  set when needsReview=true
 *   totalOverride  {number}
 *   theiShare      {number}  totalOverride × 0.50
 *   bsiShare       {number}  totalOverride × 0.50
 *   albaComp       {number}  commission − totalOverride
 *   certGap        {boolean} true for Freedom/Elevance (entitled but not paid)
 *   nonCommissionable {boolean}
 */
function calculateAlbaOverrideSplit(row) {
  const { carrier, memberState, commission, planId } = row;

  // --- resolve year type ---
  const yearType = resolveYearType(row);
  if (!yearType) {
    return { needsReview: true, reason: `Cannot determine year type (Initial/Renewal) for ${carrier}/${memberState}` };
  }

  // --- resolve state group ---
  let stateGroup, nonCommissionable = false, certGap = false;

  if (carrier === 'Aetna') {
    const resolved = resolveAetnaStateGroup(memberState, planId);
    if (resolved.reason) {
      return { needsReview: true, reason: resolved.reason };
    }
    if (resolved.nonCommissionable) {
      return { needsReview: false, nonCommissionable: true, totalOverride: 0, theiShare: 0, bsiShare: 0, albaComp: commission };
    }
    stateGroup = resolved.group;
  } else {
    stateGroup = (STATE_GROUPS[carrier] || {})[memberState] || 'National';
  }

  // --- look up rate ---
  const carrierTable = OVERRIDE_RATE_TABLE[carrier];
  if (!carrierTable) {
    return { needsReview: true, reason: `No rate table for carrier: ${carrier}` };
  }

  const groupRates = carrierTable[stateGroup];
  if (!groupRates) {
    return { needsReview: true, reason: `No rate for ${carrier}/${stateGroup}` };
  }

  // non-commissionable marker
  if (groupRates === null) {
    return { needsReview: false, nonCommissionable: true, totalOverride: 0, theiShare: 0, bsiShare: 0, albaComp: commission };
  }

  certGap = !!groupRates.certGap;

  const totalOverride = groupRates[yearType];
  if (totalOverride == null) {
    return { needsReview: true, reason: `No ${yearType} rate for ${carrier}/${stateGroup}` };
  }

  const theiShare = Math.round(totalOverride * 0.5 * 100) / 100;
  const bsiShare  = Math.round(totalOverride * 0.5 * 100) / 100;
  const albaComp  = Math.round((commission - totalOverride) * 100) / 100;

  return {
    needsReview: false,
    certGap,
    nonCommissionable: false,
    carrier,
    memberState,
    stateGroup,
    yearType,
    planId: planId || null,
    rawCommission: commission,
    totalOverride,
    theiShare,
    bsiShare,
    albaComp,
  };
}

// ---------------------------------------------------------------------------
// shouldProcessBSIOverrideRow
// ---------------------------------------------------------------------------

/**
 * Gate check: before running calculateAlbaOverrideSplit on a BSI Agency Override
 * row, verify THEI doesn't already have the real payment via a THE stmt row.
 *
 * Background:
 *   - THE stmt rows (uploads from filenames matching %THE% / %health_experts%) represent
 *     actual carrier remittances THEI already received. thei_share/bsi_share are already
 *     populated and correct on these rows.
 *   - BSI Agency Override rows for the SAME policy represent the same economic event
 *     from BSI's perspective. Processing them through the engine without checking first
 *     would fabricate a second phantom payment on top of money already received.
 *   - 7 "orphaned" BSI Agency Override rows exist where THEI has NO matching THE stmt
 *     record — these are real unpaid obligations BSI owes THEI.
 *
 * @param {object} bsiRow              The BSI Agency Override row to evaluate
 *   policyNumber  {string}            TRIM'd policy number
 * @param {object} theStmtRowsByPolicy Map of TRIM(policy_number) → THE stmt row
 *   (pre-built from commission_records WHERE upload_id IN THE stmt uploads)
 *
 * @returns {{ process: boolean, reason?: string, existingTheiShare?: number }}
 */
function shouldProcessBSIOverrideRow(bsiRow, theStmtRowsByPolicy) {
  const key = (bsiRow.policyNumber || '').trim();
  const match = theStmtRowsByPolicy[key];

  if (match) {
    // THEI already has the real payment record — do not reprocess.
    return {
      process: false,
      reason: 'Already paid via THE statement',
      existingTheiShare: match.thei_share,
    };
  }

  // Orphaned row — genuine unpaid override. Safe to process.
  return { process: true };
}

const {
  excelSerialToDate,
  canonicalizeProductFamily,
  sortedTokenKey,
  ALLOWED_RECON_STATUSES,
  classifyRow: classifyReconRow,
  parseRawJson,
  assertNoFinancialWrites,
} = require('./reconHelpers');

module.exports = {
  calculateAlbaOverrideSplit,
  shouldProcessBSIOverrideRow,
  OVERRIDE_RATE_TABLE,
  STATE_GROUPS,
  AETNA_FL_PLAN_CROSSWALK,
  resolveYearType,
  resolveAetnaStateGroup,
  // Observe-only reconciliation helpers (re-exported for unit tests)
  excelSerialToDate,
  canonicalizeProductFamily,
  sortedTokenKey,
  ALLOWED_RECON_STATUSES,
  classifyReconRow,
  parseRawJson,
  assertNoFinancialWrites,
};

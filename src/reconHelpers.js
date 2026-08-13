'use strict';

/**
 * reconHelpers.js — pure observe-only reconciliation helpers.
 *
 * FINANCIAL COLUMNS ARE NEVER WRITTEN BY THESE HELPERS.
 * They classify observation state only; no split/payout math.
 */

// ---------------------------------------------------------------------------
// Allowed first-class reconciliation_status values (NULL also permitted in DB)
// ---------------------------------------------------------------------------

const ALLOWED_RECON_STATUSES = Object.freeze([
  'PROVISIONAL',
  'SOURCE_NEW',
  'SOURCE_P2P',
  'LIKE_P2P_CANDIDATE',
  'UNLIKE_P2P_CANDIDATE',
  'P2P_NEEDS_HISTORY',
  'RENEWAL_DATE_MISMATCH',
  'RENEWAL_VS_NEW_PROD',
  'NEEDS_CMS_PAYMENT_TYPE',
  'CHARGEBACK_DEFER',
  'SOURCE_CANCELLED',
  'PENDING_NO_MATCH',
  'EXCEPTION',
  'FINAL',
]);

const STATUS = Object.freeze(
  ALLOWED_RECON_STATUSES.reduce((acc, s) => {
    acc[s] = s;
    return acc;
  }, {})
);

const MANUAL_LOCK_STATUSES = Object.freeze(new Set([STATUS.EXCEPTION, STATUS.FINAL]));

const GROUP = Object.freeze({
  SOURCE_BACKED: 'SOURCE_BACKED',
  SEMANTIC_MISMATCH: 'SEMANTIC_MISMATCH',
  CHARGEBACK: 'CHARGEBACK',
  UNMATCHED: 'UNMATCHED',
});

const PROD_ACTIVE_STATUSES = new Set(['active', 'enrolled', 'effective', 'paid']);
const PROD_CANCELLED_STATUSES = new Set([
  'cancelled', 'termed', 'terminated', 'disenrolled', 'lapsed',
]);

const FIRST_YEAR_PATTERNS = [/first.?year/i, /\bfy\b/i, /\bnew business\b/i];
const RENEWAL_PATTERNS = [/renewal/i, /\bren\b/i, /\bry\b/i];

// ---------------------------------------------------------------------------
// Excel serial → calendar date
// ---------------------------------------------------------------------------

/**
 * Convert an Excel serial date to { year, month, day } (month 1-indexed).
 * Handles the Excel 1900 phantom leap-day bug (serial >= 60).
 * Returns null for null/undefined/NaN/0/negative/non-numeric.
 *
 * @param {*} serial
 * @returns {{ year: number, month: number, day: number }|null}
 */
function excelSerialToDate(serial) {
  if (serial == null || serial === '') return null;
  if (typeof serial === 'boolean') return null;
  const n = typeof serial === 'number' ? serial : Number(String(serial).trim());
  if (!Number.isFinite(n) || Number.isNaN(n) || n <= 0) return null;

  // Excel: serial 1 = 1900-01-01; serial 60 is the phantom Feb 29 1900.
  const adjusted = n >= 60 ? n - 1 : n;
  const ms = Date.UTC(1900, 0, 1) + (adjusted - 1) * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * Normalize a date-ish value (Excel serial, ISO, MM/DD/YYYY, Date) to YYYY-MM-DD
 * for exact deterministic comparison. Returns null if unparseable.
 */
function toComparableDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const asNum = typeof value === 'number' ? value : Number(value.trim());
    // Excel serials for modern commission dates are typically > 30000
    if (asNum > 20000 && asNum < 100000) {
      const parts = excelSerialToDate(asNum);
      if (!parts) return null;
      return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    }
  }

  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  const ymd = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd && parseInt(ymd[1], 10) > 1900) {
    return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Product family canonicalization
// ---------------------------------------------------------------------------

function _hasMaSignal(s) {
  return /medicare\s+advantage|mapd|\bma\b/i.test(s);
}

function _hasExplicitMapdPhrase(s) {
  // MAPD and "Medicare Advantage with Prescription Drug" are MA/MAPD, not PDP.
  return /mapd|medicare\s+advantage\s+with\s+prescription\s+drug/i.test(s);
}

function _hasPdpSignal(s) {
  // Standalone PDP / Prescription Drug — after MAPD phrases are handled.
  return /\bpdp\b|prescription\s+drug/i.test(s);
}

function _hasMedSuppSignal(s) {
  return /med\s*supp|medigap|supplement/i.test(s);
}

/**
 * Canonicalize product family from product / productType signals.
 *
 * Priority:
 *   1. Explicit MAPD / "Medicare Advantage with Prescription Drug" → MA_MAPD
 *      (before generic PDP detection — MAPD phrases contain "Prescription Drug")
 *   2. Conflicting MA + PDP signals across fields → AMBIGUOUS
 *   3. MA / Medicare Advantage → MA_MAPD
 *   4. PDP / Prescription Drug → PDP
 *   5. Med Supp / Medigap → MED_SUPP
 *   6. else → UNKNOWN
 *
 * @param {string|null|undefined} product
 * @param {string|null|undefined} productType
 * @returns {'MA_MAPD'|'PDP'|'MED_SUPP'|'AMBIGUOUS'|'UNKNOWN'}
 */
function canonicalizeProductFamily(product, productType) {
  const a = product == null ? '' : String(product).trim();
  const b = productType == null ? '' : String(productType).trim();
  if (!a && !b) return 'UNKNOWN';

  const combined = `${a} ${b}`.trim();

  // MAPD phrases must win before generic "Prescription Drug" PDP detection.
  if (_hasExplicitMapdPhrase(a) || _hasExplicitMapdPhrase(b) || _hasExplicitMapdPhrase(combined)) {
    return 'MA_MAPD';
  }

  const maA = _hasMaSignal(a);
  const maB = _hasMaSignal(b);
  const pdpA = _hasPdpSignal(a);
  const pdpB = _hasPdpSignal(b);

  // Conflicting signals across the two fields (or within one field after MAPD carve-out)
  if ((maA || maB) && (pdpA || pdpB)) {
    // Same-field "Medicare Advantage HMO" + other-field "PDP" → ambiguous
    return 'AMBIGUOUS';
  }

  if (maA || maB) return 'MA_MAPD';
  if (pdpA || pdpB) return 'PDP';
  if (_hasMedSuppSignal(a) || _hasMedSuppSignal(b)) return 'MED_SUPP';
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Deterministic name normalization for crosswalk joins
// ---------------------------------------------------------------------------

/**
 * Build a deterministic sorted-token key for exact crosswalk name matching.
 * Mirrors the SQL crosswalk join used for Humana BSI ↔ production matching.
 * No fuzzy matching.
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
function sortedTokenKey(name) {
  if (name == null) return '';
  const upper = String(name)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!upper) return '';
  const tokens = upper
    .split(' ')
    .filter((t) => t.length > 1)
    .sort();
  return tokens.join('');
}

// ---------------------------------------------------------------------------
// Safe JSON parse
// ---------------------------------------------------------------------------

/**
 * Safely parse raw_data that may already be an object, a JSON string, or junk.
 * Never throws. Returns {} on failure.
 *
 * @param {*} raw
 * @returns {object}
 */
function parseRawJson(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch (_err) {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function matchesAny(str, patterns) {
  if (!str) return false;
  return patterns.some((p) => p.test(str));
}

function normStatus(s) {
  return (s || '').toLowerCase().trim();
}

function normNewP2P(s) {
  return (s || '').toLowerCase().trim();
}

function isChargebackRow(row) {
  const commission = parseFloat(row.commission);
  const crClass = String(row.cr_classification || row.classification || '').toLowerCase().trim();
  return (Number.isFinite(commission) && commission < 0) || crClass === 'chargeback';
}

function isRenewalTagged(row) {
  const commType = row.commission_type || '';
  const classification = row.cr_classification || row.classification || '';
  const raw = parseRawJson(row.raw_data);
  const fyr = String(
    raw['First Year/Renewal'] || raw.FrstYrRnwl || raw.firstYearRenewal || ''
  );
  return (
    matchesAny(commType, RENEWAL_PATTERNS) ||
    matchesAny(classification, RENEWAL_PATTERNS) ||
    matchesAny(fyr, RENEWAL_PATTERNS) ||
    /^r$/i.test(fyr.trim())
  );
}

function isFirstYearTagged(row) {
  const commType = row.commission_type || '';
  const classification = row.cr_classification || row.classification || '';
  const raw = parseRawJson(row.raw_data);
  const fyr = String(
    raw['First Year/Renewal'] || raw.FrstYrRnwl || raw.firstYearRenewal || ''
  );
  return (
    matchesAny(commType, FIRST_YEAR_PATTERNS) ||
    matchesAny(classification, FIRST_YEAR_PATTERNS) ||
    matchesAny(fyr, FIRST_YEAR_PATTERNS) ||
    /^f$/i.test(fyr.trim())
  );
}

/**
 * Extract Effective Date and Original EffectiveDate from a commission row
 * (column values and/or raw_data), converting Excel serials first.
 *
 * @returns {{ effective: string|null, original: string|null }}
 */
function extractCommissionDates(row) {
  const raw = parseRawJson(row.raw_data);
  const effectiveRaw =
    row.effective_date ??
    raw['Effective Date'] ??
    raw.EffectiveDate ??
    raw.Effective_Date ??
    null;
  const originalRaw =
    raw['Original EffectiveDate'] ??
    raw['Original Effective Date'] ??
    raw.OriginalEffectiveDate ??
    null;
  return {
    effective: toComparableDate(effectiveRaw),
    original: toComparableDate(originalRaw),
  };
}

/**
 * Derive P2P first-class status from prior enrollment product-family evidence.
 * prior_product_family / current_product_family should already be canonicalized.
 */
function deriveP2PState(row) {
  const priorCount = parseInt(row.prior_enrollment_count, 10);
  if (!Number.isFinite(priorCount) || priorCount <= 0) {
    return STATUS.P2P_NEEDS_HISTORY;
  }

  const currentFamily = canonicalizeProductFamily(
    row.current_product || row.prod_product || row.product,
    row.current_product_type || row.prod_product_type || row.product_type
  );
  const priorFamily = canonicalizeProductFamily(
    row.prior_product,
    row.prior_product_type
  );

  if (
    currentFamily === 'UNKNOWN' ||
    priorFamily === 'UNKNOWN' ||
    currentFamily === 'AMBIGUOUS' ||
    priorFamily === 'AMBIGUOUS'
  ) {
    return STATUS.P2P_NEEDS_HISTORY;
  }

  if (currentFamily === priorFamily) return STATUS.LIKE_P2P_CANDIDATE;
  return STATUS.UNLIKE_P2P_CANDIDATE;
}

function groupForStatus(status) {
  switch (status) {
    case STATUS.SOURCE_NEW:
    case STATUS.SOURCE_P2P:
    case STATUS.SOURCE_CANCELLED:
      return GROUP.SOURCE_BACKED;
    case STATUS.LIKE_P2P_CANDIDATE:
    case STATUS.UNLIKE_P2P_CANDIDATE:
    case STATUS.P2P_NEEDS_HISTORY:
    case STATUS.RENEWAL_DATE_MISMATCH:
    case STATUS.RENEWAL_VS_NEW_PROD:
    case STATUS.NEEDS_CMS_PAYMENT_TYPE:
      return GROUP.SEMANTIC_MISMATCH;
    case STATUS.CHARGEBACK_DEFER:
      return GROUP.CHARGEBACK;
    case STATUS.PENDING_NO_MATCH:
      return GROUP.UNMATCHED;
    default:
      return null;
  }
}

/**
 * Classify a (possibly unmatched) commission row into an observation state.
 * Never returns EXCEPTION or FINAL — those are manual locks only.
 * Never mutates financial fields.
 *
 * @param {object} row
 * @returns {{ status: string, group: string|null, write: boolean }}
 */
function classifyRow(row) {
  // Manual locks are preserved by the caller; never emit them from classification.
  const existing = row.reconciliation_status || null;
  if (MANUAL_LOCK_STATUSES.has(existing)) {
    return { status: existing, group: row.recon_group || null, write: false };
  }

  if (isChargebackRow(row)) {
    return {
      status: STATUS.CHARGEBACK_DEFER,
      group: GROUP.CHARGEBACK,
      write: true,
    };
  }

  const hasMatch =
    row.has_crosswalk_match === true ||
    (row.ap_id != null && row.xwalk_id != null);
  if (!hasMatch) {
    return {
      status: STATUS.PENDING_NO_MATCH,
      group: GROUP.UNMATCHED,
      write: true,
    };
  }

  const prodNewP2P = normNewP2P(row.prod_new_p2p);
  const prodStatus = normStatus(row.prod_status);
  const isActive = PROD_ACTIVE_STATUSES.has(prodStatus);
  const isCancelled = PROD_CANCELLED_STATUSES.has(prodStatus);
  const isNew = prodNewP2P === 'new';
  const isP2P = prodNewP2P === 'p2p';
  const isRenewal = isRenewalTagged(row);
  const isFirstYear = isFirstYearTagged(row);

  if (isCancelled) {
    return {
      status: STATUS.SOURCE_CANCELLED,
      group: GROUP.SOURCE_BACKED,
      write: true,
    };
  }

  if (isActive) {
    // Commission renewal vs source production New — distinct from date-mismatch.
    // Prefer this source-backed conflict when both could apply.
    if (isRenewal && isNew) {
      return {
        status: STATUS.RENEWAL_VS_NEW_PROD,
        group: GROUP.SEMANTIC_MISMATCH,
        write: true,
      };
    }

    // Renewal-tagged AND Effective Date != Original EffectiveDate (Excel serials converted).
    // Not proof of plan change by itself; recorded as its own observation state.
    if (isRenewal) {
      const { effective, original } = extractCommissionDates(row);
      if (effective && original && effective !== original) {
        return {
          status: STATUS.RENEWAL_DATE_MISMATCH,
          group: GROUP.SEMANTIC_MISMATCH,
          write: true,
        };
      }
    }

    if (isFirstYear && isP2P) {
      const status = deriveP2PState(row);
      return { status, group: groupForStatus(status), write: true };
    }

    if (isNew) {
      return { status: STATUS.SOURCE_NEW, group: GROUP.SOURCE_BACKED, write: true };
    }
    if (isP2P) {
      // Generic P2P with no conflicting commission tag — still source-backed.
      // If prior history is absent, elevate to P2P_NEEDS_HISTORY when caller supplied counts.
      const priorCount = parseInt(row.prior_enrollment_count, 10);
      if (Number.isFinite(priorCount) && priorCount <= 0) {
        return {
          status: STATUS.P2P_NEEDS_HISTORY,
          group: GROUP.SEMANTIC_MISMATCH,
          write: true,
        };
      }
      if (Number.isFinite(priorCount) && priorCount > 0) {
        const status = deriveP2PState(row);
        if (status !== STATUS.SOURCE_P2P) {
          return { status, group: groupForStatus(status), write: true };
        }
      }
      return { status: STATUS.SOURCE_P2P, group: GROUP.SOURCE_BACKED, write: true };
    }

    // Matched + active but missing New_P2P / payment-type signal.
    if (!prodNewP2P) {
      return {
        status: STATUS.NEEDS_CMS_PAYMENT_TYPE,
        group: GROUP.SEMANTIC_MISMATCH,
        write: true,
      };
    }
  }

  // Renewal date mismatch can also apply when production is not Active
  // (still useful observation from the commission statement alone).
  if (isRenewal) {
    const { effective, original } = extractCommissionDates(row);
    if (effective && original && effective !== original) {
      return {
        status: STATUS.RENEWAL_DATE_MISMATCH,
        group: GROUP.SEMANTIC_MISMATCH,
        write: true,
      };
    }
  }

  // Unrecognised prod status — leave / set PROVISIONAL for human review.
  return { status: STATUS.PROVISIONAL, group: null, write: true };
}

/**
 * Assert a classification result does not propose financial field writes.
 * Used by tests and as a guard before any DB update payload is built.
 */
function assertNoFinancialWrites(updatePayload) {
  const forbidden = [
    'thei_share', 'bsi_share', 'producer_payable', 'gross_commission',
    'theiShare', 'bsiShare', 'albaComp', 'totalOverride', 'commission',
    'premium', 'agent_commission',
  ];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(updatePayload, key)) {
      throw new Error(`Financial field "${key}" must not appear in recon update payload`);
    }
  }
  return true;
}

function buildObservationUpdate(row, classification) {
  const payload = {
    crId: String(row.cr_id),
    status: classification.status,
    group: classification.group || null,
    matchId: row.ap_id != null ? String(row.ap_id) : null,
    newP2P: row.prod_new_p2p || null,
  };
  assertNoFinancialWrites(payload);
  return payload;
}

function isAllowedReconStatus(value) {
  return value == null || ALLOWED_RECON_STATUSES.includes(value);
}

module.exports = {
  ALLOWED_RECON_STATUSES,
  STATUS,
  MANUAL_LOCK_STATUSES,
  GROUP,
  excelSerialToDate,
  toComparableDate,
  canonicalizeProductFamily,
  sortedTokenKey,
  parseRawJson,
  isChargebackRow,
  extractCommissionDates,
  deriveP2PState,
  classifyRow,
  groupForStatus,
  assertNoFinancialWrites,
  buildObservationUpdate,
  isAllowedReconStatus,
};

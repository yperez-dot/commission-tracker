/**
 * Shared client/carrier normalization for Sales Recon, Agency Recon,
 * Missing Renewals, and records APIs. Keep one copy — money matching depends on it.
 *
 * ESM for the CRA frontend. Node/API code should require `./matchingNormalize.cjs`.
 */

export function toTitleCase(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Canonical client name for matching.
 * - "LAST, FIRST M." → "First Last" (strip MI + Jr/Sr)
 * - "First M. Last Jr" → "First Last"
 */
export function normName(name) {
  if (!name) return '';
  const s = String(name).trim();

  if (s.includes(',')) {
    let [last, first] = s.split(',').map((p) => p.trim());
    last = last.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
    first = first.replace(/(\s+[A-Za-z]\.?)+$/i, '').trim();
    return toTitleCase(`${first} ${last}`.replace(/\s+/g, ' ').trim());
  }

  let normalized = s.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/\b(JR|SR|III|II|IV|V)\.?$/i, '').trim();
  // Drop middle initials anywhere: "Maria L. Garcia" → "Maria Garcia"
  normalized = normalized.replace(/\s+[A-Za-z]\.?(?=\s|$)/g, '').trim();
  return toTitleCase(normalized);
}

export function nameVariants(name) {
  if (!name) return [];
  const norm = normName(name);
  const parts = norm.split(' ').filter(Boolean);
  const result = [norm];

  if (parts.length >= 2) {
    const noTrailingInitial = parts
      .filter((p, i) => !(i === parts.length - 1 && /^[A-Za-z]\.?$/.test(p)))
      .join(' ');
    if (noTrailingInitial !== norm) result.push(noTrailingInitial);

    const reversed = [...parts].reverse().join(' ');
    if (!result.includes(reversed)) result.push(reversed);

    const partsNoInitial = parts.filter(
      (p, i) => !(i === parts.length - 1 && /^[A-Za-z]\.?$/.test(p))
    );
    const reversedNoInitial = [...partsNoInitial].reverse().join(' ');
    if (!result.includes(reversedNoInitial)) result.push(reversedNoInitial);
  }
  return result;
}

function significantTokens(name) {
  return normName(name)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z]/g, ''))
    .filter((t) => t.length > 1);
}

/** Strict fuzzy: same token multiset OR (shared surname + shared given name). */
export function namesLooseMatch(a, b) {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (!ta.length || !tb.length) return false;

  const sa = [...ta].sort().join(' ');
  const sb = [...tb].sort().join(' ');
  if (sa === sb) return true;

  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t));
  if (shared.length < 2) return false;

  return shared.length >= 2 && shared.length >= Math.min(ta.length, tb.length) - 1;
}

/**
 * Canonical carrier family key for matching.
 * United of Omaha / Mutual of Omaha must NEVER collapse to UHC Medicare.
 */
export function normalizeCarrier(carrier) {
  const s = String(carrier || '')
    .toLowerCase()
    .trim();
  if (!s) return '';

  // Life / Omaha — check before generic "united"
  if (s.includes('mutual of omaha') || (s.includes('mutual') && s.includes('omaha'))) {
    return 'mutual of omaha';
  }
  if (s.includes('united of omaha') || (s.includes('omaha') && s.includes('united'))) {
    return 'united of omaha';
  }
  if (s.includes('omaha') && !s.includes('unitedhealthcare') && !s.includes('uhc')) {
    return 'united of omaha';
  }

  if ((s.includes('united') || s.includes('uhc')) && !s.includes('omaha')) {
    return 'unitedhealthcare';
  }
  if (s.includes('humana')) return 'humana';
  if (s.includes('aetna')) return 'aetna';
  if (s.includes('devoted')) return 'devoted health';
  if (s.includes('cigna')) return 'cigna';
  if (s.includes('oscar')) return 'oscar health';
  if (s.includes('florida blue') || s.includes('bcbs') || s.includes('blue cross') || s.includes('fl blue')) {
    return 'florida blue';
  }
  if (s.includes('gold kidney') || s.includes('goldkidney')) return 'gold kidney';
  if (s.includes('simply')) return 'simply';
  if (s.includes('molina')) return 'molina';
  if (s.includes('solis')) return 'solis';
  if (s.includes('healthsun') || s.includes('health sun')) return 'healthsun';
  if (s.includes('doctors')) return 'doctors healthcare';
  if (s.includes('avmed') || s.includes('av med')) return 'avmed';
  if (s.includes('careplus') || s.includes('care plus')) return 'careplus';
  if (s.includes('wellcare')) return 'wellcare';
  if (s.includes('elevance') || s.includes('anthem')) return 'elevance medicare';
  if (s.includes('healthspring')) return 'healthspring';
  if (s.includes('freedom')) return 'freedom';
  if (s.includes('nhp')) return 'nhp';

  return s;
}

/** Alias used by Missing Renewals / BOB paths */
export const normCarrier = normalizeCarrier;

/**
 * Exact match on canonical carrier keys.
 * Rejects empty carriers — `'humana'.includes('')` is true in JS and caused false pays.
 */
export function carriersMatch(a, b) {
  const ca = normalizeCarrier(a);
  const cb = normalizeCarrier(b);
  if (!ca || !cb) return false;
  return ca === cb;
}

/**
 * Compact key for maps that strip non-alphanumerics (records.js style).
 */
export function normalizeCarrierKey(carrier) {
  const n = normalizeCarrier(carrier);
  if (!n) return '';
  if (n === 'unitedhealthcare') return 'unitedhealthcare';
  if (n === 'florida blue') return 'floridablue';
  if (n === 'oscar health') return 'oscar';
  if (n === 'devoted health') return 'devoted';
  if (n === 'doctors healthcare') return 'doctors';
  if (n === 'elevance medicare') return 'elevance';
  if (n === 'gold kidney') return 'goldkidney';
  if (n === 'united of omaha') return 'unitedofomaha';
  if (n === 'mutual of omaha') return 'mutualofomaha';
  return n.replace(/[^a-z0-9]/g, '');
}

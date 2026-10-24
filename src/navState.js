'use strict';

/**
 * App-shell navigation helpers (pure, unit-tested):
 *  - sidebar accordion: which section is open
 *  - browser history: page + params ↔ URL hash (#/payroll-overrides?period=202609)
 *
 * A hash URL works on any static host (Netlify, Cloudflare Pages) without
 * rewrite rules, and a refresh / deep link lands on the same page.
 */

/** Section id whose children include `page` (null for top-level pages). */
function sectionForPage(navItems, page) {
  for (const item of navItems || []) {
    if (item.children && item.children.some((c) => c.id === page)) return item.id;
  }
  return null;
}

/** Accordion: clicking a header opens it (closing any other) or closes it if it is open. */
function toggleSection(openId, clickedId) {
  return openId === clickedId ? null : clickedId;
}

/** Is `sectionId` open? Exactly one section (or none) at a time. */
function isSectionOpen(openId, sectionId) {
  return openId === sectionId;
}

/**
 * Page + params → "#/page?k=v&list[]=a&list[]=b". Empty values are dropped.
 * Only strings, numbers, booleans and arrays of those are kept.
 */
function pageToHash(page, params) {
  const qs = new URLSearchParams();
  const p = params || {};
  for (const key of Object.keys(p).sort()) {
    const v = p[key];
    if (Array.isArray(v)) {
      for (const x of v) {
        if (x !== '' && x != null && typeof x !== 'object') qs.append(`${key}[]`, String(x));
      }
    } else if (v !== '' && v != null && typeof v !== 'object') {
      qs.append(key, String(v));
    }
  }
  const q = qs.toString();
  return `#/${encodeURIComponent(page || 'dashboard')}${q ? `?${q}` : ''}`;
}

/** "#/page?…" → { page, params }, or null when the hash is not an app route. */
function parseHash(hash) {
  const h = String(hash || '');
  const m = h.match(/^#\/([^?#]*)(?:\?(.*))?$/);
  if (!m || !m[1]) return null;
  let page;
  try { page = decodeURIComponent(m[1]); } catch (e) { return null; }
  const params = {};
  const qs = new URLSearchParams(m[2] || '');
  qs.forEach((value, key) => {
    if (key.endsWith('[]')) {
      const k = key.slice(0, -2);
      if (!Array.isArray(params[k])) params[k] = [];
      params[k].push(value);
    } else {
      params[key] = value;
    }
  });
  return { page, params };
}

/** Same route? (avoids pushing duplicate history entries) */
function sameRoute(a, b) {
  return !!a && !!b && pageToHash(a.page, a.params) === pageToHash(b.page, b.params);
}

/**
 * Page to open on load / after login: a valid hash wins (deep link, refresh),
 * then the last saved page, then the dashboard. Removed or unknown pages → dashboard.
 */
function initialRoute({ hash, savedPage, isKnownPage, removedPages }) {
  const known = (p) => !!p && !(removedPages && removedPages.has(p)) && (!isKnownPage || isKnownPage(p));
  const fromHash = parseHash(hash);
  if (fromHash && known(fromHash.page)) return fromHash;
  if (known(savedPage)) return { page: savedPage, params: {} };
  return { page: 'dashboard', params: {} };
}

module.exports = { sectionForPage, toggleSection, isSectionOpen, pageToHash, parseHash, sameRoute, initialRoute };

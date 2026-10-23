'use strict';

/**
 * Agent-name matching for schedule lists (Swan/Marco, Integrity) used by the splits.
 *
 * Carrier feeds spell the same person differently: a middle initial or middle name
 * ("First M Last", "First M. Last"), "Last, First M", extra punctuation, accents,
 * case, a Jr/Sr suffix. A list entry matches when:
 *  - the entry's words appear as whole words, in order and next to each other
 *    (the old "contains" rule, but on whole words, so a longer surname such as
 *    "Last" vs "Lastson" is NOT a match), or
 *  - for a person entry (first + last), the name's first word is the entry's first
 *    name and its last word is the entry's last name, with up to two middle names or
 *    initials between them, or the first name and last name are separated only by
 *    single-letter initials.
 * A different first or last name never matches, and neither does a first initial alone.
 */

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function words(s) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Name → word list; "Last, First M" is turned around to "First M Last". */
function agentNameWords(name) {
  const raw = String(name || '').trim();
  let w;
  const parts = raw.split(',');
  if (parts.length === 2 && words(parts[0]).length && words(parts[1]).length) {
    const after = words(parts[1]);
    // "Company, LLC" / "Smith, Jr" stay in order.
    const isSuffix = after.every((t) => SUFFIXES.has(t) || ['llc', 'inc', 'corp', 'co', 'pa', 'pllc'].includes(t));
    w = isSuffix ? words(raw) : [...after, ...words(parts[0])];
  } else {
    w = words(raw);
  }
  while (w.length > 2 && SUFFIXES.has(w[w.length - 1])) w.pop();
  return w;
}

function containsRun(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/** Does agent `name` match schedule `entry` (e.g. a lower-case "first last")? */
function agentNameMatches(name, entry) {
  const n = agentNameWords(name);
  const e = words(entry);
  if (!n.length || !e.length) return false;
  if (containsRun(n, e)) return true;
  // Company entries (3+ words): keep the old "contains" rule so e.g. "... Corp" still
  // matches "... Corporation".
  if (e.length >= 3) return n.join(' ').includes(e.join(' '));
  if (e.length !== 2) return false;
  const [first, last] = e;
  // First word / last word, up to two middle names or initials in between.
  if (n.length >= 3 && n.length <= 4 && n[0] === first && n[n.length - 1] === last) return true;
  // First name, then only single-letter initials, then the last name (anywhere in the name).
  for (let i = 0; i < n.length; i += 1) {
    if (n[i] !== first) continue;
    let j = i + 1;
    while (j < n.length && n[j].length === 1) j += 1;
    if (j > i + 1 && j < n.length && n[j] === last) return true;
  }
  return false;
}

/** Does `name` match any entry of `list`? */
function agentNameInList(name, list) {
  return (list || []).some((entry) => agentNameMatches(name, entry));
}

/** The pre-tolerant rule (lower-case substring) — kept only to spot rows the new rule picks up. */
function legacyAgentNameInList(name, list) {
  const n = String(name || '').toLowerCase().trim();
  return (list || []).some((entry) => n.includes(entry));
}

module.exports = {
  agentNameWords,
  agentNameMatches,
  agentNameInList,
  legacyAgentNameInList,
};

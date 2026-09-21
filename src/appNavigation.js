export const REMOVED_PAGES = new Set(['reports', 'agents', 'fix-aetna', 'fixaetna']);

export const THEI_ONLY_PAGES = new Set([
  'medicarepro-upload',
  'agency-production-upload',
  'agency-production-recon',
  'agent-payout-uploads',
  'direct-recon',
  'renewals',
  'pass-through-chargebacks',
  'reconciliation',
]);

export const KNOWN_PAGES = new Set([
  'dashboard',
  'upload',
  'medicarepro-upload',
  'agency-production-upload',
  'bsi-statements-upload',
  'agent-payout-uploads',
  'agency-production-recon',
  'alldata',
  'bob',
  'renewals',
  'reconciliation',
  'direct-recon',
  'pass-through-chargebacks',
  'payroll',
  'payroll-payouts',
  'payroll-overrides',
  'payroll-loa',
  'payroll-history',
  'payroll-adp',
  'users',
]);

const URL_PARAM_KEYS = ['search', 'tab'];

export function pathSegment(pathname) {
  return String(pathname || '').replace(/^\//, '').split('/')[0] || '';
}

export function pageFromPath(pathname) {
  const segment = pathSegment(pathname);
  if (!segment) return null;
  if (REMOVED_PAGES.has(segment)) return 'dashboard';
  if (!KNOWN_PAGES.has(segment)) return 'dashboard';
  return segment;
}

export function pathForPage(page, params = {}) {
  const safe = !page || REMOVED_PAGES.has(page) || !KNOWN_PAGES.has(page) ? 'dashboard' : page;
  const qs = new URLSearchParams();
  URL_PARAM_KEYS.forEach((key) => {
    const value = params[key];
    if (value != null && value !== '') qs.set(key, String(value));
  });
  const query = qs.toString();
  return `/${safe}${query ? `?${query}` : ''}`;
}

export function pageParamsFromLocation(location) {
  const state = location && location.state && typeof location.state === 'object' && !Array.isArray(location.state)
    ? { ...location.state }
    : {};
  const search = location && location.search ? new URLSearchParams(location.search) : new URLSearchParams();
  URL_PARAM_KEYS.forEach((key) => {
    const value = search.get(key);
    if (value && (state[key] == null || state[key] === '')) state[key] = value;
  });
  return state;
}

export function sameLocationTarget(pathname, search, state, page, params = {}) {
  const target = pathForPage(page, params);
  const current = `${pathname || ''}${search || ''}` || '/';
  if (current !== target) return false;
  try {
    return JSON.stringify(state || {}) === JSON.stringify(params || {});
  } catch {
    return false;
  }
}

export function tabFromSearch(search, allowedTabs, defaultTab) {
  const raw = new URLSearchParams(search || '').get('tab');
  return allowedTabs.includes(raw) ? raw : defaultTab;
}

export function nextTabSearch(search, tab, defaultTab) {
  const params = new URLSearchParams(search || '');
  if (!tab || tab === defaultTab) params.delete('tab');
  else params.set('tab', tab);
  return params.toString();
}

export function resolveCanonicalPage({ pathname, savedPage, isBsi }) {
  const segment = pathSegment(pathname);
  if (REMOVED_PAGES.has(segment) || (segment && !KNOWN_PAGES.has(segment))) {
    return { page: 'dashboard', replace: true };
  }
  if (!segment) {
    const saved = savedPage && !REMOVED_PAGES.has(savedPage) && KNOWN_PAGES.has(savedPage)
      ? savedPage
      : 'dashboard';
    return { page: saved, replace: true };
  }
  if (isBsi && THEI_ONLY_PAGES.has(segment)) {
    return { page: 'dashboard', replace: true };
  }
  return { page: segment, replace: false };
}

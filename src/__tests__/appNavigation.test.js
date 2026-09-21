import {
  KNOWN_PAGES,
  pageFromPath,
  pathForPage,
  pageParamsFromLocation,
  sameLocationTarget,
  tabFromSearch,
  nextTabSearch,
  resolveCanonicalPage,
} from '../appNavigation';

describe('appNavigation', () => {
  test('maps known sidebar paths and treats blank as unset', () => {
    expect(pageFromPath('/')).toBeNull();
    expect(pageFromPath('/dashboard')).toBe('dashboard');
    expect(pageFromPath('/payroll-payouts')).toBe('payroll-payouts');
    expect(pageFromPath('/payroll-overrides')).toBe('payroll-overrides');
    expect(pageFromPath('/direct-recon')).toBe('direct-recon');
    expect(KNOWN_PAGES.has('users')).toBe(true);
  });

  test('removed and unknown paths fall back to dashboard', () => {
    expect(pageFromPath('/reports')).toBe('dashboard');
    expect(pageFromPath('/not-a-real-page')).toBe('dashboard');
  });

  test('builds pushable paths and keeps filter objects out of the query string', () => {
    expect(pathForPage('payroll-payouts')).toBe('/payroll-payouts');
    expect(pathForPage('agency-production-recon', { search: 'Jane Doe' }))
      .toBe('/agency-production-recon?search=Jane+Doe');
    expect(pathForPage('alldata', { agents: ['Yahoska Perez'], period: '202601' }))
      .toBe('/alldata');
    expect(pathForPage('reports')).toBe('/dashboard');
  });

  test('merges location state with URL search/tab params', () => {
    const params = pageParamsFromLocation({
      search: '?search=Ana&tab=paid',
      state: { agents: ['Yahoska'], search: '' },
    });
    expect(params.search).toBe('Ana');
    expect(params.tab).toBe('paid');
    expect(params.agents).toEqual(['Yahoska']);
  });

  test('skips a push when the current route and state already match', () => {
    expect(sameLocationTarget('/alldata', '', { period: '202601' }, 'alldata', { period: '202601' })).toBe(true);
    expect(sameLocationTarget('/alldata', '', { period: '202601' }, 'alldata', { period: '202602' })).toBe(false);
    expect(sameLocationTarget('/dashboard', '', {}, 'payroll-payouts', {})).toBe(false);
    expect(sameLocationTarget('/dashboard', '', null, 'dashboard', {})).toBe(true);
  });

  test('sidebar hops push distinct paths so Back can restore the prior page', () => {
    const stack = ['/dashboard'];
    ['payroll', 'payroll-payouts', 'payroll-overrides'].forEach((page) => {
      stack.push(pathForPage(page));
    });
    expect(stack).toEqual([
      '/dashboard',
      '/payroll',
      '/payroll-payouts',
      '/payroll-overrides',
    ]);
    stack.pop();
    expect(pageFromPath(stack[stack.length - 1])).toBe('payroll-payouts');
    stack.pop();
    expect(pageFromPath(stack[stack.length - 1])).toBe('payroll');
    stack.pop();
    expect(pageFromPath(stack[stack.length - 1])).toBe('dashboard');
  });

  test('tab query updates push a new entry and drop the default tab', () => {
    expect(tabFromSearch('?tab=paid', ['unpaid', 'partial', 'paid'], 'unpaid')).toBe('paid');
    expect(tabFromSearch('', ['unpaid', 'partial', 'paid'], 'unpaid')).toBe('unpaid');
    expect(tabFromSearch('?tab=nope', ['unpaid', 'partial', 'paid'], 'unpaid')).toBe('unpaid');
    expect(nextTabSearch('', 'paid', 'unpaid')).toBe('tab=paid');
    expect(nextTabSearch('tab=paid', 'unpaid', 'unpaid')).toBe('');
  });

  test('canonicalizes first load, removed pages, and BSI-blocked THEI screens with replace', () => {
    expect(resolveCanonicalPage({ pathname: '/', savedPage: 'payroll-payouts' }))
      .toEqual({ page: 'payroll-payouts', replace: true });
    expect(resolveCanonicalPage({ pathname: '/', savedPage: 'reports' }))
      .toEqual({ page: 'dashboard', replace: true });
    expect(resolveCanonicalPage({ pathname: '/direct-recon', savedPage: 'dashboard', isBsi: true }))
      .toEqual({ page: 'dashboard', replace: true });
    expect(resolveCanonicalPage({ pathname: '/payroll-overrides', savedPage: 'dashboard' }))
      .toEqual({ page: 'payroll-overrides', replace: false });
    expect(resolveCanonicalPage({ pathname: '/legacy-agents', savedPage: 'dashboard' }))
      .toEqual({ page: 'dashboard', replace: true });
  });
});

import { sectionForPage, toggleSection, isSectionOpen, pageToHash, parseHash, sameRoute, initialRoute } from '../navState';
import { buildNavItems } from '../App';

jest.mock('../api', () => ({ apiFetch: jest.fn(), apiDownload: jest.fn(), apiUpload: jest.fn(), clearToken: jest.fn(), setToken: jest.fn() }));

describe('accordion logic', () => {
  const nav = buildNavItems({ isBSI: false, isAdmin: true });

  test('section for a child page, null for top-level pages', () => {
    expect(sectionForPage(nav, 'payroll-overrides')).toBe('payroll');
    expect(sectionForPage(nav, 'upload')).toBe('uploads');
    expect(sectionForPage(nav, 'direct-recon')).toBe('reconciliation');
    expect(sectionForPage(nav, 'dashboard')).toBeNull();
    expect(sectionForPage(nav, 'users')).toBeNull();
    expect(sectionForPage(nav, 'nope')).toBeNull();
  });

  test('opening a section closes the others; clicking the open header closes it', () => {
    let open = 'payroll';
    open = toggleSection(open, 'uploads');
    expect(open).toBe('uploads');
    expect(isSectionOpen(open, 'payroll')).toBe(false);
    expect(isSectionOpen(open, 'uploads')).toBe(true);
    open = toggleSection(open, 'uploads');
    expect(open).toBeNull();
    expect(['uploads', 'reconciliation', 'payroll'].some((id) => isSectionOpen(open, id))).toBe(false);
  });

  test('BSI view hides reconciliation section', () => {
    const bsi = buildNavItems({ isBSI: true, isAdmin: false });
    expect(bsi.map((i) => i.id)).toEqual(['dashboard', 'uploads', 'alldata', 'bob', 'payroll']);
  });
});

describe('history hash', () => {
  test('page + period round-trips', () => {
    const h = pageToHash('payroll-overrides', { period: '202609' });
    expect(h).toBe('#/payroll-overrides?period=202609');
    expect(parseHash(h)).toEqual({ page: 'payroll-overrides', params: { period: '202609' } });
  });

  test('no params → bare page; empty values dropped', () => {
    expect(pageToHash('dashboard')).toBe('#/dashboard');
    expect(pageToHash('alldata', { agent: '', carrier: null, period: '202608' })).toBe('#/alldata?period=202608');
  });

  test('arrays survive (even with one element) and special characters are encoded', () => {
    const params = { agents: ['Ana Lopez'], carriers: ['Aetna', 'Humana & Co'], search: 'O\'Neil #2' };
    const back = parseHash(pageToHash('alldata', params));
    expect(back).toEqual({ page: 'alldata', params });
  });

  test('non-app hashes are ignored', () => {
    expect(parseHash('')).toBeNull();
    expect(parseHash('#')).toBeNull();
    expect(parseHash('#/')).toBeNull();
    expect(parseHash('#section')).toBeNull();
  });

  test('sameRoute ignores key order', () => {
    expect(sameRoute({ page: 'a', params: { x: '1', y: '2' } }, { page: 'a', params: { y: '2', x: '1' } })).toBe(true);
    expect(sameRoute({ page: 'a', params: {} }, { page: 'b', params: {} })).toBe(false);
  });

  test('initialRoute: hash beats saved page; removed/unknown pages fall back', () => {
    const removedPages = new Set(['payroll-adp']);
    const isKnownPage = (p) => ['dashboard', 'payroll-overrides', 'bob'].includes(p);
    expect(initialRoute({ hash: '#/payroll-overrides?period=202609', savedPage: 'bob', isKnownPage, removedPages }))
      .toEqual({ page: 'payroll-overrides', params: { period: '202609' } });
    expect(initialRoute({ hash: '', savedPage: 'bob', isKnownPage, removedPages })).toEqual({ page: 'bob', params: {} });
    expect(initialRoute({ hash: '#/payroll-adp', savedPage: 'payroll-adp', isKnownPage, removedPages })).toEqual({ page: 'dashboard', params: {} });
    expect(initialRoute({ hash: '#/whatever', savedPage: null, isKnownPage, removedPages })).toEqual({ page: 'dashboard', params: {} });
  });
});

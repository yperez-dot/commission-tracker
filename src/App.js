import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, clearToken, setToken } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import AllData from './pages/AllData';
import MissingRenewals from './pages/MissingRenewals';
import Reconciliation from './pages/Reconciliation';
import BookOfBusiness from './pages/BookOfBusiness';
import Payroll from './pages/Payroll';
import AdminUsers from './pages/AdminUsers';
import MedicareProUpload from './pages/MedicareProUpload';
import AgencyProductionUpload from './pages/AgencyProductionUpload';
import AgencyProductionRecon from './pages/AgencyProductionRecon';
import BSIStatementsUpload from './pages/BSIStatementsUpload';
import AgentPayoutUploads from './pages/AgentPayoutUploads';
import PassThroughChargebacks from './pages/PassThroughChargebacks';
import './App.css';
import { sectionForPage, toggleSection, isSectionOpen, pageToHash, parseHash, initialRoute } from './navState';

const REMOVED_PAGES = new Set(['reports', 'agents', 'fix-aetna', 'fixaetna', 'payroll-adp']);

const THEI_ONLY_PAGES = new Set([
  'medicarepro-upload',
  'agency-production-upload',
  'agency-production-recon',
  'agent-payout-uploads',
  'direct-recon',
  'renewals',
  'pass-through-chargebacks',
  'reconciliation',
]);

/** Every page the shell can render (used to validate deep links / history entries). */
const PAGE_IDS = new Set([
  'dashboard', 'upload', 'medicarepro-upload', 'agency-production-upload', 'bsi-statements-upload',
  'agent-payout-uploads', 'agency-production-recon', 'alldata', 'bob', 'renewals', 'reconciliation',
  'direct-recon', 'pass-through-chargebacks', 'payroll', 'payroll-payouts', 'payroll-overrides',
  'payroll-loa', 'payroll-history', 'payroll-close', 'payroll-changelog', 'users',
]);

/** Sidebar menu for the current agency view / role. */
export function buildNavItems({ isBSI, isAdmin }) {
  const uploadChildren = [
    { id: 'upload', label: 'Commission Statements' },
    ...(!isBSI ? [
      { id: 'agent-payout-uploads', label: 'Agent Payout Uploads' },
      { id: 'medicarepro-upload', label: 'MedicarePro Sales' },
      { id: 'agency-production-upload', label: 'Agency Production' },
    ] : []),
    { id: 'bsi-statements-upload', label: 'BSI Statements' },
  ];
  return [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'uploads', label: 'Uploads', children: uploadChildren },
    { id: 'alldata', label: 'All Data' },
    { id: 'bob', label: 'Book of Business' },
    ...(!isBSI ? [{
      id: 'reconciliation',
      label: 'Reconciliation',
      children: [
        { id: 'direct-recon', label: 'Sales Reconciliation' },
        { id: 'agency-production-recon', label: 'Agency Override Recon' },
        { id: 'renewals', label: 'Missing Renewals' },
        { id: 'pass-through-chargebacks', label: 'Writer Chargebacks' },
      ],
    }] : []),
    {
      id: 'payroll',
      label: 'Payroll',
      children: [
        { id: 'payroll-payouts', label: 'Agent Payouts' },
        { id: 'payroll-overrides', label: 'Statements' },
        { id: 'payroll-loa', label: 'LOA' },
        { id: 'payroll-history', label: 'Payment History' },
        { id: 'payroll-close', label: 'Month Close' },
        { id: 'payroll-changelog', label: 'Change Log' },
      ],
    },
    ...(isAdmin ? [{ id: 'users', label: 'User Accounts' }] : []),
  ];
}

function currentHash() {
  return typeof window !== 'undefined' ? window.location.hash : '';
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [pageParams, setPageParams] = useState({});
  // Accordion: id of the one open sidebar section (or null).
  const [openSection, setOpenSection] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    localStorage.getItem('olicomm_sidebar_collapsed') === 'true'
  );
  const [agencyView, setAgencyView] = useState(
    localStorage.getItem('olicomm_agency_view') || 'The Health Experts Insurance'
  );

  function toggleSidebar() {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem('olicomm_sidebar_collapsed', newState.toString());
  }

  /**
   * Show a route. push → new browser history entry (Back returns here);
   * replace → rewrite the current entry; neither → history already moved (popstate).
   */
  const applyRoute = useCallback((route, { push = false, replace = false } = {}) => {
    const wanted = route && route.page;
    const ok = wanted && PAGE_IDS.has(wanted) && !REMOVED_PAGES.has(wanted);
    const next = ok ? wanted : 'dashboard';
    const params = ok ? ((route && route.params) || {}) : {};
    setPage(next);
    setPageParams(params);
    localStorage.setItem('he_page', next);
    const hash = pageToHash(next, params);
    if ((push || replace) && currentHash() !== hash) {
      const state = { page: next, params };
      if (push) window.history.pushState(state, '', hash);
      else window.history.replaceState(state, '', hash);
    }
  }, []);

  function handleAgencySwitch(val) {
    setAgencyView(val);
    localStorage.setItem('olicomm_agency_view', val);
    window.__olicomm_agency_override = val;
    applyRoute({ page, params: {} }, { replace: true });
  }

  React.useEffect(() => {
    window.__olicomm_agency_override = agencyView;
  }, [agencyView]);

  const checkAuth = useCallback(async () => {
    try {
      const data = await apiFetch('/auth/me');
      if (data?.user) {
        setUser(data.user);
        // Deep link / refresh: the URL hash wins, then the last page, then the dashboard.
        applyRoute(initialRoute({
          hash: currentHash(),
          savedPage: localStorage.getItem('he_page'),
          isKnownPage: (p) => PAGE_IDS.has(p),
          removedPages: REMOVED_PAGES,
        }), { replace: true });
      }
    } catch {
      clearToken();
    } finally {
      setLoading(false);
    }
  }, [applyRoute]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  // Back / Forward (and a hand-edited hash) move between OliComm pages.
  useEffect(() => {
    function onHistory() {
      const route = parseHash(currentHash());
      applyRoute(route || { page: 'dashboard', params: {} }, {});
    }
    window.addEventListener('popstate', onHistory);
    window.addEventListener('hashchange', onHistory);
    return () => {
      window.removeEventListener('popstate', onHistory);
      window.removeEventListener('hashchange', onHistory);
    };
  }, [applyRoute]);

  const isBSI = agencyView.toLowerCase().includes('broker society');

  useEffect(() => {
    if (!user) return;
    if (isBSI && THEI_ONLY_PAGES.has(page)) {
      applyRoute({ page: 'dashboard', params: {} }, { replace: true });
    }
  }, [isBSI, page, user, applyRoute]);

  // Only the section holding the current page is open; moving pages re-syncs it.
  const isAdmin = !!user && user.role === 'admin';
  useEffect(() => {
    setOpenSection(sectionForPage(buildNavItems({ isBSI, isAdmin }), page));
  }, [page, isBSI, isAdmin]);

  function handleLogin(token, userData) {
    setToken(token);
    localStorage.setItem('he_user', JSON.stringify(userData));
    setUser(userData);
    // After sign-in: open the deep-linked page if the URL has one, else the dashboard.
    applyRoute(initialRoute({
      hash: currentHash(),
      savedPage: null,
      isKnownPage: (p) => PAGE_IDS.has(p),
      removedPages: REMOVED_PAGES,
    }), { replace: true });
  }

  function handleLogout() {
    clearToken();
    localStorage.removeItem('he_user');
    setUser(null);
    setPage('dashboard');
    setPageParams({});
  }

  /** Every page change (sidebar and onNavigate) pushes a browser history entry. */
  function navigate(p, params = {}) {
    applyRoute({ page: p, params }, { push: true });
  }

  if (loading) return (
    <div style={{
      minHeight:'100vh', background:'#1A1209',
      display:'flex', alignItems:'center', justifyContent:'center',
      flexDirection:'column', gap:12
    }}>
      <div style={{ fontSize:36, fontWeight:'bold', color:'#C9A96E', fontFamily:'Georgia, serif', letterSpacing:'-1px' }}>OliComm</div>
      <div style={{ width:20, height:20, border:'2px solid rgba(201,169,110,0.3)', borderTopColor:'#C9A96E', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!user) return <Login onLogin={handleLogin} />;

  const navItems = buildNavItems({ isBSI, isAdmin });

  const effectiveUser = agencyView
    ? { ...user, agency: agencyView }
    : { ...user, agency: user.agency || '' };

  // key={agencyView} forces each page to remount when agency switches,
  // triggering all useEffect data fetches with the new agency header
  const pages = {
    dashboard: <Dashboard key={agencyView} user={effectiveUser} onNavigate={navigate} />,
    upload: <Upload key={agencyView} user={effectiveUser} onNavigate={navigate} />,
    'medicarepro-upload': <MedicareProUpload key={agencyView} user={effectiveUser} onNavigate={navigate} />,
    'agency-production-upload': <AgencyProductionUpload key={agencyView} user={effectiveUser} onNavigate={navigate} />,
    'bsi-statements-upload': <BSIStatementsUpload key={agencyView} user={effectiveUser} onNavigate={navigate} />,
    'agent-payout-uploads': <AgentPayoutUploads key={agencyView} user={effectiveUser} onNavigate={navigate} />,
    'agency-production-recon': <AgencyProductionRecon key={`${agencyView}-${pageParams.search || ''}`} user={effectiveUser} initialSearch={pageParams.search} />,
    alldata: <AllData key={`${agencyView}-${JSON.stringify(pageParams)}`} user={effectiveUser} initialFilters={pageParams} onNavigate={navigate} />,
    bob: <BookOfBusiness key={agencyView} user={effectiveUser} />,
    renewals: <MissingRenewals key={agencyView} user={effectiveUser} />,
    reconciliation: <Reconciliation key={agencyView} user={effectiveUser} />,
    'direct-recon': <Reconciliation key={agencyView} user={effectiveUser} />,
    'pass-through-chargebacks': <PassThroughChargebacks key={agencyView} user={effectiveUser} />,
    payroll: <Payroll key={agencyView} user={effectiveUser} initialTab="payroll" onNavigate={navigate} />,
    'payroll-payouts': <Payroll key={`${agencyView}-payouts`} user={effectiveUser} initialTab="payroll" onNavigate={navigate} />,
    'payroll-overrides': <Payroll key={`${agencyView}-overrides-${pageParams.period || ''}`} user={effectiveUser} initialTab="overrides" initialPeriod={pageParams.period} onNavigate={navigate} />,
    'payroll-loa': <Payroll key={`${agencyView}-loa`} user={effectiveUser} initialTab="loa" onNavigate={navigate} />,
    'payroll-history': <Payroll key={`${agencyView}-history`} user={effectiveUser} initialTab="history" onNavigate={navigate} />,
    'payroll-close': <Payroll key={`${agencyView}-close`} user={effectiveUser} initialTab="close" onNavigate={navigate} />,
    'payroll-changelog': <Payroll key={`${agencyView}-changelog`} user={effectiveUser} initialTab="changelog" onNavigate={navigate} />,
    users: <AdminUsers key={agencyView} user={effectiveUser} />
  };

  return (
    <div className="app-layout">
      <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-mark">HE</div>
          <div>
            <div className="logo-name">Health Experts</div>
            <div className="logo-sub">Commission Tracker</div>
          </div>
        </div>
        {user.role === 'admin' && !user.agency && (
          <div style={{padding:'10px 12px',borderBottom:'1px solid rgba(255,255,255,0.1)'}}>
            <div style={{fontSize:10,fontWeight:500,color:'rgba(255,255,255,0.6)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}}>Viewing</div>
            <select
              value={agencyView}
              onChange={e => handleAgencySwitch(e.target.value)}
              style={{
                width:'100%', padding:'6px 8px', borderRadius:6, fontSize:12,
                background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.95)',
                border:'1px solid rgba(255,255,255,0.2)', cursor:'pointer',
                outline:'none'
              }}
            >
              <option value="The Health Experts Insurance" style={{background:'#3D2B1F',color:'#fff'}}>THEI</option>
              <option value="Broker Society Insurance" style={{background:'#3D2B1F',color:'#fff'}}>BSI</option>
            </select>
          </div>
        )}
        <nav className="sidebar-nav">
          {navItems.map(item => {
            if (item.children) {
              const hasActiveChild = item.children.some(child => page === child.id);
              const isExpanded = isSectionOpen(openSection, item.id);
              return (
                <div key={item.id} className={`nav-section${isExpanded ? ' open' : ''}`}>
                  <button
                    className={`nav-item nav-section-header${hasActiveChild ? ' has-active' : ''}`}
                    aria-expanded={isExpanded}
                    data-section={item.id}
                    onClick={() => setOpenSection(toggleSection(openSection, item.id))}
                  >
                    {item.label}
                    <span className="nav-caret" aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
                  </button>
                  {isExpanded && (
                    <div className="nav-children">
                      {item.children.map(child => (
                        <button
                          key={child.id}
                          className={`nav-item nav-sub-item${page === child.id ? ' active' : ''}`}
                          aria-current={page === child.id ? 'page' : undefined}
                          onClick={() => navigate(child.id)}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <button
                key={item.id}
                className={`nav-item${page === item.id ? ' active' : ''}`}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => navigate(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          {!sidebarCollapsed && (
            <>
              <div className="user-chip">
                <div className="user-avatar">{user.name.charAt(0)}</div>
                <div>
                  <div className="user-name">{user.name.split(' ')[0]}</div>
                  <div className="user-role">{user.role}</div>
                </div>
              </div>
              <button className="logout-btn" onClick={handleLogout}>Logout</button>
            </>
          )}
          <button 
            onClick={toggleSidebar}
            style={{
              position: sidebarCollapsed ? 'fixed' : 'absolute',
              left: sidebarCollapsed ? '16px' : 'auto',
              right: sidebarCollapsed ? 'auto' : '8px',
              top: sidebarCollapsed ? '16px' : '12px',
              transform: 'none',
              background: sidebarCollapsed ? '#C9B5A7' : 'rgba(255,255,255,0.08)',
              border: sidebarCollapsed ? '2px solid #A89589' : '1px solid rgba(255,255,255,0.15)',
              color: sidebarCollapsed ? '#3D2B1F' : 'rgba(255,255,255,0.8)',
              width: sidebarCollapsed ? '40px' : '28px',
              height: sidebarCollapsed ? '40px' : '28px',
              borderRadius: sidebarCollapsed ? '8px' : '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: sidebarCollapsed ? '18px' : '16px',
              fontWeight: 'bold',
              boxShadow: sidebarCollapsed ? '0 4px 12px rgba(0,0,0,0.25)' : 'none',
              zIndex: 9999,
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => {
              if (sidebarCollapsed) {
                e.target.style.background = '#A89589';
                e.target.style.transform = 'scale(1.05)';
              } else {
                e.target.style.background = 'rgba(255,255,255,0.15)';
              }
            }}
            onMouseOut={(e) => {
              if (sidebarCollapsed) {
                e.target.style.background = '#C9B5A7';
                e.target.style.transform = 'scale(1)';
              } else {
                e.target.style.background = 'rgba(255,255,255,0.08)';
              }
            }}
            title={sidebarCollapsed ? 'Open Sidebar' : 'Close Sidebar'}
          >
            {sidebarCollapsed ? '☰' : '×'}
          </button>
        </div>
      </aside>
      <main className="main-content">
        {pages[page] || pages.dashboard}
      </main>
    </div>
  );
}

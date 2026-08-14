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
import PassThroughChargebacks from './pages/PassThroughChargebacks';
import './App.css';

const REMOVED_PAGES = new Set(['reports', 'agents', 'fix-aetna', 'fixaetna']);

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [pageParams, setPageParams] = useState({});
  const [expandedMenus, setExpandedMenus] = useState({ uploads: false, reconciliation: false, payroll: false });
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

  function handleAgencySwitch(val) {
    setAgencyView(val);
    localStorage.setItem('olicomm_agency_view', val);
    window.__olicomm_agency_override = val;
  }

  React.useEffect(() => {
    window.__olicomm_agency_override = agencyView;
  }, [agencyView]);

  const checkAuth = useCallback(async () => {
    try {
      const data = await apiFetch('/auth/me');
      if (data?.user) {
        setUser(data.user);
        const saved = localStorage.getItem('he_page');
        if (saved && !REMOVED_PAGES.has(saved)) setPage(saved);
        else if (saved && REMOVED_PAGES.has(saved)) {
          localStorage.setItem('he_page', 'dashboard');
          setPage('dashboard');
        }
      }
    } catch {
      clearToken();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  function handleLogin(token, userData) {
    setToken(token);
    localStorage.setItem('he_user', JSON.stringify(userData));
    setUser(userData);
    setPage('dashboard');
  }

  function handleLogout() {
    clearToken();
    localStorage.removeItem('he_user');
    setUser(null);
    setPage('dashboard');
    setPageParams({});
  }

  function navigate(p, params = {}) {
    const next = REMOVED_PAGES.has(p) ? 'dashboard' : p;
    setPage(next);
    setPageParams(params);
    localStorage.setItem('he_page', next);
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

  const isBSI = agencyView.toLowerCase().includes('broker society');

  const THEI_ONLY_PAGES = new Set([
    'medicarepro-upload',
    'agency-production-upload',
    'agency-production-recon',
    'direct-recon',
    'renewals',
    'pass-through-chargebacks',
    'reconciliation',
  ]);

  useEffect(() => {
    if (isBSI && THEI_ONLY_PAGES.has(page)) {
      setPage('dashboard');
      setPageParams({});
      localStorage.setItem('he_page', 'dashboard');
    }
  }, [isBSI, page]);

  const uploadChildren = [
    { id: 'upload', label: 'Commission Statements' },
    ...(!isBSI ? [
      { id: 'medicarepro-upload', label: 'MedicarePro Sales' },
      { id: 'agency-production-upload', label: 'Agency Production' },
    ] : []),
    { id: 'bsi-statements-upload', label: 'BSI Statements' },
  ];

  const navItems = [
    { id: 'dashboard', label: 'Dashboard' },
    {
      id: 'uploads',
      label: 'Uploads',
      children: uploadChildren,
    },
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
      ]
    }] : []),
    {
      id: 'payroll',
      label: 'Payroll',
      children: [
        { id: 'payroll-payouts', label: 'Agent Payouts' },
        { id: 'payroll-overrides', label: 'House Statements' },
        { id: 'payroll-loa', label: 'LOA' },
        { id: 'payroll-history', label: 'Payment History' },
      ]
    },
    ...(user.role === 'admin' ? [
      { id: 'users', label: 'User Accounts' },
    ] : [])
  ];

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
    'agency-production-recon': <AgencyProductionRecon key={agencyView} user={effectiveUser} />,
    alldata: <AllData key={agencyView} user={effectiveUser} initialFilters={pageParams} />,
    bob: <BookOfBusiness key={agencyView} user={effectiveUser} />,
    renewals: <MissingRenewals key={agencyView} user={effectiveUser} />,
    reconciliation: <Reconciliation key={agencyView} user={effectiveUser} />,
    'direct-recon': <Reconciliation key={agencyView} user={effectiveUser} />,
    'pass-through-chargebacks': <PassThroughChargebacks key={agencyView} user={effectiveUser} />,
    payroll: <Payroll key={agencyView} user={effectiveUser} initialTab="payroll" onNavigate={navigate} />,
    'payroll-payouts': <Payroll key={`${agencyView}-payouts`} user={effectiveUser} initialTab="payroll" onNavigate={navigate} />,
    'payroll-overrides': <Payroll key={`${agencyView}-overrides`} user={effectiveUser} initialTab="overrides" onNavigate={navigate} />,
    'payroll-loa': <Payroll key={`${agencyView}-loa`} user={effectiveUser} initialTab="loa" onNavigate={navigate} />,
    'payroll-history': <Payroll key={`${agencyView}-history`} user={effectiveUser} initialTab="history" onNavigate={navigate} />,
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
              const isExpanded = expandedMenus[item.id] || hasActiveChild;
              return (
                <div key={item.id}>
                  <button
                    className={`nav-item${hasActiveChild ? ' active' : ''}`}
                    onClick={() => setExpandedMenus({...expandedMenus, [item.id]: !isExpanded})}
                  >
                    {item.label}
                    <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div style={{ paddingLeft: 12 }}>
                      {item.children.map(child => (
                        <button
                          key={child.id}
                          className={`nav-item nav-sub-item${page === child.id ? ' active' : ''}`}
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

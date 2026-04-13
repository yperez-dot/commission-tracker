import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, clearToken, setToken } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import AllData from './pages/AllData';
import MissingRenewals from './pages/MissingRenewals';
import Agents from './pages/Agents';
import Reconciliation from './pages/Reconciliation';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard');

  const checkAuth = useCallback(async () => {
    try {
      const data = await apiFetch('/auth/me');
      if (data?.user) {
        setUser(data.user);
        const saved = localStorage.getItem('he_page');
        if (saved) setPage(saved);
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
  }

  function navigate(p) {
    setPage(p);
    localStorage.setItem('he_page', p);
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="logo-mark">HE</div>
      <p>Loading...</p>
    </div>
  );

  if (!user) return <Login onLogin={handleLogin} />;

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '◼' },
    { id: 'upload', label: 'Upload', icon: '↑' },
    { id: 'alldata', label: 'All Data', icon: '≡' },
    { id: 'renewals', label: 'Missing Renewals', icon: '!' },
    { id: 'reconciliation', label: 'Reconciliation', icon: '⇄' },
    ...(user.role === 'admin' ? [{ id: 'agents', label: 'Agents', icon: '●' }] : [])
  ];

  const pages = {
    dashboard: <Dashboard user={user} />,
    upload: <Upload user={user} />,
    alldata: <AllData user={user} />,
    renewals: <MissingRenewals user={user} />,
    reconciliation: <Reconciliation user={user} />,
    agents: <Agents user={user} />
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark">HE</div>
          <div>
            <div className="logo-name">Health Experts</div>
            <div className="logo-sub">Commission Tracker</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item${page === item.id ? ' active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{user.name.charAt(0)}</div>
            <div>
              <div className="user-name">{user.name.split(' ')[0]}</div>
              <div className="user-role">{user.role}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </aside>
      <main className="main-content">
        {pages[page] || pages.dashboard}
      </main>
    </div>
  );
}

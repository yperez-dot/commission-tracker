import React, { useState } from 'react';
import { apiFetch, setToken } from '../api';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setToken(data.token);
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">HE</div>
          <div className="login-title">Health Experts Insurance</div>
          <div className="login-sub">Commission Tracker — sign in to continue</div>
        </div>

        {error && <div className="alert alert-error" style={{marginBottom:20}}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@healthexps.com"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{width:'100%', justifyContent:'center', marginTop:8}}
            disabled={loading}
          >
            {loading ? <><span className="spinner"></span> Signing in...</> : 'Sign in'}
          </button>
        </form>

        <p style={{fontSize:12, color:'var(--text-muted)', marginTop:20, textAlign:'center', lineHeight:1.6}}>
          Default admin: yahoska@healthexps.com<br/>
          Default agents: [name]@healthexps.com / Agent2024!<br/>
          <strong>Change passwords after first login.</strong>
        </p>
      </div>
    </div>
  );
}

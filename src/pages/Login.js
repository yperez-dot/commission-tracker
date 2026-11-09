import React, { useState } from 'react';
import { apiFetch, setToken } from '../api';

const API_BASE = process.env.REACT_APP_API_URL || '';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tempToken, setTempToken] = useState(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.requires2fa && data.tempToken) {
        // Do NOT store tempToken as the session JWT
        setTempToken(data.tempToken);
        setCode('');
        setUseBackup(false);
        return;
      }
      if (!data.token || !data.user) {
        throw new Error('Unexpected login response');
      }
      setToken(data.token);
      onLogin(data.token, data.user);
    } catch (err) {
      const msg = String(err && err.message ? err.message : '');
      if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
        setError(
          'Cannot reach the OliComm API from this page. Try https://melodic-cendol-e1dc49.netlify.app — if that works, the custom domain is blocked (Cloudflare Bot Fight / CORS).'
        );
      } else {
        setError(msg || 'Invalid email or password');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handle2faSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Verify does not use the session Authorization header (temp token is in the body)
      const res = await fetch(`${API_BASE}/api/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Invalid code');
      }
      setToken(data.token);
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Invalid authenticator or backup code');
    } finally {
      setLoading(false);
    }
  }

  function backToPassword() {
    setTempToken(null);
    setCode('');
    setUseBackup(false);
    setError('');
  }

  const labelStyle = {
    fontSize: 10,
    color: '#6B4F35',
    letterSpacing: '2px',
    textTransform: 'uppercase',
    marginBottom: 8,
    fontFamily: "'Georgia', serif",
    fontWeight: 600,
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FAF6F0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Georgia', 'Times New Roman', serif",
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `radial-gradient(ellipse at 20% 50%, rgba(201,169,110,0.14) 0%, transparent 60%),
          radial-gradient(ellipse at 80% 20%, rgba(168,133,74,0.09) 0%, transparent 50%),
          radial-gradient(ellipse at 60% 80%, rgba(201,169,110,0.10) 0%, transparent 40%)`,
        pointerEvents: 'none'
      }}/>
      <div style={{position:'absolute',top:0,left:0,right:0,height:'1px',background:'linear-gradient(90deg, transparent, rgba(201,169,110,0.3), transparent)'}}/>
      <div style={{position:'absolute',bottom:0,left:0,right:0,height:'1px',background:'linear-gradient(90deg, transparent, rgba(201,169,110,0.3), transparent)'}}/>

      <div style={{
        width: 400,
        padding: '48px 44px',
        position: 'relative',
        zIndex: 1,
        animation: 'fadeUp 0.5s ease both',
      }}>
        <style>{`
          @keyframes fadeUp {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          .login-input {
            width: 100%;
            background: rgba(255,255,255,0.65);
            border: 0.5px solid rgba(201,169,110,0.35);
            border-radius: 6px;
            padding: 12px 14px;
            color: #3D2B1F;
            font-size: 14px;
            font-family: 'Georgia', serif;
            outline: none;
            transition: border-color 0.2s, background 0.2s;
            box-sizing: border-box;
          }
          .login-input::placeholder { color: rgba(61,43,31,0.35); }
          .login-input:focus {
            border-color: rgba(168,133,74,0.65);
            background: #ffffff;
          }
          .login-btn {
            width: 100%;
            background: linear-gradient(135deg, #C9A96E, #A8823F);
            border: none;
            border-radius: 6px;
            padding: 13px;
            color: #1A1209;
            font-size: 13px;
            font-weight: bold;
            font-family: 'Georgia', serif;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            cursor: pointer;
            transition: opacity 0.2s, transform 0.1s;
            margin-top: 8px;
          }
          .login-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
          .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .login-link {
            background: none; border: none; color: #A8854A; font-size: 12px;
            cursor: pointer; text-decoration: underline; font-family: Georgia, serif;
            margin-top: 12px;
          }
        `}</style>

        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            fontSize: 42, fontWeight: 'bold', color: '#C9A96E',
            letterSpacing: '-1px', lineHeight: 1, marginBottom: 8,
            fontFamily: "'Georgia', 'Times New Roman', serif"
          }}>OliComm</div>
          <div style={{
            width: 40, height: 1,
            background: 'linear-gradient(90deg, transparent, #C9A96E, transparent)',
            margin: '12px auto 14px'
          }}/>
          <div style={{
            fontSize: 11, color: '#A8854A', letterSpacing: '3px',
            textTransform: 'uppercase', fontFamily: "'Georgia', serif", fontWeight: 600
          }}>Commission Tracker</div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(220,80,60,0.12)',
            border: '0.5px solid rgba(220,80,60,0.35)',
            borderRadius: 6, padding: '10px 14px', marginBottom: 20,
            fontSize: 13, color: '#E8897A', textAlign: 'center'
          }}>{error}</div>
        )}

        {!tempToken ? (
          <form onSubmit={handlePasswordSubmit}>
            <div style={{ marginBottom: 16 }}>
              <div style={labelStyle}>Email</div>
              <input className="login-input" type="email" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required autoFocus />
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={labelStyle}>Password</div>
              <input className="login-input" type="password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="••••••••••" required />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handle2faSubmit}>
            <div style={{ marginBottom: 8, fontSize: 13, color: '#6B4F35', textAlign: 'center' }}>
              {useBackup
                ? 'Enter one of your one-time backup codes'
                : 'Enter the 6-digit code from your authenticator app'}
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={labelStyle}>{useBackup ? 'Backup code' : 'Authenticator code'}</div>
              <input
                className="login-input"
                type="text"
                inputMode={useBackup ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder={useBackup ? 'ABCD-EFGH' : '123456'}
                required
                autoFocus
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <div style={{ textAlign: 'center' }}>
              <button type="button" className="login-link" onClick={() => { setUseBackup(v => !v); setCode(''); setError(''); }}>
                {useBackup ? 'Use authenticator app instead' : 'Use a backup code'}
              </button>
              <br />
              <button type="button" className="login-link" onClick={backToPassword}>
                ← Back to password
              </button>
            </div>
          </form>
        )}

        <div style={{
          marginTop: 32, paddingTop: 20,
          borderTop: '0.5px solid rgba(168,133,74,0.25)',
          textAlign: 'center', fontSize: 11, color: 'rgba(61,43,31,0.55)',
          letterSpacing: '0.5px', lineHeight: 1.8
        }}>
          Powered by OliComm · Confidential
        </div>
      </div>
    </div>
  );
}

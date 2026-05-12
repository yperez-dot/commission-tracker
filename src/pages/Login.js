
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
      {/* Background texture — soft warm tones */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `radial-gradient(ellipse at 20% 50%, rgba(201,169,110,0.14) 0%, transparent 60%),
          radial-gradient(ellipse at 80% 20%, rgba(168,133,74,0.09) 0%, transparent 50%),
          radial-gradient(ellipse at 60% 80%, rgba(201,169,110,0.10) 0%, transparent 40%)`,
        pointerEvents: 'none'
      }}/>

      {/* Decorative lines */}
      <div style={{position:'absolute',top:0,left:0,right:0,height:'1px',background:'linear-gradient(90deg, transparent, rgba(201,169,110,0.3), transparent)'}}/>
      <div style={{position:'absolute',bottom:0,left:0,right:0,height:'1px',background:'linear-gradient(90deg, transparent, rgba(201,169,110,0.3), transparent)'}}/>

      <div style={{
        width: 400,
        padding: '48px 44px',
        position: 'relative',
        zIndex: 1,
        animation: 'fadeUp 0.5s ease both',
        animationFillMode: 'forwards',
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
        `}</style>

        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            fontSize: 42,
            fontWeight: 'bold',
            color: '#C9A96E',
            letterSpacing: '-1px',
            lineHeight: 1,
            marginBottom: 8,
            fontFamily: "'Georgia', 'Times New Roman', serif"
          }}>
            OliComm
          </div>
          <div style={{
            width: 40, height: 1,
            background: 'linear-gradient(90deg, transparent, #C9A96E, transparent)',
            margin: '12px auto 14px'
          }}/>
          <div style={{
            fontSize: 11,
            color: 'rgba(201,169,110,0.6)',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            fontFamily: "'Georgia', serif"
          }}>
            Commission Tracker
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(220,80,60,0.12)',
            border: '0.5px solid rgba(220,80,60,0.35)',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 20,
            fontSize: 13,
            color: '#E8897A',
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 10,
              color: 'rgba(201,169,110,0.5)',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              marginBottom: 8,
              fontFamily: "'Georgia', serif"
            }}>Email</div>
            <input
              className="login-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: 10,
              color: 'rgba(201,169,110,0.5)',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              marginBottom: 8,
              fontFamily: "'Georgia', serif"
            }}>Password</div>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••••"
              required
            />
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{
                  width: 12, height: 12,
                  border: '2px solid rgba(26,18,9,0.3)',
                  borderTopColor: '#1A1209',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite'
                }}/>
                Signing in...
              </span>
            ) : 'Sign In'}
          </button>
        </form>

        {/* Footer */}
        <div style={{
          marginTop: 32,
          paddingTop: 20,
          borderTop: '0.5px solid rgba(201,169,110,0.12)',
          textAlign: 'center',
          fontSize: 11,
          color: 'rgba(240,234,216,0.4)',
          letterSpacing: '0.5px',
          lineHeight: 1.8
        }}>
          Powered by OliComm · Confidential
        </div>
      </div>
    </div>
  );
}


import React, { useState } from 'react';
import { setToken } from '../api';
import { authPost } from '../authApi';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 'password' → 'verify' (has 2FA) or 'enroll' (must set it up) → 'backup' (show codes once)
  const [step, setStep] = useState('password');
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [enroll, setEnroll] = useState(null);
  const [backupCodes, setBackupCodes] = useState([]);
  const [session, setSession] = useState(null);
  const [savedCodes, setSavedCodes] = useState(false);

  function restart(message) {
    setStep('password');
    setMfaToken('');
    setCode('');
    setUseBackup(false);
    setEnroll(null);
    setPassword('');
    setError(message || '');
  }

  function handleAuthError(err) {
    if (err.status === 401 && /expired/i.test(err.message)) return restart(err.message);
    if (err.status === 409) return restart(err.message);
    setError(err.message || 'Sign-in failed');
  }

  async function startEnrollment(token) {
    const data = await authPost('/mfa/enroll/start', { mfaToken: token });
    setEnroll(data);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authPost('/login', { email, password });
      setMfaToken(data.mfaToken);
      setCode('');
      if (data.mfaEnrollRequired) {
        setStep('enroll');
        await startEnrollment(data.mfaToken);
      } else {
        setStep('verify');
      }
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authPost('/mfa/verify', { mfaToken, code });
      if (typeof data.backupCodesRemaining === 'number' && data.backupCodesRemaining <= 3) {
        window.alert(`You have ${data.backupCodesRemaining} backup code${data.backupCodesRemaining === 1 ? '' : 's'} left. Ask an admin to reset your two-factor if you run out.`);
      }
      setToken(data.token);
      onLogin(data.token, data.user);
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmEnroll(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authPost('/mfa/enroll/confirm', { mfaToken, code });
      setBackupCodes(data.backupCodes || []);
      setSession({ token: data.token, user: data.user });
      setStep('backup');
    } catch (err) {
      handleAuthError(err);
    } finally {
      setLoading(false);
    }
  }

  function downloadCodes() {
    const text = ['OliComm backup codes', `Account: ${email}`, 'Each code works once.', '', ...backupCodes].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'olicomm-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  function finishEnrollment() {
    setToken(session.token);
    onLogin(session.token, session.user);
  }

  const labelStyle = {
    fontSize: 10, color: '#6B4F35', letterSpacing: '2px', textTransform: 'uppercase',
    marginBottom: 8, fontFamily: "'Georgia', serif", fontWeight: 600,
  };
  const helpStyle = { fontSize: 13, color: '#3D2B1F', lineHeight: 1.6, marginBottom: 16, textAlign: 'center' };
  const linkBtn = {
    background: 'none', border: 'none', color: '#A8823F', cursor: 'pointer',
    fontFamily: "'Georgia', serif", fontSize: 12, textDecoration: 'underline', padding: 0,
  };
  const spinner = (label) => (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <span style={{
        width: 12, height: 12, border: '2px solid rgba(26,18,9,0.3)', borderTopColor: '#1A1209',
        borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite',
      }}/>
      {label}
    </span>
  );
  const codeInput = (placeholder, backup) => (
    <input
      className="login-input"
      type="text"
      inputMode={backup ? 'text' : 'numeric'}
      autoComplete="one-time-code"
      value={code}
      onChange={e => setCode(backup ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder={placeholder}
      maxLength={backup ? 11 : 6}
      required
      autoFocus
      style={{ textAlign: 'center', letterSpacing: backup ? '2px' : '8px', fontSize: 18 }}
    />
  );

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
            color: '#A8854A',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            fontFamily: "'Georgia', serif",
            fontWeight: 600
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

        {/* Step 1: email + password */}
        {step === 'password' && (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 10,
                color: '#6B4F35',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                marginBottom: 8,
                fontFamily: "'Georgia', serif",
                fontWeight: 600
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
                color: '#6B4F35',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                marginBottom: 8,
                fontFamily: "'Georgia', serif",
                fontWeight: 600
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
                  Checking...
                </span>
              ) : 'Continue'}
            </button>
          </form>
        )}

        {step === 'verify' && (
          <form onSubmit={handleVerify}>
            <div style={helpStyle}>
              {useBackup
                ? 'Enter one of your backup codes. Each code works once.'
                : 'Enter the 6-digit code from your authenticator app.'}
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={labelStyle}>{useBackup ? 'Backup code' : 'Authentication code'}</div>
              {codeInput(useBackup ? 'XXXXX-XXXXX' : '123456', useBackup)}
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? spinner('Verifying...') : 'Sign In'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <button type="button" style={linkBtn} onClick={() => { setUseBackup(b => !b); setCode(''); setError(''); }}>
                {useBackup ? 'Use authenticator app' : 'Use a backup code'}
              </button>
              <button type="button" style={linkBtn} onClick={() => restart('')}>Start over</button>
            </div>
          </form>
        )}

        {step === 'enroll' && (
          <form onSubmit={handleConfirmEnroll}>
            <div style={helpStyle}>
              <strong>Set up two-factor sign-in.</strong><br/>
              OliComm now requires it. Scan this code with Google Authenticator,
              Microsoft Authenticator, 1Password or Authy, then enter the 6-digit code it shows.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              {enroll ? (
                <img src={enroll.qrDataUrl} alt="QR code for your authenticator app" width={200} height={200}
                  style={{ background: '#fff', padding: 8, borderRadius: 6, border: '0.5px solid rgba(201,169,110,0.35)' }}/>
              ) : (
                <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A8854A', fontSize: 12 }}>
                  Loading…
                </div>
              )}
            </div>
            {enroll && (
              <div style={{ fontSize: 11, color: '#6B4F35', textAlign: 'center', marginBottom: 16, lineHeight: 1.6 }}>
                Can't scan? Enter this key in the app:<br/>
                <code style={{ fontSize: 12, letterSpacing: '1px', userSelect: 'all', color: '#3D2B1F' }}>{enroll.manualKey}</code>
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <div style={labelStyle}>Code from the app</div>
              {codeInput('123456', false)}
            </div>
            <button type="submit" className="login-btn" disabled={loading || !enroll}>
              {loading ? spinner('Verifying...') : 'Turn on two-factor'}
            </button>
            <div style={{ textAlign: 'right', marginTop: 16 }}>
              <button type="button" style={linkBtn} onClick={() => restart('')}>Start over</button>
            </div>
          </form>
        )}

        {step === 'backup' && (
          <div>
            <div style={helpStyle}>
              <strong>Two-factor is on.</strong><br/>
              Save these backup codes somewhere safe. Each one signs you in once if you lose your phone.
              They won't be shown again.
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16,
              background: '#fff', padding: 14, borderRadius: 6, border: '0.5px solid rgba(201,169,110,0.35)',
              fontFamily: 'monospace', fontSize: 14, color: '#3D2B1F', textAlign: 'center',
            }}>
              {backupCodes.map(c => <div key={c}>{c}</div>)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button type="button" className="login-btn" style={{ marginTop: 0, background: '#fff', border: '0.5px solid #C9A96E' }} onClick={downloadCodes}>Download</button>
              <button type="button" className="login-btn" style={{ marginTop: 0, background: '#fff', border: '0.5px solid #C9A96E' }}
                onClick={() => navigator.clipboard && navigator.clipboard.writeText(backupCodes.join('\n'))}>Copy</button>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#3D2B1F', marginBottom: 8 }}>
              <input type="checkbox" checked={savedCodes} onChange={e => setSavedCodes(e.target.checked)} />
              I saved my backup codes
            </label>
            <button type="button" className="login-btn" disabled={!savedCodes} onClick={finishEnrollment}>
              Continue to OliComm
            </button>
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 32,
          paddingTop: 20,
          borderTop: '0.5px solid rgba(168,133,74,0.25)',
          textAlign: 'center',
          fontSize: 11,
          color: 'rgba(61,43,31,0.55)',
          letterSpacing: '0.5px',
          lineHeight: 1.8
        }}>
          Powered by OliComm · Confidential
        </div>
      </div>
    </div>
  );
}

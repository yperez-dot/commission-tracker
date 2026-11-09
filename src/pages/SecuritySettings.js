import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

export default function SecuritySettings({ user }) {
  const [status, setStatus] = useState({ enabled: false, verifiedAt: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Enrollment
  const [setup, setSetup] = useState(null); // { otpauthUrl, qrDataUrl, secret }
  const [confirmCode, setConfirmCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);

  // Disable
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  // Regenerate
  const [regenCode, setRegenCode] = useState('');

  async function loadStatus() {
    setLoading(true);
    try {
      const data = await apiFetch('/auth/2fa/status');
      setStatus(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStatus(); }, []);

  async function startSetup() {
    setError('');
    setMessage('');
    setBusy(true);
    setBackupCodes(null);
    try {
      const data = await apiFetch('/auth/2fa/setup', { method: 'POST', body: '{}' });
      setSetup(data);
      setConfirmCode('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function enable2fa(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch('/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: confirmCode.trim() }),
      });
      setBackupCodes(data.backupCodes || []);
      setSetup(null);
      setConfirmCode('');
      setMessage('Two-factor authentication is on. Save your backup codes now — they are shown only once.');
      loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable2fa(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiFetch('/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: disablePassword, code: disableCode.trim() }),
      });
      setDisablePassword('');
      setDisableCode('');
      setBackupCodes(null);
      setSetup(null);
      setMessage('Two-factor authentication is off.');
      loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiFetch('/auth/2fa/backup-codes/regenerate', {
        method: 'POST',
        body: JSON.stringify({ code: regenCode.trim() }),
      });
      setBackupCodes(data.backupCodes || []);
      setRegenCode('');
      setMessage('New backup codes generated. Save them now — they replace the old ones.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadBackupCodes() {
    if (!backupCodes || !backupCodes.length) return;
    const body = [
      'OliComm backup codes',
      `Account: ${user?.email || ''}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      ...backupCodes,
      '',
      'Each code can be used once. Store these somewhere safe.',
    ].join('\n');
    const blob = new Blob([body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'olicomm-2fa-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Security</div>
        <div className="page-sub">Optional authenticator app (TOTP) for your OliComm sign-in</div>
      </div>
      <div className="page-body">
        {message && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg-subtle)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 13 }}>
            {message}
          </div>
        )}
        {error && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(220,80,60,0.08)', border: '0.5px solid rgba(220,80,60,0.35)', borderRadius: 8, fontSize: 13, color: '#b33' }}>
            {error}
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Two-factor authentication</div>
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              Status:{' '}
              <strong style={{ color: status.enabled ? 'var(--accent-dark)' : 'var(--text-muted)' }}>
                {status.enabled ? 'On' : 'Off (optional)'}
              </strong>
              {status.verifiedAt && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                  enabled {new Date(status.verifiedAt).toLocaleString()}
                </span>
              )}
              <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                When off, you sign in with email and password only — same as today. Turning it on asks for a
                6-digit code from an authenticator app (Google Authenticator, Authy, 1Password, etc.) after your password.
              </div>
            </div>
          )}
        </div>

        {backupCodes && backupCodes.length > 0 && (
          <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(201,169,110,0.6)' }}>
            <div className="card-title">Backup codes (save now)</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Each code works once. Download or copy them before leaving this page.
            </div>
            <pre style={{
              background: 'var(--bg-subtle)', padding: 12, borderRadius: 8,
              fontSize: 13, letterSpacing: 1, lineHeight: 1.7, margin: 0,
            }}>{backupCodes.join('\n')}</pre>
            <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={downloadBackupCodes}>
              Download backup codes
            </button>
          </div>
        )}

        {!status.enabled && !setup && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Set up 2FA</div>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={startSetup}>
              {busy ? 'Preparing…' : 'Generate QR code'}
            </button>
          </div>
        )}

        {setup && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Scan with your authenticator</div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <img src={setup.qrDataUrl} alt="2FA QR code" width={220} height={220} style={{ borderRadius: 8, border: '0.5px solid var(--border)' }} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Or enter this secret manually:
                </div>
                <code style={{ fontSize: 13, wordBreak: 'break-all' }}>{setup.secret}</code>
                <form onSubmit={enable2fa} style={{ marginTop: 16 }}>
                  <div className="form-label">Enter the 6-digit code to confirm</div>
                  <input
                    className="form-input"
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                  <button type="submit" className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy}>
                    {busy ? 'Enabling…' : 'Enable 2FA'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {status.enabled && (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Regenerate backup codes</div>
              <form onSubmit={regenerate}>
                <div className="form-label">Current authenticator code</div>
                <input className="form-input" value={regenCode} onChange={(e) => setRegenCode(e.target.value)} placeholder="123456" required />
                <button type="submit" className="btn" style={{ marginTop: 10 }} disabled={busy}>Regenerate</button>
              </form>
            </div>
            <div className="card">
              <div className="card-title">Disable 2FA</div>
              <form onSubmit={disable2fa}>
                <div className="form-label">Current password</div>
                <input className="form-input" type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} required />
                <div className="form-label" style={{ marginTop: 10 }}>Authenticator or backup code</div>
                <input className="form-input" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} required />
                <button type="submit" className="btn btn-danger" style={{ marginTop: 10 }} disabled={busy}>Disable 2FA</button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

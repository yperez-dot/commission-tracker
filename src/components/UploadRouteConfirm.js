import React from 'react';

/**
 * Modal: filename detection suggests a different upload tab.
 */
export default function UploadRouteConfirm({
  filename,
  detected,
  currentLabel,
  onUseSuggested,
  onStayHere,
  onCancel,
}) {
  if (!detected) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--bg)',
          borderRadius: 12,
          width: '100%',
          maxWidth: 440,
          padding: 22,
          border: '1px solid var(--border)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Check upload destination</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--text)' }}>{filename}</strong>
          </div>
          {detected.reason}
          <div style={{ marginTop: 10 }}>
            Suggested: <strong style={{ color: 'var(--text)' }}>{detected.label}</strong>
            {detected.confidence !== 'high' ? ` (${detected.confidence} confidence)` : ''}
            <br />
            You are on: <strong style={{ color: 'var(--text)' }}>{currentLabel}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn btn-primary" onClick={onUseSuggested} style={{ width: '100%' }}>
            Switch to {detected.label}
          </button>
          <button className="btn" onClick={onStayHere} style={{ width: '100%' }}>
            Upload here anyway ({currentLabel})
          </button>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 13,
              padding: 8,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

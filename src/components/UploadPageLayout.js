import React from 'react';

const DROP_INNER = {
  borderRadius: 8,
  padding: '32px 20px',
  textAlign: 'center',
  transition: 'all 0.2s',
};

const CHOOSE_BTN = {
  background: 'var(--blue)',
  color: '#fff',
  borderRadius: 6,
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-block',
};

/**
 * Shared chrome for the four Uploads tabs.
 * Header + body match Commission Statements / rest of OliComm.
 */
export function UploadPageShell({ title, subtitle, children }) {
  return (
    <div>
      <div className="page-header">
        <div className="page-title">{title}</div>
        <div className="page-sub">{subtitle}</div>
      </div>
      <div className="page-body">{children}</div>
    </div>
  );
}

export function UploadDropZone({
  dragOver,
  setDragOver,
  onDropFiles,
  uploading,
  dropTitle,
  dropHint,
  accept,
  multiple = false,
  inputId,
  processingLabel = 'Processing file...',
  processingHint = 'Detecting columns and parsing records',
}) {
  function onDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() {
    setDragOver(false);
  }
  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onDropFiles(multiple ? files : files.slice(0, 1));
  }
  function onPick(e) {
    const files = Array.from(e.target.files || []);
    if (files.length) onDropFiles(multiple ? files : files.slice(0, 1));
    e.target.value = '';
  }

  return (
    <div
      className="card"
      style={{ marginBottom: 16 }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        style={{
          ...DROP_INNER,
          border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`,
          background: dragOver ? 'var(--blue-light)' : 'transparent',
        }}
      >
        {uploading ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{processingLabel}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{processingHint}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{dropTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{dropHint}</div>
            <label style={CHOOSE_BTN}>
              Choose file{multiple ? 's' : ''}
              <input
                id={inputId}
                type="file"
                accept={accept}
                multiple={multiple}
                style={{ display: 'none' }}
                onChange={onPick}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

export function UploadAlert({ kind = 'error', title, children }) {
  const styles =
    kind === 'success'
      ? { background: '#EAF3DE', border: '1px solid #C0DD97', color: '#3B6D11' }
      : { background: '#FCE8E8', border: '1px solid #F7C1C1', color: '#A32D2D' };
  return (
    <div style={{ ...styles, borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
      {title ? <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div> : null}
      {children}
    </div>
  );
}

export function UploadHistoryCard({ title, children }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      {title ? (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}

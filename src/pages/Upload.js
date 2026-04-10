import React, { useState, useEffect, useRef } from 'react';
import { apiFetch, apiUpload } from '../api';

function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function Upload({ user }) {
  const [uploads, setUploads] = useState([]);
  const [status, setStatus] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  useEffect(() => { loadUploads(); }, []);

  async function loadUploads() {
    try {
      const data = await apiFetch('/files/uploads');
      setUploads(data);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleFile(file) {
    if (!file) return;
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      setStatus({ type: 'error', msg: 'Please upload an Excel (.xlsx) or CSV file' });
      return;
    }

    setStatus({ type: 'info', msg: `Reading ${file.name}...` });

    const fd = new FormData();
    fd.append('file', file);

    try {
      setStatus({ type: 'info', msg: 'Analyzing columns with AI...' });
      const result = await apiUpload('/files/upload', fd);
      setStatus({ type: 'success', msg: `✓ Digested ${result.rowCount} records from "${result.filename}" — ${fmt(result.commissionSum)} total` });
      loadUploads();
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    }
  }

  async function deleteUpload(id, name) {
    if (!window.confirm(`Delete "${name}" and all its records?`)) return;
    try {
      await apiFetch(`/files/uploads/${id}`, { method: 'DELETE' });
      setUploads(u => u.filter(x => x.id !== id));
    } catch (e) {
      setStatus({ type: 'error', msg: e.message });
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">Upload statements</div>
        <div className="page-sub">Drop carrier Excel files — AI auto-detects columns for any carrier format</div>
      </div>
      <div className="page-body">
        {status && (
          <div className={`alert alert-${status.type === 'error' ? 'error' : status.type === 'success' ? 'success' : 'info'}`}>
            {status.type === 'info' && <span className="spinner"></span>}
            {status.msg}
          </div>
        )}

        <div
          className={`upload-zone${dragging ? ' dragging' : ''}`}
          onClick={() => fileRef.current.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        >
          <div className="upload-icon">📂</div>
          <div className="upload-title">Drop carrier statement here</div>
          <div className="upload-sub">Supports .xlsx, .xls, .csv — any carrier format</div>
          <button className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); fileRef.current.click(); }}>
            Choose file
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
          onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }} />

        <div style={{marginTop: 24}}>
          <div className="card-title" style={{marginBottom:10}}>Uploaded files ({uploads.length})</div>
          {!uploads.length ? (
            <div className="empty-state" style={{padding:'24px 0'}}>
              <div className="empty-sub">No files uploaded yet</div>
            </div>
          ) : (
            uploads.map(u => (
              <div className="file-item" key={u.id}>
                <span className="file-icon">📊</span>
                <div className="file-info">
                  <div className="file-name">{u.original_name}</div>
                  <div className="file-meta">
                    {u.row_count} records · {fmt(u.commission_sum)} · {u.carrier} · {new Date(u.uploaded_at).toLocaleString()}
                    {u.uploaded_by_name && ` · by ${u.uploaded_by_name}`}
                  </div>
                </div>
                <span className="badge badge-green">Digested</span>
                {user.role === 'admin' && (
                  <button className="btn btn-sm btn-danger" style={{marginLeft:8}}
                    onClick={() => deleteUpload(u.id, u.original_name)}>
                    Delete
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload } from '../api';
import { formatDateTime } from '../utils/dateFormat';

export default function BSIStatementsUpload({ user }) {
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadUploads = useCallback(async () => {
    try {
      // Filter to only BSI Statement uploads
      const data = await apiFetch('/files/uploads?category=bsi_statement');
      setUploads(data || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadUploads();
  }, [loadUploads]);

  async function handleFile(file) {
    if (!file) return;
    setUploading(true);
    setError('');
    setUploadResult(null);
    
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', 'bsi_statement'); // Mark as BSI statement
      
      const result = await apiUpload('/files/upload-bsi-statement', fd);
      setUploadResult(result);
      loadUploads();
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function deleteUpload(id) {
    if (!window.confirm('Delete this BSI statement upload?')) return;
    setDeletingId(id);
    try {
      await apiFetch(`/files/uploads/${id}`, { method: 'DELETE' });
      setUploads(prev => prev.filter(u => u.id !== id));
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>BSI Statements Upload</h2>
        <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 14 }}>
          Upload BSI commission statements (carrier Excel/CSV, or the combined <em>T.H.E Statements / JULY - THE</em> remittance file BSI sends)
        </p>
      </div>

      {/* Upload Box */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: dragOver ? '2px dashed var(--accent)' : '2px dashed var(--border)',
          borderRadius: 8,
          padding: 40,
          textAlign: 'center',
          background: dragOver ? 'var(--bg-secondary)' : 'var(--bg)',
          marginBottom: 24,
          cursor: 'pointer'
        }}
        onClick={() => document.getElementById('bsi-file-input').click()}
      >
        <input
          id="bsi-file-input"
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])}
        />
        <div style={{ fontSize: 16, marginBottom: 8 }}>
          📄 {uploading ? 'Uploading...' : 'Drop BSI statement here or click to browse'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Supported formats: Excel (.xlsx, .xls), CSV, PDF
        </div>
      </div>

      {/* Upload Result */}
      {uploadResult && (
        <div style={{
          padding: 16,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: 24
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>✅ Upload Complete</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            File: {uploadResult.filename}
          </div>
          {(uploadResult.rowCount != null || uploadResult.recordsImported != null) && (
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>
              Records imported: {uploadResult.rowCount ?? uploadResult.recordsImported}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: 16,
          background: '#fee',
          border: '1px solid #fcc',
          borderRadius: 8,
          marginBottom: 24,
          color: '#c00'
        }}>
          ❌ {error}
        </div>
      )}

      {/* Uploads List */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
          Uploaded BSI Statements ({uploads.length})
        </h3>

        {uploads.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No BSI statements uploaded yet
          </div>
        ) : (
          <div style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 12 }}>File Name</th>
                  <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 12 }}>Uploaded</th>
                  <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 12 }}>Uploaded By</th>
                  <th style={{ padding: 12, textAlign: 'right', fontWeight: 600, fontSize: 12 }}>Records</th>
                  <th style={{ padding: 12, textAlign: 'right', fontWeight: 600, fontSize: 12 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u, i) => (
                  <tr key={u.id} style={{
                    borderBottom: i < uploads.length - 1 ? '1px solid var(--border)' : 'none'
                  }}>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      <a
                        href="#"
                        onClick={async (e) => {
                          e.preventDefault();
                          try {
                            const data = await apiFetch(`/records?upload_id=${u.id}&limit=500`);
                            const records = data.records || [];
                            if (!records.length) { alert('No records found for this upload'); return; }
                            const modal = document.createElement('div');
                            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;';
                            const fmt = (v) => parseFloat(v||0).toFixed(2);
                            const total = records.reduce((s,r)=>s+(parseFloat(r.commission)||0),0);
                            const clsBadge = (cls) => {
                              const bg = cls==='New Business'?'#c6f6d5':cls==='Renewal'?'#bee3f8':cls==='Chargeback'?'#fed7d7':cls==='Held'?'#fefcbf':'#e2e8f0';
                              return `<span style="background:${bg};padding:2px 6px;border-radius:3px;font-size:11px;">${cls||'\u2014'}</span>`;
                            };
                            modal.innerHTML = `
                              <div style="background:white;border-radius:8px;max-width:95vw;width:1100px;max-height:90vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                                <div style="padding:16px 20px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:white;z-index:1;">
                                  <div>
                                    <h2 style="margin:0;font-size:16px;">${u.original_name}</h2>
                                    <p style="margin:4px 0 0;font-size:12px;color:#666;">${records.length} records &bull; $${fmt(total)} total</p>
                                  </div>
                                  <button onclick="this.closest('[style*=fixed]').remove()" style="background:#e53e3e;color:white;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:12px;">&#x2715; Close</button>
                                </div>
                                <div style="padding:16px;overflow-x:auto;">
                                  <table style="width:100%;border-collapse:collapse;font-size:12px;">
                                    <thead>
                                      <tr style="background:#f5f5f5;border-bottom:2px solid #ddd;">
                                        <th style="text-align:left;padding:8px;">Agent</th>
                                        <th style="text-align:left;padding:8px;">Client</th>
                                        <th style="text-align:left;padding:8px;">Carrier</th>
                                        <th style="text-align:left;padding:8px;">Plan</th>
                                        <th style="text-align:left;padding:8px;">Eff. Date</th>
                                        <th style="text-align:left;padding:8px;">Period</th>
                                        <th style="text-align:left;padding:8px;">Classification</th>
                                        <th style="text-align:right;padding:8px;">Commission</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      ${records.map((r,i) => `
                                        <tr style="border-bottom:1px solid #eee;${i%2===0?'background:#fafafa;':''}">
                                          <td style="padding:7px 8px;">${r.agent_name||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.client_full_name||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.carrier||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.plan_type||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.effective_date||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.payment_period||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${clsBadge(r.classification)}</td>
                                          <td style="padding:7px 8px;text-align:right;color:${parseFloat(r.commission)<0?'#e53e3e':'#2f855a'};font-weight:500;">$${fmt(r.commission)}</td>
                                        </tr>
                                      `).join('')}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            `;
                            document.body.appendChild(modal);
                            modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
                          } catch (err) {
                            alert('Error loading records: ' + err.message);
                          }
                        }}
                        style={{ color: 'var(--accent,#6B46C1)', textDecoration: 'none', cursor: 'pointer', borderBottom: '1px dashed currentColor' }}
                        onMouseOver={e => e.currentTarget.style.borderBottom='1px solid currentColor'}
                        onMouseOut={e => e.currentTarget.style.borderBottom='1px dashed currentColor'}
                        title="Click to view records"
                      >
                        📄 {u.original_name}
                      </a>
                    </td>
                    <td style={{ padding: 12, fontSize: 14, color: 'var(--text-muted)' }}>
                      {formatDateTime(u.uploaded_at)}
                    </td>
                    <td style={{ padding: 12, fontSize: 14, color: 'var(--text-muted)' }}>
                      {u.uploaded_by_name || `User ${u.uploaded_by}`}
                    </td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: 'right' }}>
                      {u.row_count || 0}
                    </td>
                    <td style={{ padding: 12, textAlign: 'right' }}>
                      {user.role === 'admin' && (
                        <button
                          onClick={() => deleteUpload(u.id)}
                          disabled={deletingId === u.id}
                          className="btn btn-danger"
                          style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                          {deletingId === u.id ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

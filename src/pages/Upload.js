import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Upload({ user }) {
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [viewUpload, setViewUpload] = useState(null); // upload being viewed
  const [selectedUploads, setSelectedUploads] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [viewRecords, setViewRecords] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

  const loadUploads = useCallback(async () => {
    try {
      const data = await apiFetch('/files/uploads');
      setUploads(data || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  async function handleFile(file) {
    if (!file) return;
    setUploading(true);
    setError('');
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const result = await apiUpload('/files/upload', fd);
      setUploadResult(result);
      loadUploads();
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function deleteUpload(id) {
    if (!window.confirm('Delete this upload and all its records?')) return;
    setDeletingId(id);
    try {
      await apiFetch(`/files/uploads/${id}`, { method: 'DELETE' });
      setUploads(prev => prev.filter(u => u.id !== id));
    } catch (e) { console.error(e); }
    finally { setDeletingId(null); }
  }

  function toggleSelectUpload(id) {
    setSelectedUploads(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function selectAllUploads() {
    if (selectedUploads.size === uploads.length) setSelectedUploads(new Set());
    else setSelectedUploads(new Set(uploads.map(u => u.id)));
  }

  async function bulkDeleteUploads() {
    if (!window.confirm(`Delete ${selectedUploads.size} uploads and all their records?`)) return;
    setBulkDeleting(true);
    try {
      for (const id of selectedUploads) {
        await apiFetch(`/files/uploads/${id}`, { method: 'DELETE' });
      }
      setUploads(prev => prev.filter(u => !selectedUploads.has(u.id)));
      setSelectedUploads(new Set());
    } catch (e) { console.error(e); }
    finally { setBulkDeleting(false); }
  }

  async function openUpload(upload) {
    setViewUpload(upload);
    setViewLoading(true);
    setViewRecords([]);
    try {
      const data = await apiFetch(`/records?upload_id=${upload.id}&limit=500`);
      setViewRecords(data.records || []);
    } catch (e) { console.error(e); }
    finally { setViewLoading(false); }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  const totalRecords = uploads.reduce((s, u) => s + (u.row_count || 0), 0);
  const totalCommission = uploads.reduce((s, u) => s + (parseFloat(u.commission_sum) || 0), 0);

  return (
    <div>
      {/* Record viewer modal */}
      {viewUpload && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#ffffff', borderRadius: 12, width: '90%', maxWidth: 900, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
            {/* Modal header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{viewUpload.original_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {viewUpload.row_count} records · {fmt(viewUpload.commission_sum)} · {viewUpload.carrier} · {new Date(viewUpload.uploaded_at).toLocaleDateString()}
                </div>
              </div>
              <button onClick={() => setViewUpload(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}>✕</button>
            </div>
            {/* Modal body */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {viewLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading records...</div>
              ) : viewRecords.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No records found</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                    <tr>
                      {['#','Agent','Carrier','Client','Effective','Commission','Type','Period'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {viewRecords.map((r, i) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{i + 1}</td>
                        <td style={{ padding: '7px 12px', fontWeight: 500 }}>{r.agent_name}</td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{r.carrier}</td>
                        <td style={{ padding: '7px 12px' }}>{r.client_full_name || '—'}</td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{r.effective_date || '—'}</td>
                        <td style={{ padding: '7px 12px', fontWeight: 600, color: parseFloat(r.commission) < 0 ? '#E24B4A' : '#1D9E75' }}>{fmt(r.commission)}</td>
                        <td style={{ padding: '7px 12px' }}>
                          <span style={{
                            background: r.classification === 'New Business' ? '#E6F4D7' : r.classification === 'Renewal' ? '#E6F1FB' : r.classification === 'Chargeback' ? '#FCE8E8' : '#F3F4F6',
                            color: r.classification === 'New Business' ? '#3B6D11' : r.classification === 'Renewal' ? '#0C447C' : r.classification === 'Chargeback' ? '#A32D2D' : '#374151',
                            borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 600
                          }}>{r.classification || '—'}</span>
                        </td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{r.payment_period || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8f9fa', fontWeight: 700 }}>
                      <td colSpan={5} style={{ padding: '8px 12px', fontSize: 12 }}>Total ({viewRecords.length} records)</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, color: '#1D9E75' }}>
                        {fmt(viewRecords.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0))}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">Upload statements</div>
        <div className="page-sub">Drop carrier Excel files — AI auto-detects columns for any carrier format</div>
      </div>
      <div className="page-body">

        {/* Drop zone */}
        <div className="card" style={{ marginBottom: 16 }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}>
          <div style={{
            border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`,
            borderRadius: 8, padding: '32px 20px', textAlign: 'center',
            background: dragOver ? 'var(--blue-light)' : 'transparent',
            transition: 'all 0.2s'
          }}>
            {uploading ? (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Processing file...</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>AI is detecting columns and parsing records</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Drop carrier statement here</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Supports .xlsx, .xls, .csv — any carrier format</div>
                <label style={{ background: 'var(--blue)', color: '#fff', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Choose file
                  <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                    onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; }} />
                </label>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ background: '#FCE8E8', border: '1px solid #F7C1C1', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#A32D2D' }}>
            ⚠️ {error}
          </div>
        )}

        {uploadResult && (
          <div style={{ background: '#EAF3DE', border: '1px solid #C0DD97', borderRadius: 8, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: '#3B6D11' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ Upload successful — {uploadResult.filename}</div>
            <div>{uploadResult.rowCount} records imported · {fmt(uploadResult.commissionSum)} total · Carriers: {(uploadResult.carriers || []).join(', ')}</div>
          </div>
        )}

        {/* Summary bar */}
        {uploads.length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>{uploads.length}</strong> uploads</span>
            <span style={{ color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>{totalRecords.toLocaleString()}</strong> total records</span>
            <span style={{ color: 'var(--text-muted)' }}><strong style={{ color: '#1D9E75' }}>{fmt(totalCommission)}</strong> total commissions</span>
          </div>
        )}

        {/* Upload list */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Uploaded files ({uploads.length})
          </div>
          {uploads.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <div className="empty-title">No files uploaded yet</div>
              <div className="empty-sub">Drop your first carrier statement above</div>
            </div>
          ) : uploads.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--border)', background: selectedUploads.has(u.id) ? 'var(--blue-light)' : 'transparent' }}>
              <input type="checkbox" checked={selectedUploads.has(u.id)} onChange={() => toggleSelectUpload(u.id)} style={{ cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ fontSize: 20, flexShrink: 0 }}>📊</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Clickable filename */}
                <button onClick={() => openUpload(u)} style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontWeight: 600, fontSize: 13, color: '#185FA5', textAlign: 'left',
                  textDecoration: 'underline', marginBottom: 2
                }}>
                  {u.original_name}
                </button>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {u.row_count} records · {fmt(u.commission_sum)} · {u.carrier} · {new Date(u.uploaded_at).toLocaleString()} · by {u.uploaded_by_name}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 10, background: '#EAF3DE', color: '#3B6D11', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>Digested</span>
                {user.role === 'admin' && (
                  <button onClick={() => deleteUpload(u.id)} disabled={deletingId === u.id}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#E24B4A' }}>
                    {deletingId === u.id ? '...' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

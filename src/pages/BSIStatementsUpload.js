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
          Upload BSI commission statements from carrier and agent Celeraro
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
                    <td style={{ padding: 12, fontSize: 14 }}>{u.original_name}</td>
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

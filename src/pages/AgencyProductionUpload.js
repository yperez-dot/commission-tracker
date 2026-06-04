import React, { useState, useEffect } from 'react';
import { apiFetch, getToken } from '../api';

export default function AgencyProductionUpload() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadHistory, setUploadHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || '';

  // Load upload history on mount
  useEffect(() => {
    loadUploadHistory();
  }, []);

  async function loadUploadHistory() {
    setLoadingHistory(true);
    try {
      const data = await apiFetch('/agency-production/uploads');
      setUploadHistory(data.uploads || []);
    } catch (err) {
      console.error('Error loading upload history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleFileSelect(selectedFile) {
    const filename = selectedFile.name.toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      setError('❌ File must be Excel format (.xlsx or .xls)');
      return;
    }
    setFile(selectedFile);
    setError(null);
    setSuccess(null);
  }

  async function handleUpload() {
    if (!file) {
      setError('❌ Please select a file');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const uploadUrl = `${API_URL}/api/agency-production/upload`;
      
      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${getToken()}`
        }
      });

      const text = await response.text();
      
      if (!response.ok) {
        let errorMsg = 'Upload failed';
        try {
          const errorData = JSON.parse(text);
          errorMsg = errorData.error || errorData.message || text;
        } catch (e) {
          errorMsg = text || 'Upload failed';
        }
        throw new Error(errorMsg);
      }

      let result = {};
      try {
        result = JSON.parse(text);
      } catch (e) {
        result = { message: text };
      }
      
      setSuccess(`✅ ${result.message || 'Upload successful!'}`);
      setFile(null);
      
      // Reload history
      await loadUploadHistory();
    } catch (err) {
      setError('❌ Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteBatch(batch) {
    const confirmDelete = window.confirm(
      `⚠️ Delete batch ${batch}?\n\nThis will permanently delete:\n- All upload logs for this batch\n- All production records for this batch\n\nThis cannot be undone.`
    );
    
    if (!confirmDelete) return;
    
    try {
      const result = await apiFetch(`/agency-production/batch/${batch}`, {
        method: 'DELETE'
      });
      
      alert(`✅ Deleted batch ${batch}\n\n${result.deleted_production} production records deleted\n${result.deleted_uploads} upload logs deleted`);
      
      // Reload history
      await loadUploadHistory();
    } catch (err) {
      alert(`❌ Error deleting batch: ${err.message}`);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  function handleCardClick() {
    // Trigger the hidden file input when clicking the card
    document.getElementById('agency-file-input').click();
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">📊 Upload Agency Production</div>
        <div className="page-sub">Import Hector's monthly production reports (Humana, UHC, Aetna, etc.)</div>
      </div>

      <div className="page-body">
        <div
          className="card"
          style={{
            border: dragOver ? '2px dashed var(--blue)' : '2px dashed var(--border)',
            background: dragOver ? 'var(--blue-light)' : 'transparent',
            padding: '40px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleCardClick}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Drag & drop your agency production Excel file here
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Or click anywhere to select a file
          </div>
          <input
            id="agency-file-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => e.target.files[0] && handleFileSelect(e.target.files[0])}
            style={{ display: 'none' }}
          />
        </div>

        {file && (
          <div className="card" style={{ marginTop: 20, background: 'var(--blue-light)', border: '1px solid var(--blue)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--blue-dark)' }}>
                  ✅ Selected: {file.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 4 }}>
                  Size: {(file.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-sm"
                  onClick={handleUpload}
                  disabled={loading}
                  style={{ background: 'var(--green)', color: 'white', fontWeight: 600 }}
                >
                  {loading ? 'Uploading...' : 'Upload'}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => { setFile(null); }}
                  disabled={loading}
                  style={{ background: 'var(--red)', color: 'white' }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="card" style={{ marginTop: 20, background: 'var(--red-light)', border: '1px solid var(--red)', color: 'var(--red-dark)' }}>
            {error}
          </div>
        )}

        {success && (
          <div className="card" style={{ marginTop: 20, background: 'var(--green-light)', border: '1px solid var(--green)', color: 'var(--green-dark)', fontWeight: 500 }}>
            {success}
          </div>
        )}



        <div style={{ marginTop: 30, padding: 16, background: 'var(--blue-light)', borderRadius: 6, borderLeft: '4px solid var(--blue)', color: 'var(--blue-dark)', fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>💡 What is this for?</div>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li><strong>Hector sends you monthly production reports</strong> (one per carrier: Humana, UHC, Aetna, etc.)</li>
            <li>These show <strong>ALL agency production</strong> - including agents you don't manage</li>
            <li>Upload them here to verify <strong>BSI/NHP override payments</strong> are correct</li>
            <li>The system will compare production vs. overrides and flag discrepancies</li>
          </ul>
        </div>

        {/* Upload History */}
        <div className="card" style={{ marginTop: 30 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>📋 Upload History</div>
          {loadingHistory ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Loading history...</div>
          ) : uploadHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
              No uploads yet. Upload your first production report above!
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Carrier</th>
                    <th>Batch</th>
                    <th>Uploaded</th>
                    <th>By</th>
                    <th>Records</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadHistory.map((upload) => (
                    <tr key={upload.id}>
                      <td style={{ fontWeight: 500 }}>{upload.filename}</td>
                      <td>
                        <span className="badge" style={{ background: 'var(--green-light)', color: 'var(--green)' }}>
                          {upload.carrier}
                        </span>
                      </td>
                      <td>
                        <span className="badge" style={{ background: 'var(--blue-light)', color: 'var(--blue)' }}>
                          {upload.upload_batch}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(upload.uploaded_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true
                        })}
                      </td>
                      <td style={{ fontSize: 13 }}>{upload.uploaded_by || '—'}</td>
                      <td style={{ fontWeight: 500, color: 'var(--green)' }}>{upload.record_count}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleDeleteBatch(upload.upload_batch)}
                          style={{ background: 'var(--red)', color: 'white', fontSize: 11, padding: '4px 10px' }}
                        >
                          🗑️ Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

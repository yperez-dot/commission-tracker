import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export default function MedicareProUpload() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
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
      const data = await apiFetch('/medicarepro/uploads');
      setUploadHistory(data.uploads || []);
    } catch (err) {
      console.error('Error loading upload history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleDeleteBatch(batch) {
    const confirmDelete = window.confirm(
      `⚠️ Delete batch ${batch}?\n\nThis will permanently delete:\n- All upload logs for this batch\n- All sales records for this batch\n\nThis cannot be undone.`
    );
    
    if (!confirmDelete) return;
    
    try {
      const result = await apiFetch(`/medicarepro/batch/${batch}`, {
        method: 'DELETE'
      });
      
      alert(`✅ Deleted batch ${batch}\n\n${result.deleted_sales} sales records deleted\n${result.deleted_uploads} upload logs deleted`);
      
      // Reload history
      await loadUploadHistory();
    } catch (err) {
      alert(`❌ Error deleting batch: ${err.message}`);
    }
  }

  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }
    return rows;
  }

  async function handleFileSelect(selectedFile) {
    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setError('❌ File must be CSV format');
      return;
    }
    setFile(selectedFile);
    setError(null);
    setSuccess(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csv = e.target.result;
        const rows = parseCSV(csv);
        setPreview(rows.slice(0, 5));
      } catch (err) {
        setError('❌ Error reading CSV: ' + err.message);
      }
    };
    reader.readAsText(selectedFile);
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

      const uploadUrl = `${API_URL}/api/medicarepro/upload`;
      
      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      const text = await response.text();
      
      if (!response.ok) {
        throw new Error(text || 'Upload failed');
      }

      let result = {};
      try {
        result = JSON.parse(text);
      } catch (e) {
        result = { message: text };
      }
      
      setSuccess(`✅ Upload successful! ${result.message || ''}`);
      setFile(null);
      setPreview([]);
      // Reload upload history
      await loadUploadHistory();
    } catch (err) {
      setError('❌ Error: ' + err.message);
    } finally {
      setLoading(false);
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

  return (
    <div>
      <div className="page-header">
        <div className="page-title">📊 Upload MedicarePro Sales</div>
        <div className="page-sub">Import your monthly client list from MedicarePro</div>
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
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Drag & drop your MedicarePro CSV here
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Or click below to select a file
          </div>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            Choose File
            <input
              type="file"
              accept=".csv"
              onChange={(e) => e.target.files[0] && handleFileSelect(e.target.files[0])}
              style={{ display: 'none' }}
            />
          </label>
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
              <button
                className="btn btn-sm"
                onClick={() => { setFile(null); setPreview([]); }}
                style={{ background: 'var(--red)', color: 'white' }}
              >
                Remove
              </button>
            </div>
          </div>
        )}

        {preview.length > 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              Preview (first 5 rows):
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Policy Type</th>
                    <th>Effective Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => {
                    // Detect format and extract fields
                    const hasAgentColumns = 'Agent First' in row || 'Member First' in row;
                    const name = hasAgentColumns 
                      ? `${row['Member First'] || ''} ${row['Member Last'] || ''}`.trim()
                      : row.Name;
                    const company = row['Company Name'] || row.Company;
                    const policyType = row['Policy Type'];
                    const effDate = row['Policy Effective Date'] || row['Effective Date'];
                    const status = row['Policy Status'] || row.Status;
                    
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{name || '—'}</td>
                        <td>{company || '—'}</td>
                        <td style={{ fontSize: 12 }}>{policyType || '—'}</td>
                        <td style={{ fontSize: 12 }}>{effDate || '—'}</td>
                        <td>
                          <span className="badge" style={{
                            background: 
                              status === 'Active' ? '#D4EDDA' :
                              status === 'Pending' ? '#FFF3CD' :
                              status === 'Canceled' || status === 'Replaced' ? '#F8D7DA' :
                              status === 'Disenrolled' ? '#E7D4F5' :
                              '#F0EAE0',
                            color:
                              status === 'Active' ? '#155724' :
                              status === 'Pending' ? '#856404' :
                              status === 'Canceled' || status === 'Replaced' ? '#721C24' :
                              status === 'Disenrolled' ? '#663399' :
                              '#3D2B1F',
                            padding: '4px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600
                          }}>
                            {status || '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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

        {file && !success && (
          <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
            <button className="btn btn-primary btn-lg" onClick={handleUpload} disabled={loading} style={{ flex: 1 }}>
              {loading ? '⏳ Uploading...' : '🚀 Replace All Sales Data'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setFile(null); setPreview([]); }} disabled={loading}>
              Cancel
            </button>
          </div>
        )}

        <div style={{ marginTop: 30, padding: 16, background: 'var(--blue-light)', borderRadius: 6, borderLeft: '4px solid var(--blue)', color: 'var(--blue-dark)', fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>💡 How to use:</div>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            <li>Export your client list from MedicarePro as CSV</li>
            <li>Upload the file here</li>
            <li>The Reconciliation page will automatically update</li>
            <li>Compare with commission records to find unpaid sales</li>
          </ol>
        </div>

        {/* Upload History */}
        <div className="card" style={{ marginTop: 30 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>📋 Upload History</div>
          {loadingHistory ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>Loading history...</div>
          ) : uploadHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
              No uploads yet. Upload your first file above!
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Filename</th>
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

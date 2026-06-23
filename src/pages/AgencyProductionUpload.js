import React, { useState, useEffect } from 'react';
import { apiFetch, getToken } from '../api';

export default function AgencyProductionUpload() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [uploadResults, setUploadResults] = useState([]);
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

  async function handleFileSelect(selectedFiles) {
    const fileList = Array.isArray(selectedFiles) ? selectedFiles : [selectedFiles];
    const validFiles = [];
    
    for (const file of fileList) {
      const filename = file.name.toLowerCase();
      if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        // Check for duplicates
        if (!files.some(f => f.name === file.name && f.size === file.size)) {
          validFiles.push(file);
        }
      }
    }
    
    if (validFiles.length > 0) {
      setFiles([...files, ...validFiles]);
      setError(null);
      setSuccess(null);
      setUploadResults([]);
    } else {
      setError('❌ Only Excel files (.xlsx or .xls) are allowed');
    }
  }
  
  function handleRemoveFile(fileToRemove) {
    setFiles(files.filter(f => f !== fileToRemove));
    setError(null);
    setSuccess(null);
    setUploadResults([]);
  }

  async function handleUpload() {
    if (files.length === 0) {
      setError('❌ Please select at least one file');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    setUploadResults([]);

    const results = [];
    
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);

        const uploadUrl = `${API_URL}/api/agency-production/upload`;
        
        // Large files (e.g., Aetna 2.8MB) can take 30-60 seconds to parse
        // Set 5-minute timeout to handle big production files
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes
        
        try {
          const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData,
            headers: {
              'Authorization': `Bearer ${getToken()}`
            },
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          const text = await response.text();
          
          if (!response.ok) {
            let errorMsg = 'Upload failed';
            try {
              const errorData = JSON.parse(text);
              errorMsg = errorData.error || errorData.message || text;
            } catch (e) {
              errorMsg = text || 'Upload failed';
            }
            results.push({ file: file.name, success: false, message: errorMsg });
          } else {
            let result = {};
            try {
              result = JSON.parse(text);
            } catch (e) {
              result = { message: text };
            }
            results.push({ file: file.name, success: true, message: result.message || 'Upload successful!' });
          }
        } catch (err) {
          clearTimeout(timeoutId);
          if (err.name === 'AbortError') {
            results.push({ file: file.name, success: false, message: 'Upload timed out after 5 minutes. File may be too large or server is slow.' });
          } else {
            results.push({ file: file.name, success: false, message: err.message });
          }
        }
      } catch (err) {
        results.push({ file: file.name, success: false, message: err.message });
      }
    }
    
    setUploadResults(results);
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    if (successCount > 0) {
      setSuccess(`✅ ${successCount} file(s) uploaded successfully${failCount > 0 ? `, ${failCount} failed` : ''}`);
      setFiles([]);
      await loadUploadHistory();
    } else {
      setError(`❌ All ${failCount} file(s) failed to upload`);
    }
    
    setLoading(false);
  }

  async function handleDeleteUpload(upload) {
    const confirmDelete = window.confirm(
      `⚠️ Delete this upload?\n\nFile: ${upload.filename}\nCarrier: ${upload.carrier}\nRecords: ${upload.record_count}\n\nThis will permanently delete this upload and all its production records.\n\nThis cannot be undone.`
    );
    
    if (!confirmDelete) return;
    
    try {
      const result = await apiFetch(`/agency-production/upload/${upload.id}`, {
        method: 'DELETE'
      });
      
      alert(`✅ Deleted ${result.carrier} upload\n\n${result.deleted_production} production records deleted`);
      
      // Reload history
      await loadUploadHistory();
    } catch (err) {
      alert(`❌ Error deleting upload: ${err.message}`);
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
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      handleFileSelect(droppedFiles);
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
            Drag & drop your agency production Excel files here
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Or click anywhere to select files (multiple files supported)
          </div>
          <input
            id="agency-file-input"
            type="file"
            accept=".xlsx,.xls"
            multiple
            onChange={(e) => e.target.files.length > 0 && handleFileSelect(Array.from(e.target.files))}
            style={{ display: 'none' }}
          />
        </div>

        {files.length > 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📄 Selected Files ({files.length})</span>
              <button
                className="btn btn-sm"
                onClick={handleUpload}
                disabled={loading}
                style={{ background: 'var(--green)', color: 'white', fontWeight: 600 }}
              >
                {loading ? `Uploading ${files.length} file(s)...` : `Upload All (${files.length})`}
              </button>
            </div>
            {files.map((file, index) => (
              <div key={index} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '10px',
                background: 'var(--blue-light)',
                border: '1px solid var(--blue)',
                borderRadius: '6px',
                marginTop: index > 0 ? '8px' : '0'
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--blue-dark)' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 2 }}>
                    {(file.size / 1024).toFixed(1)} KB
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => handleRemoveFile(file)}
                  disabled={loading}
                  style={{ background: 'var(--red)', color: 'white', fontSize: '11px', padding: '4px 8px' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {uploadResults.length > 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Upload Results</div>
            {uploadResults.map((result, index) => (
              <div key={index} style={{
                padding: '8px 12px',
                marginTop: index > 0 ? '6px' : '0',
                background: result.success ? 'var(--green-light)' : 'var(--red-light)',
                border: `1px solid ${result.success ? 'var(--green)' : 'var(--red)'}`,
                borderRadius: '4px',
                fontSize: '12px',
                color: result.success ? 'var(--green-dark)' : 'var(--red-dark)'
              }}>
                <div style={{ fontWeight: 600 }}>{result.success ? '✅' : '❌'} {result.file}</div>
                <div style={{ marginTop: '4px', opacity: 0.8 }}>{result.message}</div>
              </div>
            ))}
          </div>
        )}

        {error && !uploadResults.length && (
          <div className="card" style={{ marginTop: 20, background: 'var(--red-light)', border: '1px solid var(--red)', color: 'var(--red-dark)' }}>
            {error}
          </div>
        )}

        {success && !uploadResults.length && (
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
                      <td style={{ fontWeight: 500 }}>
                        <a 
                          href="#" 
                          onClick={async (e) => {
                            e.preventDefault();
                            try {
                              const data = await apiFetch(`/agency-production?carrier=${encodeURIComponent(upload.carrier)}&batch=${encodeURIComponent(upload.upload_batch)}&limit=1000`);
                              const records = data.production || [];
                              
                              if (records.length === 0) {
                                alert('No records found for this upload');
                                return;
                              }
                              
                              // Show modal with data
                              const modal = document.createElement('div');
                              modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
                              modal.innerHTML = `
                                <div style="background:white;border-radius:8px;max-width:90vw;max-height:90vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                                  <div style="padding:20px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;align-items:center;">
                                    <div>
                                      <h2 style="margin:0;font-size:18px;">${upload.filename}</h2>
                                      <p style="margin:4px 0 0;font-size:13px;color:#666;">${upload.carrier} - ${upload.upload_batch} - ${records.length} records</p>
                                    </div>
                                    <button onclick="this.closest('div[style*=fixed]').remove()" style="background:var(--red);color:white;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;">Close</button>
                                  </div>
                                  <div style="padding:20px;">
                                    <table style="width:100%;border-collapse:collapse;font-size:12px;">
                                      <thead>
                                        <tr style="border-bottom:2px solid #ddd;">
                                          <th style="text-align:left;padding:8px;">Agent</th>
                                          <th style="text-align:left;padding:8px;">Client</th>
                                          <th style="text-align:left;padding:8px;">Effective Date</th>
                                          <th style="text-align:left;padding:8px;">Status</th>
                                          <th style="text-align:left;padding:8px;">Plan</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        ${records.map((r, i) => `
                                          <tr style="border-bottom:1px solid #eee;${i % 2 === 0 ? 'background:#f9f9f9;' : ''}">
                                            <td style="padding:8px;">${r.agent_name || '—'}</td>
                                            <td style="padding:8px;">${r.client_name || '—'}</td>
                                            <td style="padding:8px;">${r.effective_date || '—'}</td>
                                            <td style="padding:8px;">${r.status || '—'}</td>
                                            <td style="padding:8px;">${r.policy_type || '—'}</td>
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
                              alert('Error loading data: ' + err.message);
                            }
                          }}
                          style={{ 
                            color: 'var(--blue)', 
                            textDecoration: 'none',
                            cursor: 'pointer',
                            borderBottom: '1px dashed var(--blue)'
                          }}
                          onMouseOver={(e) => e.target.style.borderBottom = '1px solid var(--blue)'}
                          onMouseOut={(e) => e.target.style.borderBottom = '1px dashed var(--blue)'}
                          title="Click to view uploaded records"
                        >
                          📄 {upload.filename}
                        </a>
                      </td>
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
                          onClick={() => handleDeleteUpload(upload)}
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

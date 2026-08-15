import React, { useState, useEffect } from 'react';
import { apiFetch, apiUpload } from '../api';
import { formatDate } from '../utils/dateFormat';
import { UploadPageShell, UploadDropZone, UploadAlert, UploadHistoryCard } from '../components/UploadPageLayout';
export default function MedicareProUpload() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadHistory, setUploadHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [viewingBatch, setViewingBatch] = useState(null);
  const [batchData, setBatchData] = useState([]);
  const [loadingBatchData, setLoadingBatchData] = useState(false);

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

  async function viewBatchData(batch) {
    setViewingBatch(batch);
    setLoadingBatchData(true);
    try {
      const data = await apiFetch(`/medicarepro?batch=${batch}&limit=1000`);
      setBatchData(data.sales || []);
    } catch (err) {
      console.error('Error loading batch data:', err);
      alert('Error loading batch data: ' + err.message);
      setViewingBatch(null);
    } finally {
      setLoadingBatchData(false);
    }
  }

  async function handleDeleteBatch(batch) {
    const confirmDelete = window.confirm(
      `Delete batch ${batch}?\n\nThis will permanently delete:\n- All upload logs for this batch\n- All sales records for this batch\n\nThis cannot be undone.`
    );

    if (!confirmDelete) return;

    try {
      const result = await apiFetch(`/medicarepro/batch/${batch}`, {
        method: 'DELETE'
      });

      alert(`Deleted batch ${batch}\n\n${result.deleted_sales} sales records deleted\n${result.deleted_uploads} upload logs deleted`);

      // Reload history
      await loadUploadHistory();
    } catch (err) {
      alert(`Error deleting batch: ${err.message}`);
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
      setError('File must be CSV format');
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
      setError('Error reading CSV: ' + err.message);
      }
    };
    reader.readAsText(selectedFile);
  }

  async function handleUpload() {
    if (!file) {
      setError('Please select a file');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await apiUpload('/medicarepro/upload', formData);

      setSuccess(`Upload successful! ${result.message || ''}`);
      setFile(null);
      setPreview([]);
      // Reload upload history
      await loadUploadHistory();
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <UploadPageShell
      title="MedicarePro Sales"
      subtitle="Import your monthly client list from MedicarePro for Sales Reconciliation."
    >
        <UploadDropZone
          dragOver={dragOver}
          setDragOver={setDragOver}
          onDropFiles={(files) => { if (files[0]) handleFileSelect(files[0]); }}
          uploading={loading}
          dropTitle="Drop MedicarePro CSV here"
          dropHint="CSV export from MedicarePro"
          accept=".csv"
          processingLabel="Uploading..."
          processingHint="Importing sales records"
        />

        {error && <UploadAlert>{error}</UploadAlert>}
        {success && <UploadAlert kind="success">{success}</UploadAlert>}

        {file && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  Selected: {file.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Size: {(file.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => { setFile(null); setPreview([]); }}
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

        {error && <UploadAlert>{error}</UploadAlert>}
        {success && <UploadAlert kind="success">{success}</UploadAlert>}

        {file && !success && (
          <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" onClick={handleUpload} disabled={loading} style={{ flex: 1 }}>
              {loading ? 'Uploading...' : 'Replace all sales data'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setFile(null); setPreview([]); }} disabled={loading}>
              Cancel
            </button>
          </div>
        )}

        <div className="card" style={{ marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>How to use</div>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            <li>Export your client list from MedicarePro as CSV</li>
            <li>Upload the file here</li>
            <li>Sales Reconciliation will match these sales to commission statements</li>
          </ol>
        </div>

        <UploadHistoryCard title="Upload history">
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
                      <td>
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            viewBatchData(upload.upload_batch);
                          }}
                          style={{
                            fontWeight: 500,
                            color: 'var(--blue)',
                            textDecoration: 'none',
                            cursor: 'pointer'
                          }}
                          onMouseOver={(e) => e.target.style.textDecoration = 'underline'}
                          onMouseOut={(e) => e.target.style.textDecoration = 'none'}
                          title="Click to view sales data"
                        >
                          {upload.filename}
                        </a>
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
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </UploadHistoryCard>

        {/* Batch Data Viewer Modal */}
        {viewingBatch && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
            onClick={() => setViewingBatch(null)}
          >
            <div
              className="card"
              style={{
                width: '90%',
                maxWidth: 1200,
                maxHeight: '80vh',
                overflow: 'auto',
                margin: 20
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Sales data — batch {viewingBatch}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    {batchData.length} records
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => setViewingBatch(null)}
                  style={{ fontSize: 20, padding: '4px 12px' }}
                >
                  ×
                </button>
              </div>

              {loadingBatchData ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  Loading data...
                </div>
              ) : batchData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  No data found for this batch.
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>Client</th>
                        <th>Carrier</th>
                        <th>Plan</th>
                        <th>Effective Date</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchData.map((sale, idx) => (
                        <tr key={idx}>
                          <td style={{ fontSize: 13 }}>{sale.agent_name || sale.agent || '—'}</td>
                          <td style={{ fontWeight: 500 }}>{sale.client_name}</td>
                          <td>{sale.carrier}</td>
                          <td style={{ fontSize: 12 }}>{sale.plan_name || '—'}</td>
                          <td style={{ fontSize: 12 }}>
                            {formatDate(sale.effective_date)}
                          </td>
                          <td>
                            <span className="badge" style={{
                              background: (() => {
                                const s = (sale.status || '').toLowerCase();
                                // 🟢 Green: Active/Enrolled/Accepted states
                                if (s.includes('active') || s.includes('enroll') || s.includes('accept')) return '#D4EDDA';
                                // 🔴 Red: Cancelled/Withdrawn/Rejected/Disenrolled
                                if (s.includes('cancel') || s.includes('withdraw') || s.includes('reject') || s.includes('disenroll')) return '#F8D7DA';
                                // 🟡 Yellow: In Progress/Pending/Completed (transitional)
                                if (s.includes('progress') || s.includes('pending') || s.includes('complete')) return '#FFF3CD';
                                // 🔵 Blue: Everything else
                                return '#E8F0FE';
                              })(),
                              color: (() => {
                                const s = (sale.status || '').toLowerCase();
                                if (s.includes('active') || s.includes('enroll') || s.includes('accept')) return '#155724';
                                if (s.includes('cancel') || s.includes('withdraw') || s.includes('reject') || s.includes('disenroll')) return '#721C24';
                                if (s.includes('progress') || s.includes('pending') || s.includes('complete')) return '#856404';
                                return '#1967D2';
                              })(),
                              padding: '4px 8px',
                              borderRadius: 4,
                              fontSize: 11
                            }}>
                              {sale.status || '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
    </UploadPageShell>
  );
}

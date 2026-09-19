import React, { useState, useEffect } from 'react';
import { apiFetch, apiUpload } from '../api';
import { formatDate } from '../utils/dateFormat';
import {
  UploadPageShell,
  UploadDropZone,
  UploadAlert,
  UploadRecordPreviewModal,
  UploadListToolbar,
  UploadRowList,
} from '../components/UploadPageLayout';
import { medicareProUploadExportPath, exportUploadFile } from '../utils/exportUpload';
export default function MedicareProUpload({ user }) {
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
  const [exportingId, setExportingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date_desc'); // date_desc | date_asc | filename
  const [selectedBatches, setSelectedBatches] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  function toggleSelectBatch(batch) {
    setSelectedBatches((prev) => {
      const n = new Set(prev);
      n.has(batch) ? n.delete(batch) : n.add(batch);
      return n;
    });
  }

  function selectAllBatches() {
    if (selectedBatches.size === visibleHistory.length) setSelectedBatches(new Set());
    else setSelectedBatches(new Set(visibleHistory.map((u) => u.upload_batch)));
  }

  async function bulkDeleteBatches() {
    if (!window.confirm(`Delete ${selectedBatches.size} batches and all their sales records? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      for (const batch of selectedBatches) {
        await apiFetch(`/medicarepro/batch/${batch}`, { method: 'DELETE' });
      }
      setSelectedBatches(new Set());
      await loadUploadHistory();
    } catch (err) {
      alert(`Error deleting batches: ${err.message}`);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleExportUpload(upload) {
    if (!upload?.id) return;
    setExportingId(upload.id);
    setError(null);
    try {
      await exportUploadFile({
        path: medicareProUploadExportPath(upload.id, 'xlsx'),
        fallbackName: `${String(upload.filename || upload.upload_batch || 'medicarepro').replace(/\.[^.]+$/, '')}_export.xlsx`,
      });
    } catch (err) {
      setError(err.message || 'Export failed');
    } finally {
      setExportingId(null);
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

  const qHist = searchQuery.trim().toLowerCase();
  const visibleHistory = uploadHistory
    .filter((u) => {
      if (!qHist) return true;
      const hay = [u.filename, u.upload_batch, u.uploaded_by]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(qHist);
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':
          return new Date(a.uploaded_at) - new Date(b.uploaded_at);
        case 'filename':
          return (a.filename || '').localeCompare(b.filename || '');
        case 'date_desc':
        default:
          return new Date(b.uploaded_at) - new Date(a.uploaded_at);
      }
    });

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

        {uploadHistory.length > 0 && (
          <UploadListToolbar
            search={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search filename, batch, or uploader…"
            sortValue={sortBy}
            onSortChange={setSortBy}
            sortOptions={[
              { value: 'date_desc', label: '↓ Newest first' },
              { value: 'date_asc', label: '↑ Oldest first' },
              { value: 'filename', label: 'Sort by filename' },
            ]}
            showClear={!!searchQuery}
            onClear={() => setSearchQuery('')}
          />
        )}
        <UploadRowList
          items={visibleHistory}
          getKey={(u) => u.upload_batch}
          selectable={user?.role === 'admin'}
          selected={selectedBatches}
          onToggleSelect={toggleSelectBatch}
          onSelectAll={selectAllBatches}
          allSelected={selectedBatches.size === visibleHistory.length && visibleHistory.length > 0}
          headerLabel={loadingHistory ? 'Loading history…' : `Upload history${searchQuery.trim() ? ` (${visibleHistory.length} of ${uploadHistory.length})` : uploadHistory.length ? ` (${uploadHistory.length})` : ''}`}
          bulkActions={user?.role === 'admin' && selectedBatches.size > 0 ? (
            <button onClick={bulkDeleteBatches} disabled={bulkDeleting} style={{ background: '#E24B4A', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {bulkDeleting ? 'Deleting...' : `Delete ${selectedBatches.size} selected`}
            </button>
          ) : null}
          icon="📄"
          hasAnyItems={uploadHistory.length > 0}
          emptyState={(
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
              {loadingHistory ? 'Loading history...' : 'No uploads yet. Upload your first file above!'}
            </div>
          )}
          noMatchState={(
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
              No uploads match “{searchQuery.trim()}”
            </div>
          )}
          renderPrimary={(upload) => (
            <button
              onClick={() => viewBatchData(upload.upload_batch)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--text)', textAlign: 'left' }}
              title="Click to view sales data"
            >
              {upload.filename}
            </button>
          )}
          renderMeta={(upload) => `${upload.record_count} records · batch ${upload.upload_batch} · ${new Date(upload.uploaded_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} · by ${upload.uploaded_by || '—'}`}
          renderBadges={(upload) => (
            <span className="badge" style={{ background: 'var(--blue-light)', color: 'var(--blue)' }}>
              {upload.upload_batch}
            </span>
          )}
          renderActions={(upload) => (
            <>
              <button
                onClick={() => handleExportUpload(upload)}
                disabled={exportingId === upload.id}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}
              >
                {exportingId === upload.id ? '...' : 'Export'}
              </button>
              {user?.role === 'admin' && (
                <button
                  onClick={() => handleDeleteBatch(upload.upload_batch)}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#E24B4A' }}
                >
                  Delete
                </button>
              )}
            </>
          )}
        />

        {/* Batch Data Viewer Modal — shared component, same one every Uploads tab uses */}
        <UploadRecordPreviewModal
          open={!!viewingBatch}
          onClose={() => setViewingBatch(null)}
          title={`Sales data — batch ${viewingBatch}`}
          loading={loadingBatchData}
          rows={batchData}
          emptyLabel="No data found for this batch."
          columns={[
            { key: 'agent_name', header: 'Agent', render: (sale) => sale.agent_name || sale.agent || '—' },
            { key: 'client_name', header: 'Client', render: (sale) => <span style={{ fontWeight: 500 }}>{sale.client_name}</span> },
            { key: 'carrier', header: 'Carrier', render: (sale) => sale.carrier },
            { key: 'plan_name', header: 'Plan', render: (sale) => sale.plan_name || '—' },
            { key: 'effective_date', header: 'Effective Date', render: (sale) => formatDate(sale.effective_date) },
            {
              key: 'status', header: 'Status',
              render: (sale) => {
                const s = (sale.status || '').toLowerCase();
                const bg = s.includes('active') || s.includes('enroll') || s.includes('accept') ? '#D4EDDA'
                  : s.includes('cancel') || s.includes('withdraw') || s.includes('reject') || s.includes('disenroll') ? '#F8D7DA'
                  : s.includes('progress') || s.includes('pending') || s.includes('complete') ? '#FFF3CD'
                  : '#E8F0FE';
                const color = s.includes('active') || s.includes('enroll') || s.includes('accept') ? '#155724'
                  : s.includes('cancel') || s.includes('withdraw') || s.includes('reject') || s.includes('disenroll') ? '#721C24'
                  : s.includes('progress') || s.includes('pending') || s.includes('complete') ? '#856404'
                  : '#1967D2';
                return <span className="badge" style={{ background: bg, color, padding: '4px 8px', borderRadius: 4, fontSize: 11 }}>{sale.status || '—'}</span>;
              },
            },
          ]}
        />
    </UploadPageShell>
  );
}

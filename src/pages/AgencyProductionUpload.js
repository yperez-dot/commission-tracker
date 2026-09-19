import React, { useState, useEffect } from 'react';
import { apiFetch, getToken } from '../api';
import {
  UploadPageShell,
  UploadDropZone,
  UploadAlert,
  UploadRecordPreviewModal,
  UploadListToolbar,
  UploadRowList,
} from '../components/UploadPageLayout';
import { agencyProductionUploadExportPath, exportUploadFile } from '../utils/exportUpload';

export default function AgencyProductionUpload({ user }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [uploadResults, setUploadResults] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploadHistory, setUploadHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCarrier, setFilterCarrier] = useState('');
  const [sortBy, setSortBy] = useState('date_desc'); // date_desc | date_asc | carrier | filename
  const [selectedUploads, setSelectedUploads] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Record preview — shared React modal, replacing the DOM innerHTML modal
  // this page used to build by hand.
  const [viewUpload, setViewUpload] = useState(null);
  const [viewRecords, setViewRecords] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

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
      setError('Only Excel files (.xlsx or .xls) are allowed');
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
      setError('Please select at least one file');
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
            results.push({
              file: file.name,
              success: true,
              message: result.message || 'Upload successful!',
              inserted: result.inserted,
              skipped_inactive: result.skipped_inactive || 0,
              skipped_duplicate: result.skipped_duplicate || 0,
              skipped_missing_data: result.skipped_missing_data || 0
            });
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
      setSuccess(`${successCount} file(s) uploaded successfully${failCount > 0 ? `, ${failCount} failed` : ''}`);
      setFiles([]);
      await loadUploadHistory();
    } else {
      setError(`All ${failCount} file(s) failed to upload`);
    }
    
    setLoading(false);
  }

  async function handleDeleteUpload(upload) {
    const confirmDelete = window.confirm(
      `Delete this upload?\n\nFile: ${upload.filename}\nCarrier: ${upload.carrier}\nRecords: ${upload.record_count}\n\nThis will permanently delete this upload and all its production records.\n\nThis cannot be undone.`
    );
    
    if (!confirmDelete) return;
    
    try {
      const result = await apiFetch(`/agency-production/upload/${upload.id}`, {
        method: 'DELETE'
      });
      
      alert(`Deleted ${result.carrier} upload\n\n${result.deleted_production} production records deleted`);

      // Reload history
      await loadUploadHistory();
    } catch (err) {
      alert(`Error deleting upload: ${err.message}`);
    }
  }

  function toggleSelectUpload(id) {
    setSelectedUploads((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function selectAllUploads() {
    if (selectedUploads.size === visibleHistory.length) setSelectedUploads(new Set());
    else setSelectedUploads(new Set(visibleHistory.map((u) => u.id)));
  }

  async function bulkDeleteUploads() {
    const toDelete = uploadHistory.filter((u) => selectedUploads.has(u.id));
    if (!window.confirm(`Delete ${toDelete.length} uploads and all their production records? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      for (const u of toDelete) {
        await apiFetch(`/agency-production/upload/${u.id}`, { method: 'DELETE' });
      }
      setSelectedUploads(new Set());
      await loadUploadHistory();
    } catch (err) {
      alert(`Error deleting uploads: ${err.message}`);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function openUpload(upload) {
    setViewUpload(upload);
    setViewLoading(true);
    setViewRecords([]);
    try {
      const data = await apiFetch(`/agency-production?upload_id=${upload.id}&limit=1000`);
      setViewRecords(data.production || []);
    } catch (err) {
      console.error('Error loading production records:', err);
    } finally {
      setViewLoading(false);
    }
  }

  async function handleExportUpload(upload) {
    if (!upload?.id) return;
    setExportingId(upload.id);
    setError(null);
    try {
      await exportUploadFile({
        path: agencyProductionUploadExportPath(upload.id, 'xlsx'),
        fallbackName: `${String(upload.filename || upload.carrier || 'agency_production').replace(/\.[^.]+$/, '')}_export.xlsx`,
      });
    } catch (err) {
      setError(err.message || 'Export failed');
    } finally {
      setExportingId(null);
    }
  }

  const qHist = searchQuery.trim().toLowerCase();
  const allCarriers = Array.from(new Set(uploadHistory.map((u) => u.carrier).filter(Boolean))).sort();
  const visibleHistory = uploadHistory
    .filter((u) => {
      if (qHist) {
        const hay = [u.filename, u.carrier, u.upload_batch, u.uploaded_by]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(qHist)) return false;
      }
      if (filterCarrier && u.carrier !== filterCarrier) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':
          return new Date(a.uploaded_at) - new Date(b.uploaded_at);
        case 'carrier':
          return (a.carrier || '').localeCompare(b.carrier || '');
        case 'filename':
          return (a.filename || '').localeCompare(b.filename || '');
        case 'date_desc':
        default:
          return new Date(b.uploaded_at) - new Date(a.uploaded_at);
      }
    });

  return (
    <>
    <UploadPageShell
      title="Agency Production"
      subtitle="Hector's monthly production reports (Humana, UHC, Aetna, etc.) for Agency Override Recon."
    >
        <UploadDropZone
          dragOver={dragOver}
          setDragOver={setDragOver}
          onDropFiles={(files) => handleFileSelect(files)}
          uploading={loading}
          dropTitle="Drop agency production Excel here"
          dropHint="Excel (.xlsx, .xls) — multiple files supported"
          accept=".xlsx,.xls"
          multiple
          inputId="agency-file-input"
          processingLabel="Uploading..."
          processingHint="Parsing production reports"
        />

        {files.length > 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Selected files ({files.length})</span>
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
                background: result.success ? (result.inserted === 0 ? 'var(--yellow-light, #fff8e1)' : 'var(--green-light)') : 'var(--red-light)',
                border: `1px solid ${result.success ? (result.inserted === 0 ? 'var(--yellow, #f59e0b)' : 'var(--green)') : 'var(--red)'}`,
                borderRadius: '4px',
                fontSize: '12px',
                color: result.success ? (result.inserted === 0 ? 'var(--yellow-dark, #92400e)' : 'var(--green-dark)') : 'var(--red-dark)'
              }}>
                <div style={{ fontWeight: 600 }}>{result.success ? (result.inserted === 0 ? 'No new rows' : 'Uploaded') : 'Failed'} — {result.file}</div>
                <div style={{ marginTop: '4px', opacity: 0.8 }}>{result.message}</div>
                {result.success && result.inserted === 0 && (result.skipped_inactive > 0 || result.skipped_duplicate > 0 || result.skipped_missing_data > 0) && (
                  <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.9 }}>
                    Skipped: {[result.skipped_duplicate > 0 && `${result.skipped_duplicate} duplicate`, result.skipped_inactive > 0 && `${result.skipped_inactive} inactive`, result.skipped_missing_data > 0 && `${result.skipped_missing_data} missing data`].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {error && !uploadResults.length && (
          <UploadAlert>{error}</UploadAlert>
        )}

        {success && !uploadResults.length && (
          <UploadAlert kind="success">{success}</UploadAlert>
        )}



        <div className="card" style={{ marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>What this is for</div>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>Hector sends monthly production reports (one per carrier)</li>
            <li>Upload them here to verify BSI/NHP override payments</li>
            <li>Agency Override Recon compares production vs overrides</li>
          </ul>
        </div>

        {uploadHistory.length > 0 && (
          <UploadListToolbar
            search={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search filename, carrier, or batch…"
            filterValue={filterCarrier}
            onFilterChange={setFilterCarrier}
            filterOptions={allCarriers}
            sortValue={sortBy}
            onSortChange={setSortBy}
            sortOptions={[
              { value: 'date_desc', label: '↓ Newest first' },
              { value: 'date_asc', label: '↑ Oldest first' },
              { value: 'carrier', label: 'Sort by carrier' },
              { value: 'filename', label: 'Sort by filename' },
            ]}
            showClear={!!(searchQuery || filterCarrier)}
            onClear={() => { setSearchQuery(''); setFilterCarrier(''); }}
          />
        )}
        <UploadRowList
          items={visibleHistory}
          getKey={(u) => u.id}
          selectable={user?.role === 'admin'}
          selected={selectedUploads}
          onToggleSelect={toggleSelectUpload}
          onSelectAll={selectAllUploads}
          allSelected={selectedUploads.size === visibleHistory.length && visibleHistory.length > 0}
          headerLabel={loadingHistory ? 'Loading history…' : `Upload history${searchQuery.trim() || filterCarrier ? ` (${visibleHistory.length} of ${uploadHistory.length})` : uploadHistory.length ? ` (${uploadHistory.length})` : ''}`}
          bulkActions={user?.role === 'admin' && selectedUploads.size > 0 ? (
            <button onClick={bulkDeleteUploads} disabled={bulkDeleting} style={{ background: '#E24B4A', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {bulkDeleting ? 'Deleting...' : `Delete ${selectedUploads.size} selected`}
            </button>
          ) : null}
          icon="📈"
          hasAnyItems={uploadHistory.length > 0}
          emptyState={(
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
              {loadingHistory ? 'Loading history...' : 'No uploads yet. Upload your first production report above!'}
            </div>
          )}
          noMatchState={(
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
              No uploads match “{searchQuery.trim()}”
            </div>
          )}
          renderPrimary={(upload) => (
            <button
              onClick={() => openUpload(upload)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--text)', textAlign: 'left' }}
              title="Click to view uploaded records"
            >
              {upload.filename}
            </button>
          )}
          renderMeta={(upload) => `${upload.record_count} records · batch ${upload.upload_batch} · ${new Date(upload.uploaded_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} · by ${upload.uploaded_by || '—'}`}
          renderBadges={(upload) => (
            <span className="badge" style={{ background: 'var(--green-light)', color: 'var(--green)' }}>
              {upload.carrier}
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
                  onClick={() => handleDeleteUpload(upload)}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#E24B4A' }}
                >
                  Delete
                </button>
              )}
            </>
          )}
        />
    </UploadPageShell>

      {/* Record preview — shared React modal (replaces the old innerHTML modal) */}
      <UploadRecordPreviewModal
        open={!!viewUpload}
        onClose={() => setViewUpload(null)}
        title={viewUpload ? viewUpload.filename : ''}
        subtitle={viewUpload ? `${viewUpload.carrier} · ${viewUpload.upload_batch} · ${viewRecords.length} records` : ''}
        loading={viewLoading}
        rows={viewRecords}
        columns={[
          { key: 'agent_name', header: 'Agent', render: (r) => r.agent_name || '—' },
          { key: 'client_name', header: 'Client', render: (r) => r.client_name || '—' },
          { key: 'effective_date', header: 'Effective Date', render: (r) => r.effective_date || '—' },
          { key: 'status', header: 'Status', render: (r) => r.status || '—' },
          { key: 'policy_type', header: 'Plan', render: (r) => r.policy_type || '—' },
        ]}
      />
    </>
  );
}

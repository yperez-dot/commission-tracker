import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload } from '../api';
import { formatDateTime } from '../utils/dateFormat';
import UploadRouteConfirm from '../components/UploadRouteConfirm';
import {
  detectUploadDestination,
  destinationMatchesTab,
  UPLOAD_PAGE_BY_DEST,
} from '../utils/uploadDestination';
import { setPendingUpload, takePendingUpload } from '../utils/pendingUpload';
import {
  UploadPageShell,
  UploadDropZone,
  UploadAlert,
  UploadRecordPreviewModal,
  UploadListToolbar,
  UploadRowList,
} from '../components/UploadPageLayout';
import { commissionUploadExportPath, exportUploadFile } from '../utils/exportUpload';
import { statementSearchText } from '../utils/statementDisplayName';
import StatementFileName from '../components/StatementFileName';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BSIStatementsUpload({ user, onNavigate }) {
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [exportingId, setExportingId] = useState(null);
  const [routeConfirm, setRouteConfirm] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCarrier, setFilterCarrier] = useState('');
  const [sortBy, setSortBy] = useState('date_desc'); // date_desc | date_asc | carrier
  const [selectedUploads, setSelectedUploads] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Record preview — shared React modal, replacing the old DOM innerHTML
  // modal below (unescaped field interpolation, no React event handling).
  const [viewUpload, setViewUpload] = useState(null);
  const [viewRecords, setViewRecords] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

  const loadUploads = useCallback(async () => {
    try {
      const data = await apiFetch('/files/uploads?category=bsi_statement');
      setUploads(data || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadUploads();
  }, [loadUploads]);

  useEffect(() => {
    const pending = takePendingUpload();
    if (pending) queueFile(pending);
  }, []);

  function queueFile(file) {
    if (!file) return;
    const detected = detectUploadDestination(file.name);
    if (!destinationMatchesTab(detected.id, 'bsi_statement') && detected.confidence !== 'low') {
      setRouteConfirm({ file, detected });
      return;
    }
    handleFile(file);
  }

  async function handleFile(file) {
    if (!file) return;
    setUploading(true);
    setError('');
    setUploadResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', 'bsi_statement');

      const result = await apiUpload('/files/upload-bsi-statement', fd);
      setUploadResult(result);
      loadUploads();
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
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

  function toggleSelectUpload(id) {
    setSelectedUploads((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function selectAllUploads() {
    if (selectedUploads.size === visibleUploads.length) setSelectedUploads(new Set());
    else setSelectedUploads(new Set(visibleUploads.map((u) => u.id)));
  }

  async function bulkDeleteUploads() {
    if (!window.confirm(`Delete ${selectedUploads.size} BSI statement uploads and all their records?`)) return;
    setBulkDeleting(true);
    try {
      for (const id of selectedUploads) {
        await apiFetch(`/files/uploads/${id}`, { method: 'DELETE' });
      }
      setUploads((prev) => prev.filter((u) => !selectedUploads.has(u.id)));
      setSelectedUploads(new Set());
    } catch (e) {
      console.error(e);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function openUpload(upload) {
    setViewUpload(upload);
    setViewLoading(true);
    setViewRecords([]);
    try {
      const data = await apiFetch(`/records?upload_id=${upload.id}&limit=500`);
      setViewRecords(data.records || []);
    } catch (e) {
      console.error(e);
    } finally {
      setViewLoading(false);
    }
  }

  async function exportUpload(u) {
    if (!u?.id) return;
    setExportingId(u.id);
    setError('');
    try {
      await exportUploadFile({
        path: commissionUploadExportPath(u.id, 'xlsx'),
        fallbackName: `${String(u.original_name || 'bsi_statement').replace(/\.[^.]+$/, '')}_export.xlsx`,
      });
    } catch (e) {
      setError(e.message || 'Export failed');
    } finally {
      setExportingId(null);
    }
  }

  const q = searchQuery.trim().toLowerCase();
  const allCarriers = Array.from(new Set(
    uploads.flatMap((u) => (u.carrier || '').split(',').map((s) => s.trim()).filter(Boolean))
  )).sort();
  const visibleUploads = uploads
    .filter((u) => {
      if (q) {
        const hay = [
          statementSearchText(u.original_name, { category: 'bsi_statement' }),
          u.uploaded_by_name,
          u.carrier,
          u.uploaded_by != null ? `User ${u.uploaded_by}` : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterCarrier && !((u.carrier || '').toLowerCase().includes(filterCarrier.toLowerCase()))) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':
          return new Date(a.uploaded_at) - new Date(b.uploaded_at);
        case 'carrier':
          return (a.carrier || '').localeCompare(b.carrier || '');
        case 'date_desc':
        default:
          return new Date(b.uploaded_at) - new Date(a.uploaded_at);
      }
    });

  return (
    <div>
      {routeConfirm && (
        <UploadRouteConfirm
          filename={routeConfirm.file?.name}
          detected={routeConfirm.detected}
          currentLabel="BSI Statements"
          onUseSuggested={() => {
            const { file, detected } = routeConfirm;
            setRouteConfirm(null);
            const pageId = UPLOAD_PAGE_BY_DEST[detected.id];
            if (pageId && onNavigate) {
              setPendingUpload(file);
              onNavigate(pageId);
            } else {
              handleFile(file);
            }
          }}
          onStayHere={() => {
            const { file } = routeConfirm;
            setRouteConfirm(null);
            handleFile(file);
          }}
          onCancel={() => setRouteConfirm(null)}
        />
      )}

      <UploadPageShell
        title="BSI Statements"
        subtitle="Carrier→BSI feeds (Humana / UHC / Aetna / Devoted). BSI→THE remittance belongs under Commission Statements."
      >
        <UploadDropZone
          dragOver={dragOver}
          setDragOver={setDragOver}
          onDropFiles={(files) => { if (files[0]) queueFile(files[0]); }}
          uploading={uploading}
          dropTitle="Drop BSI statement here"
          dropHint="Supports .xlsx, .xls, .csv, .pdf"
          accept=".xlsx,.xls,.csv,.pdf"
          inputId="bsi-file-input"
        />

        {error && <UploadAlert>{error}</UploadAlert>}

        {uploadResult && (
          <UploadAlert kind="success" title="Upload complete">
            File: {uploadResult.filename}
            {(uploadResult.rowCount != null || uploadResult.recordsImported != null) && (
              <div style={{ marginTop: 4 }}>
                Records imported: {uploadResult.rowCount ?? uploadResult.recordsImported}
              </div>
            )}
            {uploadResult.commissionSum != null && (
              <div style={{ marginTop: 4 }}>
                Statement commission: ${Number(uploadResult.commissionSum).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
            {uploadResult.internalDuplicatesRemoved > 0 && (
              <div style={{ marginTop: 4 }}>
                Skipped {uploadResult.internalDuplicatesRemoved} exact duplicate line
                {uploadResult.internalDuplicatesRemoved === 1 ? '' : 's'} within this file
              </div>
            )}
            {uploadResult.resolvedRenewalsCount > 0 && (
              <div style={{ marginTop: 8, fontWeight: 500 }}>
                {uploadResult.resolvedRenewalsCount} chased/pending renewal
                {uploadResult.resolvedRenewalsCount === 1 ? '' : 's'} auto-resolved
              </div>
            )}
          </UploadAlert>
        )}

        {uploads.length > 0 && (
          <UploadListToolbar
            search={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search BSI, filename, carrier, or uploader…"
            filterValue={filterCarrier}
            onFilterChange={setFilterCarrier}
            filterOptions={allCarriers}
            sortValue={sortBy}
            onSortChange={setSortBy}
            sortOptions={[
              { value: 'date_desc', label: '↓ Newest first' },
              { value: 'date_asc', label: '↑ Oldest first' },
              { value: 'carrier', label: 'Sort by carrier' },
            ]}
            showClear={!!(searchQuery || filterCarrier)}
            onClear={() => { setSearchQuery(''); setFilterCarrier(''); }}
          />
        )}
        <UploadRowList
          items={visibleUploads}
          getKey={(u) => u.id}
          selectable
          selected={selectedUploads}
          onToggleSelect={toggleSelectUpload}
          onSelectAll={selectAllUploads}
          allSelected={selectedUploads.size === visibleUploads.length && visibleUploads.length > 0}
          headerLabel={`Uploaded BSI Statements ${q || filterCarrier ? `(${visibleUploads.length} of ${uploads.length})` : `(${uploads.length})`}`}
          bulkActions={user.role === 'admin' && selectedUploads.size > 0 ? (
            <button onClick={bulkDeleteUploads} disabled={bulkDeleting} style={{ background: '#E24B4A', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {bulkDeleting ? 'Deleting...' : `Delete ${selectedUploads.size} selected`}
            </button>
          ) : null}
          icon="🧾"
          hasAnyItems={uploads.length > 0}
          emptyState={(
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              No BSI statements uploaded yet
            </div>
          )}
          noMatchState={(
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              No uploads match “{searchQuery.trim()}”
            </div>
          )}
          renderPrimary={(u) => (
            <button onClick={() => openUpload(u)} style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontWeight: 600, fontSize: 13, color: 'var(--text)', textAlign: 'left',
            }}>
              <StatementFileName filename={u.original_name} category="bsi_statement" />
            </button>
          )}
          renderMeta={(u) => `${u.row_count || 0} records · ${fmt(u.commission_sum)} · ${u.carrier || '—'} · ${formatDateTime(u.uploaded_at)} · by ${u.uploaded_by_name || `User ${u.uploaded_by}`}`}
          renderActions={(u) => (
            <>
              <button
                onClick={() => exportUpload(u)}
                disabled={exportingId === u.id}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}
              >
                {exportingId === u.id ? '...' : 'Export'}
              </button>
              {user.role === 'admin' && (
                <button onClick={() => deleteUpload(u.id)} disabled={deletingId === u.id}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#E24B4A' }}>
                  {deletingId === u.id ? '...' : 'Delete'}
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
        title={viewUpload ? <StatementFileName filename={viewUpload.original_name} category="bsi_statement" /> : ''}
        subtitle={viewUpload ? `${viewUpload.row_count || 0} records · ${fmt(viewUpload.commission_sum)} · ${viewUpload.carrier || '—'} · ${formatDateTime(viewUpload.uploaded_at)}` : ''}
        loading={viewLoading}
        rows={viewRecords}
        columns={[
          { key: 'agent_name', header: 'Agent', render: (r) => r.agent_name || '—' },
          { key: 'client_full_name', header: 'Client', render: (r) => r.client_full_name || '—' },
          { key: 'carrier', header: 'Carrier', render: (r) => r.carrier || '—' },
          { key: 'plan_type', header: 'Plan', render: (r) => r.plan_type || '—' },
          { key: 'effective_date', header: 'Eff. Date', render: (r) => r.effective_date || '—' },
          { key: 'payment_period', header: 'Period', render: (r) => r.payment_period || '—' },
          {
            key: 'classification', header: 'Classification',
            render: (r) => {
              const cls = r.classification;
              const bg = cls === 'New Business' ? '#c6f6d5' : cls === 'Renewal' ? '#bee3f8' : cls === 'Chargeback' ? '#fed7d7' : cls === 'Held' ? '#fefcbf' : '#e2e8f0';
              return <span style={{ background: bg, padding: '2px 6px', borderRadius: 3, fontSize: 11 }}>{cls || '—'}</span>;
            },
          },
          {
            key: 'commission', header: 'Commission', align: 'right',
            render: (r) => <span style={{ fontWeight: 500, color: parseFloat(r.commission) < 0 ? '#e53e3e' : '#2f855a' }}>{fmt(r.commission)}</span>,
          },
        ]}
        footer={(rows) => (
          <>
            <td colSpan={6} style={{ padding: '8px 12px', fontSize: 12 }}>Total ({rows.length} records)</td>
            <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right', color: '#1D9E75' }}>
              {fmt(rows.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0))}
            </td>
          </>
        )}
      />
    </div>
  );
}

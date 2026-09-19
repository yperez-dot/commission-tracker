import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload } from '../api';
import { formatDate, formatDateTime } from '../utils/dateFormat';
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

export default function AgentPayoutUploads({ user, onNavigate }) {
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [exportingId, setExportingId] = useState(null);
  const [routeConfirm, setRouteConfirm] = useState(null);
  const [duplicateModal, setDuplicateModal] = useState(null);
  const [selectedDuplicates, setSelectedDuplicates] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCarrier, setFilterCarrier] = useState('');
  const [sortBy, setSortBy] = useState('date_desc'); // date_desc | date_asc | carrier
  const [selectedUploads, setSelectedUploads] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Record preview — same shared modal Commission Statements uses, reading
  // from the same /records table (agent payout rows carry the same upload_id
  // FK, just filtered to category=agent_payout on the list fetch above).
  const [viewUpload, setViewUpload] = useState(null);
  const [viewRecords, setViewRecords] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

  const loadUploads = useCallback(async () => {
    try {
      const data = await apiFetch('/files/uploads?category=agent_payout');
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
    if (!destinationMatchesTab(detected.id, 'agent_payout') && detected.confidence !== 'low') {
      setRouteConfirm({ file, detected });
      return;
    }
    handleFile(file);
  }

  async function handleFile(file, skipDuplicates = false, selectedDupes = []) {
    if (!file) return;
    setUploading(true);
    setError('');
    setUploadResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', 'agent_payout');
      if (skipDuplicates) {
        fd.append('skipDuplicates', 'true');
        if (selectedDupes.length > 0) {
          fd.append('selectedDuplicates', JSON.stringify(selectedDupes));
        }
      }

      const result = await apiUpload('/files/upload', fd);

      if (result.status === 409 && result.duplicateWarning) {
        setDuplicateModal({
          file,
          sourceType: result.sourceType || 'other',
          duplicateCount: result.duplicateCount,
          totalCount: result.totalCount,
          duplicates: result.duplicates || [],
        });
        setSelectedDuplicates(new Set());
        setUploading(false);
        return;
      }

      setUploadResult(result);
      setDuplicateModal(null);
      loadUploads();
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function deleteUpload(id) {
    if (!window.confirm('Delete this agent payout upload?')) return;
    setDeletingId(id);
    try {
      await apiFetch(`/files/uploads/${id}`, { method: 'DELETE' });
      setUploads((prev) => prev.filter((u) => u.id !== id));
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
    if (!window.confirm(`Delete ${selectedUploads.size} agent payout uploads and all their records?`)) return;
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
        fallbackName: `${String(u.original_name || 'agent_payout').replace(/\.[^.]+$/, '')}_export.xlsx`,
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
          statementSearchText(u.original_name, { category: 'agent_payout' }),
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
          currentLabel="Agent Payout Uploads"
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

      {duplicateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              background: 'var(--bg, #fff)',
              borderRadius: 10,
              maxWidth: 520,
              width: '100%',
              padding: 20,
              boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Possible duplicates</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>
              {duplicateModal.duplicateCount} of {duplicateModal.totalCount} rows may already exist.
              Continue and skip selected duplicates, or cancel.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setDuplicateModal(null);
                  setSelectedDuplicates(new Set());
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  const file = duplicateModal.file;
                  const selected = [...selectedDuplicates];
                  setDuplicateModal(null);
                  handleFile(file, true, selected);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <UploadPageShell
        title="Agent Payout Uploads"
        subtitle="Statements for agents you pay (Tailored → Jill Taylor, other ACA producers). THEI house / remittance stays under Commission Statements. After upload, pay them on Payroll → Agent Payouts."
      >
        <UploadDropZone
          dragOver={dragOver}
          setDragOver={setDragOver}
          onDropFiles={(files) => {
            for (const f of files) queueFile(f);
          }}
          uploading={uploading}
          dropTitle="Drop agent payout statement here"
          dropHint="Supports .xlsx, .xls, .csv, .pdf — NHP Commission Reports for producers you pay"
          accept=".xlsx,.xls,.csv,.pdf"
          multiple
          inputId="agent-payout-file-input"
        />

        {error && <UploadAlert>{error}</UploadAlert>}

        {uploadResult && (
          <UploadAlert kind="success" title={`Upload successful — ${uploadResult.filename}`}>
            {uploadResult.rowCount} records imported · {fmt(uploadResult.commissionSum)} total
            {(uploadResult.carriers || []).length > 0 && (
              <div style={{ marginTop: 4 }}>Carriers: {(uploadResult.carriers || []).join(', ')}</div>
            )}
            <div style={{ marginTop: 8, fontWeight: 500 }}>
              Review amounts under Payroll → Agent Payouts.
            </div>
          </UploadAlert>
        )}

        {uploads.length > 0 && (
          <UploadListToolbar
            search={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search NHP, filename, or uploader…"
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
          headerLabel={`Agent payout statements ${q || filterCarrier ? `(${visibleUploads.length} of ${uploads.length})` : `(${uploads.length})`}`}
          bulkActions={user.role === 'admin' && selectedUploads.size > 0 ? (
            <button onClick={bulkDeleteUploads} disabled={bulkDeleting} style={{ background: '#E24B4A', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {bulkDeleting ? 'Deleting...' : `Delete ${selectedUploads.size} selected`}
            </button>
          ) : null}
          icon="💵"
          hasAnyItems={uploads.length > 0}
          emptyState={(
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              No agent payout statements uploaded yet
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
              <StatementFileName filename={u.original_name} category="agent_payout" />
            </button>
          )}
          renderMeta={(u) => `${u.row_count || 0} records · ${u.carrier || '—'} · ${formatDateTime(u.uploaded_at)} · by ${u.uploaded_by_name || `User ${u.uploaded_by}`}`}
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

      {/* Record preview — same shared modal as every other Uploads tab now uses */}
      <UploadRecordPreviewModal
        open={!!viewUpload}
        onClose={() => setViewUpload(null)}
        title={viewUpload ? <StatementFileName filename={viewUpload.original_name} category="agent_payout" /> : ''}
        subtitle={viewUpload ? `${viewUpload.row_count || 0} records · ${fmt(viewUpload.commission_sum)} · ${viewUpload.carrier || '—'} · ${formatDateTime(viewUpload.uploaded_at)}` : ''}
        loading={viewLoading}
        rows={viewRecords}
        columns={[
          { key: 'agent_name', header: 'Agent', render: (r) => <span style={{ fontWeight: 500 }}>{r.agent_name}</span> },
          { key: 'carrier', header: 'Carrier', render: (r) => <span style={{ color: 'var(--text-muted)' }}>{r.carrier}</span> },
          { key: 'client_full_name', header: 'Client', render: (r) => r.client_full_name || '—' },
          { key: 'effective_date', header: 'Effective', render: (r) => <span style={{ color: 'var(--text-muted)' }}>{formatDate(r.effective_date)}</span> },
          {
            key: 'commission', header: 'Commission',
            render: (r) => <span style={{ fontWeight: 600, color: parseFloat(r.commission) < 0 ? '#E24B4A' : '#1D9E75' }}>{fmt(r.commission)}</span>,
          },
          { key: 'classification', header: 'Type', render: (r) => r.classification || '—' },
          { key: 'payment_period', header: 'Period', render: (r) => <span style={{ color: 'var(--text-muted)' }}>{r.payment_period || '—'}</span> },
        ]}
        footer={(rows) => (
          <>
            <td colSpan={4} style={{ padding: '8px 12px', fontSize: 12 }}>Total ({rows.length} records)</td>
            <td style={{ padding: '8px 12px', fontSize: 12, color: '#1D9E75' }}>
              {fmt(rows.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0))}
            </td>
            <td colSpan={2}></td>
          </>
        )}
      />
    </div>
  );
}

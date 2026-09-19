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
import { statementDisplayName, statementSearchText } from '../utils/statementDisplayName';
import StatementFileName from '../components/StatementFileName';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Upload({ user, onNavigate }) {
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [viewUpload, setViewUpload] = useState(null);
  const [selectedUploads, setSelectedUploads] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  const [viewRecords, setViewRecords] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  // New: search/filter/sort state for the uploads list
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCarrier, setFilterCarrier] = useState('');
  const [sortBy, setSortBy] = useState('date_desc'); // date_desc | date_asc | carrier | name
  // Duplicate detection modal state
  const [duplicateModal, setDuplicateModal] = useState(null);
  const [selectedDuplicates, setSelectedDuplicates] = useState(new Set());
  const [expandedDuplicate, setExpandedDuplicate] = useState(null);
  const [routeConfirm, setRouteConfirm] = useState(null); // { file, detected }

  const loadUploads = useCallback(async () => {
    try {
      const data = await apiFetch('/files/uploads');
      setUploads(data || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  useEffect(() => {
    const pending = takePendingUpload();
    if (pending) queueFile(pending);
  }, []);

  function queueFile(file) {
    if (!file) return;
    const detected = detectUploadDestination(file.name);
    if (!destinationMatchesTab(detected.id, 'commission_statement') && detected.confidence !== 'low') {
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
      if (skipDuplicates) {
        fd.append('skipDuplicates', 'true');
        if (selectedDupes.length > 0) {
          fd.append('selectedDuplicates', JSON.stringify(selectedDupes));
        }
      }
      const result = await apiUpload('/files/upload', fd);
      
      // Handle 409 duplicate warning
      if (result.status === 409 && result.duplicateWarning) {
        setDuplicateModal({
          file,
          sourceType: result.sourceType || 'other',
          duplicateCount: result.duplicateCount,
          totalCount: result.totalCount,
          duplicates: result.duplicates || []
        });
        setSelectedDuplicates(new Set());
        setUploading(false);
        return;
      }
      
      setUploadResult(result);
      loadUploads();
      setDuplicateModal(null);
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

  async function exportUpload(u) {
    if (!u?.id) return;
    setExportingId(u.id);
    setError('');
    try {
      await exportUploadFile({
        path: commissionUploadExportPath(u.id, 'xlsx'),
        fallbackName: `${String(u.original_name || 'upload').replace(/\.[^.]+$/, '')}_export.xlsx`,
      });
    } catch (e) {
      setError(e.message || 'Export failed');
    } finally {
      setExportingId(null);
    }
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

  const totalRecords = uploads.reduce((s, u) => s + (u.row_count || 0), 0);
  const totalCommission = uploads.reduce((s, u) => s + (parseFloat(u.commission_sum) || 0), 0);

  // Distinct carriers across all uploads (split on commas because some uploads have multi-carrier strings)
  const allCarriers = Array.from(new Set(
    uploads.flatMap(u => (u.carrier || '').split(',').map(s => s.trim()).filter(Boolean))
  )).sort();

  // Apply search + filter + sort
  const visibleUploads = uploads
    .filter(u => {
      if (searchQuery && !statementSearchText(u.original_name).includes(searchQuery.toLowerCase())) return false;
      if (filterCarrier && !((u.carrier || '').toLowerCase().includes(filterCarrier.toLowerCase()))) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':
          return new Date(a.uploaded_at) - new Date(b.uploaded_at);
        case 'carrier':
          return (a.carrier || '').localeCompare(b.carrier || '');
        case 'name':
          return statementDisplayName(a.original_name).localeCompare(statementDisplayName(b.original_name));
        case 'date_desc':
        default:
          return new Date(b.uploaded_at) - new Date(a.uploaded_at);
      }
    });

  return (
    <div>
      {/* Record viewer modal — shared component, same one every Uploads tab uses now */}
      <UploadRecordPreviewModal
        open={!!viewUpload}
        onClose={() => setViewUpload(null)}
        title={viewUpload ? <StatementFileName filename={viewUpload.original_name} /> : ''}
        subtitle={viewUpload ? `${viewUpload.row_count} records · ${fmt(viewUpload.commission_sum)} · ${viewUpload.carrier} · ${formatDateTime(viewUpload.uploaded_at)}` : ''}
        loading={viewLoading}
        rows={viewRecords}
        columns={[
          { key: 'idx', header: '#', render: (r, i) => <span style={{ color: 'var(--text-muted)' }}>{i + 1}</span> },
          { key: 'agent_name', header: 'Agent', render: (r) => <span style={{ fontWeight: 500 }}>{r.agent_name}</span> },
          { key: 'carrier', header: 'Carrier', render: (r) => <span style={{ color: 'var(--text-muted)' }}>{r.carrier}</span> },
          { key: 'client_full_name', header: 'Client', render: (r) => r.client_full_name || '—' },
          { key: 'effective_date', header: 'Effective', render: (r) => <span style={{ color: 'var(--text-muted)' }}>{formatDate(r.effective_date)}</span> },
          {
            key: 'commission', header: 'Commission',
            render: (r) => <span style={{ fontWeight: 600, color: parseFloat(r.commission) < 0 ? '#E24B4A' : '#1D9E75' }}>{fmt(r.commission)}</span>,
          },
          {
            key: 'classification', header: 'Type',
            render: (r) => (
              <span style={{
                background: r.classification === 'New Business' ? '#E6F4D7' : r.classification === 'Renewal' ? '#E6F1FB' : r.classification === 'Chargeback' ? '#FCE8E8' : '#F3F4F6',
                color: r.classification === 'New Business' ? '#3B6D11' : r.classification === 'Renewal' ? '#0C447C' : r.classification === 'Chargeback' ? '#A32D2D' : '#374151',
                borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 600,
              }}>{r.classification || '—'}</span>
            ),
          },
          { key: 'payment_period', header: 'Period', render: (r) => <span style={{ color: 'var(--text-muted)' }}>{r.payment_period || '—'}</span> },
        ]}
        footer={(rows) => (
          <>
            <td colSpan={5} style={{ padding: '8px 12px', fontSize: 12 }}>Total ({rows.length} records)</td>
            <td style={{ padding: '8px 12px', fontSize: 12, color: '#1D9E75' }}>
              {fmt(rows.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0))}
            </td>
            <td colSpan={2}></td>
          </>
        )}
      />

      {routeConfirm && (
        <UploadRouteConfirm
          filename={routeConfirm.file?.name}
          detected={routeConfirm.detected}
          currentLabel="Commission Statements"
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
        title="Commission Statements"
        subtitle="THEI production, NHP house, and BSI→THE remittance. Agent pay files (Tailored / Jill / other ACA producers) → Uploads → Agent Payout Uploads. Carrier→BSI feeds → BSI Statements."
      >
        <UploadDropZone
          dragOver={dragOver}
          setDragOver={setDragOver}
          onDropFiles={(files) => { for (const f of files) queueFile(f); }}
          uploading={uploading}
          dropTitle="Drop commission statement here"
          dropHint="Supports .xlsx, .xls, .csv, .pdf — any carrier format"
          accept=".xlsx,.xls,.csv,.pdf"
          multiple
        />

        {error && <UploadAlert>{error}</UploadAlert>}

        {uploadResult && (
          <UploadAlert kind="success" title={`Upload successful — ${uploadResult.filename}`}>
            {uploadResult.rowCount} records imported · {fmt(uploadResult.commissionSum)} total · Carriers: {(uploadResult.carriers || []).join(', ')}
            {uploadResult.internalDuplicatesRemoved > 0 && (
              <div style={{ marginTop: 8 }}>
                Skipped {uploadResult.internalDuplicatesRemoved} exact duplicate line
                {uploadResult.internalDuplicatesRemoved === 1 ? '' : 's'} within this file
              </div>
            )}
            {uploadResult.resolvedRenewalsCount > 0 && (
              <div style={{ marginTop: 8, fontWeight: 500 }}>
                {uploadResult.resolvedRenewalsCount} previously chased/pending renewal
                {uploadResult.resolvedRenewalsCount === 1 ? '' : 's'} auto-resolved
                {Array.isArray(uploadResult.resolvedRenewals) && uploadResult.resolvedRenewals.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontWeight: 400 }}>
                    {uploadResult.resolvedRenewals.slice(0, 8).map((r, i) => (
                      <li key={i}>
                        {r.client} · {r.carrier}
                        {r.paymentPeriod ? ` · ${r.paymentPeriod}` : ''}
                        {r.commission != null ? ` · ${fmt(r.commission)}` : ''}
                      </li>
                    ))}
                    {uploadResult.resolvedRenewals.length > 8 && (
                      <li>+{uploadResult.resolvedRenewals.length - 8} more</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </UploadAlert>
        )}

        {/* Duplicate Detection Modal */}
        {duplicateModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ 
              background: 'var(--bg)', 
              borderRadius: 8, 
              maxWidth: 800, 
              width: '90%', 
              maxHeight: '80vh', 
              display: 'flex', 
              flexDirection: 'column',
              border: duplicateModal.sourceType === 'statement' ? '2px solid #2196F3' : '2px solid #FFC107'
            }}>
              {/* Modal Header */}
              <div style={{ 
                padding: '16px 20px', 
                borderBottom: '1px solid var(--border)',
                background: duplicateModal.sourceType === 'statement' ? '#E3F2FD' : '#FFF9E6'
              }}>
                {duplicateModal.sourceType === 'statement' ? (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: 'var(--blue)' }}>ℹ️ These records already exist in OliComm</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {duplicateModal.duplicateCount} of {duplicateModal.totalCount} records match existing entries by policy + client + date + amount. This may be a reconciliation copy — you can import anyway or cancel.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>⚠️ {duplicateModal.duplicateCount} duplicate records found</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Found in {duplicateModal.totalCount} records uploaded</div>
                  </>
                )}
              </div>

              {/* Summary Bar */}
              <div style={{ padding: '12px 20px', background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <strong>Importing {duplicateModal.totalCount - duplicateModal.duplicateCount + selectedDuplicates.size} records</strong>
                {' · '}
                <span style={{ color: 'var(--text-muted)' }}>Skipping {duplicateModal.duplicateCount - selectedDuplicates.size} duplicates</span>
              </div>

              {/* Duplicates List */}
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: '400px', padding: '8px 0' }}>
                {/* Select All Header */}
                <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-muted)' }}>
                  <input
                    type="checkbox"
                    checked={selectedDuplicates.size === duplicateModal.duplicates.length && duplicateModal.duplicates.length > 0}
                    ref={el => {
                      if (el) el.indeterminate = selectedDuplicates.size > 0 && selectedDuplicates.size < duplicateModal.duplicates.length;
                    }}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedDuplicates(new Set(duplicateModal.duplicates.map((d, i) => i)));
                      } else {
                        setSelectedDuplicates(new Set());
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Select all duplicates</div>
                </div>

                {/* Duplicate Rows */}
                {duplicateModal.duplicates.map((dup, idx) => {
                  const isSelected = selectedDuplicates.has(idx);
                  const isExpanded = expandedDuplicate === idx;
                  return (
                    <div key={idx} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? '#E3F2FD' : 'transparent', transition: 'background 0.2s' }}>
                      <div style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => {
                            const newSet = new Set(selectedDuplicates);
                            if (e.target.checked) {
                              newSet.add(idx);
                            } else {
                              newSet.delete(idx);
                            }
                            setSelectedDuplicates(newSet);
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1, fontSize: 13 }}>
                          <div style={{ fontWeight: 600 }}>{dup.client}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {dup.carrier} · {dup.date}
                          </div>
                        </div>
                        <button
                          onClick={() => setExpandedDuplicate(isExpanded ? null : idx)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)' }}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '10px 20px 15px', background: 'var(--bg-muted)', fontSize: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div><strong>Agent:</strong> {dup.agent || 'N/A'}</div>
                          <div><strong>Commission:</strong> {fmt(dup.amount || 0)}</div>
                          <div><strong>Period:</strong> {dup.period || 'N/A'}</div>
                          <div><strong>Type:</strong> {dup.type || 'N/A'}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Modal Footer */}
              <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setDuplicateModal(null);
                    setSelectedDuplicates(new Set());
                    setExpandedDuplicate(null);
                  }}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const selectedDupes = Array.from(selectedDuplicates).map(idx => {
                      const d = duplicateModal.duplicates[idx];
                      return { client: d.client, carrier: d.carrier, date: d.date };
                    });
                    handleFile(duplicateModal.file, true, selectedDupes);
                    setDuplicateModal(null);
                    setSelectedDuplicates(new Set());
                    setExpandedDuplicate(null);
                  }}
                  style={{ padding: '8px 16px', borderRadius: 6, background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                >
                  Import {duplicateModal.totalCount - duplicateModal.duplicateCount + selectedDuplicates.size} records
                </button>
              </div>
            </div>
          </div>
        )}

        {uploads.length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>{uploads.length}</strong> uploads</span>
            <span style={{ color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>{totalRecords.toLocaleString()}</strong> total records</span>
            <span style={{ color: 'var(--text-muted)' }}><strong style={{ color: '#1D9E75' }}>{fmt(totalCommission)}</strong> total commissions</span>
          </div>
        )}

        {uploads.length > 0 && (
          <UploadListToolbar
            search={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search NHP, filename, or carrier..."
            filterValue={filterCarrier}
            onFilterChange={setFilterCarrier}
            filterOptions={allCarriers}
            sortValue={sortBy}
            onSortChange={setSortBy}
            sortOptions={[
              { value: 'date_desc', label: '↓ Newest first' },
              { value: 'date_asc', label: '↑ Oldest first' },
              { value: 'carrier', label: 'Sort by carrier' },
              { value: 'name', label: 'Sort by filename' },
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
          headerLabel={`Uploaded files ${visibleUploads.length !== uploads.length ? `(${visibleUploads.length} of ${uploads.length})` : `(${uploads.length})`}`}
          bulkActions={user.role === 'admin' && selectedUploads.size > 0 ? (
            <button onClick={bulkDeleteUploads} disabled={bulkDeleting} style={{ background: '#E24B4A', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {bulkDeleting ? 'Deleting...' : `Delete ${selectedUploads.size} selected`}
            </button>
          ) : null}
          icon="📊"
          hasAnyItems={uploads.length > 0}
          emptyState={(
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <div className="empty-title">No files uploaded yet</div>
              <div className="empty-sub">Drop your first carrier statement above</div>
            </div>
          )}
          noMatchState={(
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <div className="empty-title">No matches found</div>
              <div className="empty-sub">Try a different search or clear the filters</div>
            </div>
          )}
          renderPrimary={(u) => (
            <button onClick={() => openUpload(u)} style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontWeight: 600, fontSize: 13, color: 'var(--text)', textAlign: 'left',
            }}>
              <StatementFileName filename={u.original_name} />
            </button>
          )}
          renderMeta={(u) => `${u.row_count} records · ${fmt(u.commission_sum)} · ${u.carrier} · ${new Date(u.uploaded_at).toLocaleString()} · by ${u.uploaded_by_name}`}
          renderBadges={() => (
            <span style={{ fontSize: 10, background: '#EAF3DE', color: '#3B6D11', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>Digested</span>
          )}
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
    </div>
  );
}

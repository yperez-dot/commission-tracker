import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload } from '../api';
import { formatDate, formatDateTime } from '../utils/dateFormat';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Upload({ user }) {
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [viewUpload, setViewUpload] = useState(null);
  const [selectedUploads, setSelectedUploads] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
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

  const loadUploads = useCallback(async () => {
    try {
      const data = await apiFetch('/files/uploads');
      setUploads(data || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadUploads(); }, [loadUploads]);

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
          duplicateCount: result.duplicateCount,
          totalCount: result.totalCount,
          duplicates: result.duplicates || []
        });
        setSelectedDuplicates(new Set()); // Start with none selected
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

  // ← FIX: was missing async
  async function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) { await handleFile(file); }
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
      if (searchQuery && !((u.original_name || '').toLowerCase().includes(searchQuery.toLowerCase()))) return false;
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
          return (a.original_name || '').localeCompare(b.original_name || '');
        case 'date_desc':
        default:
          return new Date(b.uploaded_at) - new Date(a.uploaded_at);
      }
    });

  return (
    <div>
      {/* Record viewer modal */}
      {viewUpload && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#ffffff', borderRadius: 12, width: '90%', maxWidth: 900, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{viewUpload.original_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {viewUpload.row_count} records · {fmt(viewUpload.commission_sum)} · {viewUpload.carrier} · {formatDateTime(viewUpload.uploaded_at)}
                </div>
              </div>
              <button onClick={() => setViewUpload(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {viewLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading records...</div>
              ) : viewRecords.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No records found</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                    <tr>
                      {['#','Agent','Carrier','Client','Effective','Commission','Type','Period'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {viewRecords.map((r, i) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{i + 1}</td>
                        <td style={{ padding: '7px 12px', fontWeight: 500 }}>{r.agent_name}</td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{r.carrier}</td>
                        <td style={{ padding: '7px 12px' }}>{r.client_full_name || '—'}</td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{formatDate(r.effective_date)}</td>
                        <td style={{ padding: '7px 12px', fontWeight: 600, color: parseFloat(r.commission) < 0 ? '#E24B4A' : '#1D9E75' }}>{fmt(r.commission)}</td>
                        <td style={{ padding: '7px 12px' }}>
                          <span style={{
                            background: r.classification === 'New Business' ? '#E6F4D7' : r.classification === 'Renewal' ? '#E6F1FB' : r.classification === 'Chargeback' ? '#FCE8E8' : '#F3F4F6',
                            color: r.classification === 'New Business' ? '#3B6D11' : r.classification === 'Renewal' ? '#0C447C' : r.classification === 'Chargeback' ? '#A32D2D' : '#374151',
                            borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 600
                          }}>{r.classification || '—'}</span>
                        </td>
                        <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{r.payment_period || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8f9fa', fontWeight: 700 }}>
                      <td colSpan={5} style={{ padding: '8px 12px', fontSize: 12 }}>Total ({viewRecords.length} records)</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, color: '#1D9E75' }}>
                        {fmt(viewRecords.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0))}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">Upload statements</div>
        <div className="page-sub">Upload carrier statements — OliComm auto-detects columns for any format</div>
      </div>
      <div className="page-body">

        {/* Drop zone */}
        <div className="card" style={{ marginBottom: 16 }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}>
          <div style={{
            border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`,
            borderRadius: 8, padding: '32px 20px', textAlign: 'center',
            background: dragOver ? 'var(--blue-light)' : 'transparent',
            transition: 'all 0.2s'
          }}>
            {uploading ? (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Processing file...</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>AI is detecting columns and parsing records</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Drop carrier statement here</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Supports .xlsx, .xls, .csv, .pdf — any carrier format</div>
                <label style={{ background: 'var(--blue)', color: '#fff', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Choose file
                  <input type="file" accept=".xlsx,.xls,.csv,.pdf" multiple style={{ display: 'none' }}
                    onChange={async e => {
                      const files = Array.from(e.target.files);
                      for (const f of files) { await handleFile(f); }
                      e.target.value = '';
                    }} />
                </label>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ background: '#FCE8E8', border: '1px solid #F7C1C1', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#A32D2D' }}>
            ⚠️ {error}
          </div>
        )}

        {uploadResult && (
          <div style={{ background: '#EAF3DE', border: '1px solid #C0DD97', borderRadius: 8, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: '#3B6D11' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ Upload successful — {uploadResult.filename}</div>
            <div>{uploadResult.rowCount} records imported · {fmt(uploadResult.commissionSum)} total · Carriers: {(uploadResult.carriers || []).join(', ')}</div>
          </div>
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
                      {duplicateModal.duplicateCount} of {duplicateModal.totalCount} records match existing entries by client + carrier + effective date. This may be a reconciliation copy — you can import anyway or cancel.
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

        <div className="card" style={{ padding: 0 }}>
          {/* Search + filter + sort toolbar */}
          {uploads.length > 0 && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search by filename..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: '1 1 220px', minWidth: 180, padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}
              />
              <select
                value={filterCarrier}
                onChange={(e) => setFilterCarrier(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
              >
                <option value="">All carriers</option>
                {allCarriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
              >
                <option value="date_desc">↓ Newest first</option>
                <option value="date_asc">↑ Oldest first</option>
                <option value="carrier">Sort by carrier</option>
                <option value="name">Sort by filename</option>
              </select>
              {(searchQuery || filterCarrier) && (
                <button
                  onClick={() => { setSearchQuery(''); setFilterCarrier(''); }}
                  style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" checked={selectedUploads.size === visibleUploads.length && visibleUploads.length > 0} onChange={selectAllUploads} style={{ cursor: 'pointer' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>
              Uploaded files {visibleUploads.length !== uploads.length ? `(${visibleUploads.length} of ${uploads.length})` : `(${uploads.length})`}
            </span>
            {selectedUploads.size > 0 && (
              <button onClick={bulkDeleteUploads} disabled={bulkDeleting} style={{ background: '#E24B4A', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {bulkDeleting ? 'Deleting...' : `Delete ${selectedUploads.size} selected`}
              </button>
            )}
          </div>
          {uploads.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <div className="empty-title">No files uploaded yet</div>
              <div className="empty-sub">Drop your first carrier statement above</div>
            </div>
          ) : visibleUploads.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <div className="empty-title">No matches found</div>
              <div className="empty-sub">Try a different search or clear the filters</div>
            </div>
          ) : visibleUploads.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--border)', background: selectedUploads.has(u.id) ? 'var(--blue-light)' : 'transparent' }}>
              <input type="checkbox" checked={selectedUploads.has(u.id)} onChange={() => toggleSelectUpload(u.id)} style={{ cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ fontSize: 20, flexShrink: 0 }}>📊</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button onClick={() => openUpload(u)} style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontWeight: 600, fontSize: 13, color: '#185FA5', textAlign: 'left',
                  textDecoration: 'underline', marginBottom: 2
                }}>
                  {u.original_name}
                </button>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {u.row_count} records · {fmt(u.commission_sum)} · {u.carrier} · {new Date(u.uploaded_at).toLocaleString()} · by {u.uploaded_by_name}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 10, background: '#EAF3DE', color: '#3B6D11', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>Digested</span>
                {user.role === 'admin' && (
                  <button onClick={() => deleteUpload(u.id)} disabled={deletingId === u.id}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#E24B4A' }}>
                    {deletingId === u.id ? '...' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
import { UploadPageShell, UploadDropZone, UploadAlert, UploadHistoryCard } from '../components/UploadPageLayout';
import { commissionUploadExportPath, exportUploadFile } from '../utils/exportUpload';

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
  const visibleUploads = !q
    ? uploads
    : uploads.filter((u) => {
        const hay = [
          u.original_name,
          u.uploaded_by_name,
          u.carrier,
          u.uploaded_by != null ? `User ${u.uploaded_by}` : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
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

        <UploadHistoryCard
          title={`Uploaded BSI Statements (${q ? `${visibleUploads.length} of ${uploads.length}` : uploads.length})`}
        >
        {uploads.length > 0 && (
          <div style={{ padding: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search filename, carrier, or uploader…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: '1 1 240px', minWidth: 180, padding: '8px 12px', borderRadius: 6,
                border: '0.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)',
              }}
            />
            {q && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none', border: '0.5px solid var(--border)', borderRadius: 6,
                  padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)',
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {uploads.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No BSI statements uploaded yet
          </div>
        ) : visibleUploads.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            No uploads match “{searchQuery.trim()}”
          </div>
        ) : (
          <div style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 12 }}>File Name</th>
                  <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 12 }}>Uploaded</th>
                  <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, fontSize: 12 }}>Uploaded By</th>
                  <th style={{ padding: 12, textAlign: 'right', fontWeight: 600, fontSize: 12 }}>Records</th>
                  <th style={{ padding: 12, textAlign: 'right', fontWeight: 600, fontSize: 12 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleUploads.map((u, i) => (
                  <tr key={u.id} style={{
                    borderBottom: i < visibleUploads.length - 1 ? '1px solid var(--border)' : 'none'
                  }}>
                    <td style={{ padding: 12, fontSize: 14 }}>
                      <a
                        href="#"
                        onClick={async (e) => {
                          e.preventDefault();
                          try {
                            const data = await apiFetch(`/records?upload_id=${u.id}&limit=500`);
                            const records = data.records || [];
                            if (!records.length) { alert('No records found for this upload'); return; }
                            const modal = document.createElement('div');
                            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;';
                            const fmt = (v) => parseFloat(v||0).toFixed(2);
                            const total = records.reduce((s,r)=>s+(parseFloat(r.commission)||0),0);
                            const clsBadge = (cls) => {
                              const bg = cls==='New Business'?'#c6f6d5':cls==='Renewal'?'#bee3f8':cls==='Chargeback'?'#fed7d7':cls==='Held'?'#fefcbf':'#e2e8f0';
                              return `<span style="background:${bg};padding:2px 6px;border-radius:3px;font-size:11px;">${cls||'\u2014'}</span>`;
                            };
                            modal.innerHTML = `
                              <div style="background:white;border-radius:8px;max-width:95vw;width:1100px;max-height:90vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                                <div style="padding:16px 20px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:white;z-index:1;">
                                  <div>
                                    <h2 style="margin:0;font-size:16px;">${u.original_name}</h2>
                                    <p style="margin:4px 0 0;font-size:12px;color:#666;">${records.length} records &bull; $${fmt(total)} total</p>
                                  </div>
                                  <button onclick="this.closest('[style*=fixed]').remove()" style="background:#e53e3e;color:white;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:12px;">&#x2715; Close</button>
                                </div>
                                <div style="padding:16px;overflow-x:auto;">
                                  <table style="width:100%;border-collapse:collapse;font-size:12px;">
                                    <thead>
                                      <tr style="background:#f5f5f5;border-bottom:2px solid #ddd;">
                                        <th style="text-align:left;padding:8px;">Agent</th>
                                        <th style="text-align:left;padding:8px;">Client</th>
                                        <th style="text-align:left;padding:8px;">Carrier</th>
                                        <th style="text-align:left;padding:8px;">Plan</th>
                                        <th style="text-align:left;padding:8px;">Eff. Date</th>
                                        <th style="text-align:left;padding:8px;">Period</th>
                                        <th style="text-align:left;padding:8px;">Classification</th>
                                        <th style="text-align:right;padding:8px;">Commission</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      ${records.map((r, idx) => `
                                        <tr style="border-bottom:1px solid #eee;${idx%2===0?'background:#fafafa;':''}">
                                          <td style="padding:7px 8px;">${r.agent_name||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.client_full_name||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.carrier||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.plan_type||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.effective_date||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${r.payment_period||'\u2014'}</td>
                                          <td style="padding:7px 8px;">${clsBadge(r.classification)}</td>
                                          <td style="padding:7px 8px;text-align:right;color:${parseFloat(r.commission)<0?'#e53e3e':'#2f855a'};font-weight:500;">$${fmt(r.commission)}</td>
                                        </tr>
                                      `).join('')}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            `;
                            document.body.appendChild(modal);
                            modal.onclick = (ev) => { if (ev.target === modal) modal.remove(); };
                          } catch (err) {
                            alert('Error loading records: ' + err.message);
                          }
                        }}
                        style={{ color: 'var(--accent,#6B46C1)', textDecoration: 'none', cursor: 'pointer', borderBottom: '1px dashed currentColor' }}
                        onMouseOver={e => e.currentTarget.style.borderBottom='1px solid currentColor'}
                        onMouseOut={e => e.currentTarget.style.borderBottom='1px dashed currentColor'}
                        title="Click to view records"
                      >
                        {u.original_name}
                      </a>
                    </td>
                    <td style={{ padding: 12, fontSize: 14, color: 'var(--text-muted)' }}>
                      {formatDateTime(u.uploaded_at)}
                    </td>
                    <td style={{ padding: 12, fontSize: 14, color: 'var(--text-muted)' }}>
                      {u.uploaded_by_name || `User ${u.uploaded_by}`}
                    </td>
                    <td style={{ padding: 12, fontSize: 14, textAlign: 'right' }}>
                      {u.row_count || 0}
                    </td>
                    <td style={{ padding: 12, textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          onClick={() => exportUpload(u)}
                          disabled={exportingId === u.id}
                          className="btn"
                          style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                          {exportingId === u.id ? 'Exporting...' : 'Export'}
                        </button>
                        {user.role === 'admin' && (
                          <button
                            onClick={() => deleteUpload(u.id)}
                            disabled={deletingId === u.id}
                            className="btn btn-danger"
                            style={{ fontSize: 12, padding: '4px 12px' }}
                          >
                            {deletingId === u.id ? 'Deleting...' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </UploadHistoryCard>
      </UploadPageShell>
    </div>
  );
}

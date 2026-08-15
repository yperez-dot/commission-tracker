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
  const [routeConfirm, setRouteConfirm] = useState(null);
  const [duplicateModal, setDuplicateModal] = useState(null);
  const [selectedDuplicates, setSelectedDuplicates] = useState(new Set());

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

        <UploadHistoryCard title={`Agent payout statements (${uploads.length})`}>
          {uploads.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              No agent payout statements uploaded yet
            </div>
          ) : (
            <div
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
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
                  {uploads.map((u, i) => (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: i < uploads.length - 1 ? '1px solid var(--border)' : 'none',
                      }}
                    >
                      <td style={{ padding: 12, fontSize: 14 }}>{u.original_name}</td>
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

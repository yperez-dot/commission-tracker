import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import './EditCommissionModal.css';

/**
 * EditCommissionModal — manual edit with audit trail (admin).
 *
 * Props:
 *   record: the commission record to edit
 *   onClose: callback when modal closes
 *   onSave: callback after successful save
 */
const EditCommissionModal = ({ record, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    commission: record.commission || 0,
    theiShare: record.thei_share || 0,
    bsiShare: record.bsi_share || 0,
    classification: record.classification || '',
    notes: ''
  });

  const [auditHistory, setAuditHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    fetchAuditHistory();
  }, [record.id]);

  const fetchAuditHistory = async () => {
    try {
      const data = await apiFetch(`/commission/${record.id}/audit`);
      setAuditHistory(data.auditHistory || []);
    } catch (err) {
      console.error('Failed to fetch audit history:', err);
    }
  };

  const currentUserEmail = () => {
    try {
      return JSON.parse(localStorage.getItem('he_user') || '{}').email || 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await apiFetch(`/commission/${record.id}/edit`, {
        method: 'PUT',
        body: JSON.stringify({
          commission: parseFloat(formData.commission),
          theiShare: parseFloat(formData.theiShare),
          bsiShare: parseFloat(formData.bsiShare),
          classification: formData.classification,
          editedBy: currentUserEmail(),
          notes: formData.notes
        })
      });

      if (data.success) {
        if (onSave) onSave(data.record);
        onClose();
      }
    } catch (err) {
      setError(err.message || 'Failed to save changes');
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async () => {
    if (!window.confirm('Revert to original parsed values? This will undo all manual edits.')) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await apiFetch(`/commission/${record.id}/revert`, {
        method: 'POST',
        body: JSON.stringify({
          editedBy: currentUserEmail(),
          notes: 'User-requested reversion'
        })
      });

      if (data.success) {
        if (onSave) onSave(data.record);
        onClose();
      }
    } catch (err) {
      setError(err.message || 'Failed to revert changes');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content edit-commission-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Commission Record</h2>
          <button type="button" className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          <div className="record-info">
            <div><strong>Client:</strong> {record.client_full_name}</div>
            <div><strong>Agent:</strong> {record.agent_name}</div>
            <div><strong>Carrier:</strong> {record.carrier}</div>
            <div><strong>Period:</strong> {record.payment_period}</div>
          </div>

          {record.is_manually_edited && (
            <div className="original-values-box">
              <h4>Original Parsed Values (Evidence Retention)</h4>
              <div className="original-values-grid">
                <div>
                  <label>Commission:</label>
                  <span>${record.original_commission?.toFixed(2) || 'N/A'}</span>
                </div>
                <div>
                  <label>THEI Share:</label>
                  <span>${record.original_thei_share?.toFixed(2) || 'N/A'}</span>
                </div>
                <div>
                  <label>BSI Share:</label>
                  <span>${record.original_bsi_share?.toFixed(2) || 'N/A'}</span>
                </div>
                <div>
                  <label>Classification:</label>
                  <span>{record.original_classification || 'N/A'}</span>
                </div>
              </div>
              <div className="last-edited">
                Last edited by {record.edited_by} on {new Date(record.edited_at).toLocaleString()}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Commission Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.commission}
                  onChange={(e) => setFormData({ ...formData, commission: e.target.value })}
                  required
                />
                <span className="hint">Total commission (agent + override)</span>
              </div>

              <div className="form-group">
                <label>THEI Share (Override)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.theiShare}
                  onChange={(e) => setFormData({ ...formData, theiShare: e.target.value })}
                />
                <span className="hint">Agency override amount</span>
              </div>

              <div className="form-group">
                <label>BSI Share (Override)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.bsiShare}
                  onChange={(e) => setFormData({ ...formData, bsiShare: e.target.value })}
                />
                <span className="hint">Upline override amount</span>
              </div>

              <div className="form-group">
                <label>Classification</label>
                <select
                  value={formData.classification}
                  onChange={(e) => setFormData({ ...formData, classification: e.target.value })}
                  required
                >
                  <option value="">Select...</option>
                  <option value="Override">Override</option>
                  <option value="Agent Comp">Agent Comp</option>
                  <option value="New Business">New Business</option>
                  <option value="Renewal">Renewal</option>
                  <option value="Chargeback">Chargeback</option>
                </select>
              </div>
            </div>

            <div className="form-group full-width">
              <label>Edit Notes (Required)</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Explain why this record needs manual correction..."
                rows="3"
                required
              />
              <span className="hint">E.g., "Mis-classified as override, actually agent commission to Carolina"</span>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="button-row">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Saving...' : 'Save Changes'}
              </button>

              {record.is_manually_edited && (
                <button type="button" className="btn-secondary" onClick={handleRevert} disabled={loading}>
                  Revert to Original
                </button>
              )}

              <button type="button" className="btn-link" onClick={() => setShowAudit(!showAudit)}>
                {showAudit ? 'Hide' : 'Show'} Audit History ({auditHistory.length})
              </button>

              <button type="button" className="btn-cancel" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>

          {showAudit && auditHistory.length > 0 && (
            <div className="audit-history">
              <h4>Audit Trail</h4>
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Date/Time</th>
                    <th>Edited By</th>
                    <th>Field</th>
                    <th>Old Value</th>
                    <th>New Value</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {auditHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.edited_at).toLocaleString()}</td>
                      <td>{entry.edited_by}</td>
                      <td>{entry.field_name}</td>
                      <td className="old-value">{entry.old_value}</td>
                      <td className="new-value">{entry.new_value}</td>
                      <td>{entry.notes || '—'}</td>
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
};

export default EditCommissionModal;

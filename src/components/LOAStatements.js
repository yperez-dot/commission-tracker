import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LOAStatements() {
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    agent_name: 'Carolina Robles',
    payment_date: new Date().toISOString().split('T')[0],
    period_label: '',
    items: [],
    commission_structure: {
      plan_changes: '$100 flat',
      new_to_medicare: '$150 flat',
      lead_generated: 'Full commission'
    }
  });
  const [newItem, setNewItem] = useState({
    client_name: '',
    carrier: '',
    transaction_type: 'New to Book',
    amount: '',
    note: ''
  });

  useEffect(() => {
    loadStatements();
  }, []);

  async function loadStatements() {
    try {
      setLoading(true);
      const data = await apiFetch('/loa-statements');
      setStatements(data.statements || []);
    } catch (err) {
      console.error('Error loading LOA statements:', err);
    } finally {
      setLoading(false);
    }
  }

  function addItem() {
    if (!newItem.client_name || !newItem.carrier || newItem.amount === '') {
      alert('Please fill in Client, Carrier, and Amount');
      return;
    }

    setFormData({
      ...formData,
      items: [...formData.items, { ...newItem, amount: parseFloat(newItem.amount) }]
    });

    setNewItem({
      client_name: '',
      carrier: '',
      transaction_type: 'New to Book',
      amount: '',
      note: ''
    });
  }

  function removeItem(index) {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index)
    });
  }

  async function saveStatement(status = 'draft') {
    if (!formData.agent_name || !formData.payment_date || formData.items.length === 0) {
      alert('Please fill in Agent, Payment Date, and add at least one item');
      return;
    }

    try {
      await apiFetch('/loa-statements', {
        method: 'POST',
        body: JSON.stringify({ ...formData, status })
      });

      alert(`Statement ${status === 'approved' ? 'approved' : 'saved as draft'}!`);
      setShowCreateForm(false);
      setFormData({
        agent_name: 'Carolina Robles',
        payment_date: new Date().toISOString().split('T')[0],
        period_label: '',
        items: [],
        commission_structure: {
          plan_changes: '$100 flat',
          new_to_medicare: '$150 flat',
          lead_generated: 'Full commission'
        }
      });
      loadStatements();
    } catch (err) {
      console.error('Error saving statement:', err);
      alert('Error saving statement: ' + err.message);
    }
  }

  async function downloadStatement(id, agentName, periodLabel) {
    try {
      console.log('Downloading statement:', id);
      
      // Create a temporary link to trigger download
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
      const token = localStorage.getItem('token');
      
      // Use a form to POST with token (bypasses CORS/auth issues)
      const url = `${API_URL}/api/loa-statements/${id}/export?token=${encodeURIComponent(token)}`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `THEI_Payment_Statement_${agentName.replace(/\s+/g, '_')}_${(periodLabel || 'statement').replace(/\s+/g, '_')}.xlsx`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      console.log('Download initiated!');
    } catch (err) {
      console.error('Error downloading statement:', err);
      alert('Error downloading statement: ' + err.message);
    }
  }

  async function markAsPaid(id) {
    try {
      await apiFetch(`/loa-statements/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 'paid',
          paid_date: new Date().toISOString().split('T')[0]
        })
      });
      loadStatements();
    } catch (err) {
      console.error('Error marking as paid:', err);
    }
  }

  async function deleteStatement(id) {
    if (!window.confirm('Delete this statement? This cannot be undone.')) return;

    try {
      await apiFetch(`/loa-statements/${id}`, { method: 'DELETE' });
      loadStatements();
    } catch (err) {
      console.error('Error deleting statement:', err);
    }
  }

  const total = formData.items.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);

  if (loading) {
    return <div className="loading">Loading LOA statements...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>LOA Statements</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Producer payment statements for LOA (Loan Out Agreement) agents
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          {showCreateForm ? 'Cancel' : '+ Create Statement'}
        </button>
      </div>

      {showCreateForm && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>Create New Statement</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>Agent</label>
              <input
                type="text"
                value={formData.agent_name}
                onChange={(e) => setFormData({ ...formData, agent_name: e.target.value })}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>Payment Date</label>
              <input
                type="date"
                value={formData.payment_date}
                onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 500 }}>Period Label</label>
              <input
                type="text"
                value={formData.period_label}
                onChange={(e) => setFormData({ ...formData, period_label: e.target.value })}
                placeholder="e.g., January - April 2026"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 4 }}
              />
            </div>
          </div>

          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Add Line Items</h4>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.5fr 1fr 2fr auto', gap: 8, marginBottom: 12, alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>Client</label>
              <input
                type="text"
                value={newItem.client_name}
                onChange={(e) => setNewItem({ ...newItem, client_name: e.target.value })}
                placeholder="Client name"
                style={{ width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>Carrier</label>
              <input
                type="text"
                value={newItem.carrier}
                onChange={(e) => setNewItem({ ...newItem, carrier: e.target.value })}
                placeholder="Carrier"
                style={{ width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>Type</label>
              <select
                value={newItem.transaction_type}
                onChange={(e) => setNewItem({ ...newItem, transaction_type: e.target.value })}
                style={{ width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4 }}
              >
                <option>New to Book</option>
                <option>Plan Changes</option>
                <option>Medigap</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>Amount</label>
              <input
                type="number"
                step="0.01"
                value={newItem.amount}
                onChange={(e) => setNewItem({ ...newItem, amount: e.target.value })}
                placeholder="0.00"
                style={{ width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>Note (optional)</label>
              <input
                type="text"
                value={newItem.note}
                onChange={(e) => setNewItem({ ...newItem, note: e.target.value })}
                placeholder="Note"
                style={{ width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4 }}
              />
            </div>
            <button
              onClick={addItem}
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                padding: '5px 12px',
                fontSize: 12,
                cursor: 'pointer',
                height: 28
              }}
            >
              + Add
            </button>
          </div>

          {formData.items.length > 0 && (
            <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Client</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Carrier</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Type</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Amount</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Note</th>
                    <th style={{ padding: '8px', borderBottom: '1px solid var(--border)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {formData.items.map((item, i) => (
                    <tr key={i} style={{ borderBottom: i < formData.items.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <td style={{ padding: '6px 8px' }}>{item.client_name}</td>
                      <td style={{ padding: '6px 8px' }}>{item.carrier}</td>
                      <td style={{ padding: '6px 8px' }}>{item.transaction_type}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>{fmt(item.amount)}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)' }}>{item.note || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <button
                          onClick={() => removeItem(i)}
                          style={{
                            background: 'none',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            padding: '2px 8px',
                            fontSize: 11,
                            cursor: 'pointer',
                            color: 'var(--red)'
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--bg-subtle)', fontWeight: 600 }}>
                    <td colSpan={3} style={{ padding: '8px', textAlign: 'right' }}>TOTAL:</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--green)' }}>{fmt(total)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button
              onClick={() => saveStatement('draft')}
              style={{
                background: 'white',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Save as Draft
            </button>
            <button
              onClick={() => saveStatement('approved')}
              style={{
                background: 'var(--green)',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Approve & Generate
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 500 }}>
          All Statements ({statements.length})
        </div>

        {statements.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📄</div>
            <div className="empty-title">No LOA statements yet</div>
            <div className="empty-sub">Create your first producer payment statement above</div>
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle)' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500 }}>Agent</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500 }}>Period</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500 }}>Payment Date</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500 }}>Amount</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '8px 12px', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {statements.map(stmt => (
                <tr key={stmt.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{stmt.agent_name}</td>
                  <td style={{ padding: '10px 12px' }}>{stmt.period_label || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{new Date(stmt.payment_date).toLocaleDateString()}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--green)' }}>
                    {fmt(stmt.total_amount)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 500,
                      background: stmt.status === 'paid' ? 'rgba(80,160,80,0.1)' : stmt.status === 'approved' ? 'rgba(80,120,200,0.1)' : 'rgba(150,150,150,0.1)',
                      color: stmt.status === 'paid' ? 'var(--green)' : stmt.status === 'approved' ? 'var(--accent)' : 'var(--text-muted)'
                    }}>
                      {stmt.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => downloadStatement(stmt.id, stmt.agent_name, stmt.period_label)}
                        style={{
                          background: 'var(--accent)',
                          color: 'white',
                          border: 'none',
                          borderRadius: 4,
                          padding: '4px 10px',
                          fontSize: 11,
                          cursor: 'pointer',
                          fontWeight: 500
                        }}
                      >
                        ↓ Excel
                      </button>
                      {stmt.status !== 'paid' && (
                        <button
                          onClick={() => markAsPaid(stmt.id)}
                          style={{
                            background: 'var(--green)',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            padding: '4px 10px',
                            fontSize: 11,
                            cursor: 'pointer',
                            fontWeight: 500
                          }}
                        >
                          ✓ Paid
                        </button>
                      )}
                      {stmt.status === 'draft' && (
                        <button
                          onClick={() => deleteStatement(stmt.id)}
                          style={{
                            background: 'none',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            padding: '4px 10px',
                            fontSize: 11,
                            cursor: 'pointer',
                            color: 'var(--red)'
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Payroll({ user }) {
  const [uploads, setUploads] = useState([]);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [paidStatus, setPaidStatus] = useState({});
  const [paidDates, setPaidDates] = useState({});
  const [saving, setSaving] = useState({});
  const [tab, setTab] = useState('statements');

  useEffect(() => {
    loadUploads();
  }, []);

  async function loadUploads() {
    setLoading(true);
    try {
      const data = await apiFetch('/files/uploads');
      // Only show NHP uploads
      const nhp = (data || []).filter(u =>
        u.original_name.toLowerCase().includes('the_health_experts_insurance_statement') ||
        u.carrier?.toLowerCase().includes('nhp') ||
        u.original_name.toLowerCase().includes('nhp')
      );
      setUploads(nhp);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function loadPayouts(uploadId) {
    setLoading(true);
    try {
      // Get all Agent Commission records for this upload
      const data = await apiFetch(`/records?upload_id=${uploadId}&classification=Agent Commission&limit=500`);
      const records = data.records || [];

      // Group by agent
      const grouped = {};
      for (const r of records) {
        const agent = r.agent_name || 'Unknown';
        if (!grouped[agent]) grouped[agent] = { agent, records: [], total: 0 };
        grouped[agent].records.push(r);
        grouped[agent].total += parseFloat(r.commission) || 0;
      }

      const payoutList = Object.values(grouped).sort((a, b) => b.total - a.total);
      setPayouts(payoutList);

      // Load existing paid status from localStorage
      const key = `payroll_${uploadId}`;
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      setPaidStatus(saved.paid || {});
      setPaidDates(saved.dates || {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function selectUpload(upload) {
    setSelectedUpload(upload);
    loadPayouts(upload.id);
  }

  function togglePaid(agent) {
    const newStatus = { ...paidStatus, [agent]: !paidStatus[agent] };
    const newDates = { ...paidDates };
    if (newStatus[agent]) {
      newDates[agent] = new Date().toISOString().slice(0, 10);
    } else {
      delete newDates[agent];
    }
    setPaidStatus(newStatus);
    setPaidDates(newDates);
    // Save to localStorage
    const key = `payroll_${selectedUpload.id}`;
    localStorage.setItem(key, JSON.stringify({ paid: newStatus, dates: newDates }));
  }

  function exportStatement(agent) {
    const payout = payouts.find(p => p.agent === agent);
    if (!payout) return;
    const headers = ['Client', 'Carrier', 'Effective Date', 'Commission', 'Period'];
    const rows = payout.records.map(r => [
      r.client_full_name, r.carrier, r.effective_date, r.commission, r.payment_period
    ]);
    const csv = [
      [`Agent: ${agent}`],
      [`Statement: ${selectedUpload?.original_name}`],
      [`Total: ${fmt(payout.total)}`],
      [],
      headers,
      ...rows
    ].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payout_${agent.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAllStatements() {
    if (!payouts.length) return;
    const lines = [
      `NHP Payout Summary`,
      `Statement: ${selectedUpload?.original_name}`,
      `Generated: ${new Date().toLocaleDateString()}`,
      ``,
    ];
    for (const p of payouts) {
      const paid = paidStatus[p.agent];
      lines.push(`Agent: ${p.agent}`);
      lines.push(`Total: ${fmt(p.total)}`);
      lines.push(`Status: ${paid ? `Paid on ${paidDates[p.agent]}` : 'Unpaid'}`);
      lines.push(`Client,Carrier,Effective Date,Commission,Period`);
      for (const r of p.records) {
        lines.push(`"${r.client_full_name}","${r.carrier}","${r.effective_date}","${r.commission}","${r.payment_period}"`);
      }
      lines.push(``);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NHP_Payouts_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalOwed = payouts.reduce((s, p) => s + p.total, 0);
  const totalPaid = payouts.filter(p => paidStatus[p.agent]).reduce((s, p) => s + p.total, 0);
  const totalUnpaid = totalOwed - totalPaid;
  const paidCount = payouts.filter(p => paidStatus[p.agent]).length;

  const tabStyle = (id) => ({
    padding: '7px 14px', border: 'none', background: 'none', fontSize: 13, cursor: 'pointer',
    borderBottom: tab === id ? '2px solid var(--blue)' : '2px solid transparent',
    color: tab === id ? 'var(--blue)' : 'var(--text-muted)',
    fontWeight: tab === id ? 600 : 400, marginBottom: -1
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Payroll</div>
        <div className="page-sub">NHP agent payout statements — track who you owe and mark as paid</div>
      </div>
      <div className="page-body">

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
          <button style={tabStyle('statements')} onClick={() => setTab('statements')}>NHP Statements</button>
          <button style={tabStyle('history')} onClick={() => setTab('history')}>Payment History</button>
        </div>

        {tab === 'statements' && (
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14 }}>

            {/* Left — statement list */}
            <div>
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  NHP Uploads
                </div>
                {uploads.length === 0 ? (
                  <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                    No NHP statements uploaded yet
                  </div>
                ) : (
                  uploads.map(u => {
                    const isSelected = selectedUpload?.id === u.id;
                    const key = `payroll_${u.id}`;
                    const saved = JSON.parse(localStorage.getItem(key) || '{}');
                    const paidAgents = Object.values(saved.paid || {}).filter(Boolean).length;
                    return (
                      <button key={u.id} onClick={() => selectUpload(u)} style={{
                        display: 'block', width: '100%', padding: '12px 14px',
                        borderBottom: '1px solid var(--border)', border: 'none',
                        background: isSelected ? 'var(--blue-light)' : 'transparent',
                        cursor: 'pointer', textAlign: 'left',
                        borderLeft: isSelected ? '3px solid var(--blue)' : '3px solid transparent'
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#0C447C' : 'var(--text)', marginBottom: 2 }}>
                          {u.original_name.replace(/_/g, ' ').replace('.xlsx', '')}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{new Date(u.uploaded_at).toLocaleDateString()}</span>
                          {paidAgents > 0 && <span style={{ color: '#1D9E75', fontWeight: 600 }}>{paidAgents} paid</span>}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right — payout detail */}
            <div>
              {!selectedUpload ? (
                <div className="card">
                  <div className="empty-state">
                    <div className="empty-icon">💰</div>
                    <div className="empty-title">Select a statement</div>
                    <div className="empty-sub">Choose an NHP statement from the left to see agent payouts</div>
                  </div>
                </div>
              ) : (
                <div>
                  {/* KPI cards */}
                  <div className="kpi-grid" style={{ marginBottom: 14 }}>
                    <div className="kpi-card">
                      <div className="kpi-label">Total owed</div>
                      <div className="kpi-value blue">{fmt(totalOwed)}</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-label">Paid out</div>
                      <div className="kpi-value green">{fmt(totalPaid)}</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-label">Still owed</div>
                      <div className={`kpi-value ${totalUnpaid > 0 ? 'amber' : 'green'}`}>{fmt(totalUnpaid)}</div>
                    </div>
                    <div className="kpi-card">
                      <div className="kpi-label">Agents paid</div>
                      <div className="kpi-value">{paidCount} / {payouts.length}</div>
                    </div>
                  </div>

                  {totalUnpaid === 0 && payouts.length > 0 && (
                    <div style={{ background: 'var(--green-light)', border: '1px solid #C0DD97', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#3B6D11', fontWeight: 600 }}>
                      ✓ All agents paid for this statement!
                    </div>
                  )}

                  <div className="card" style={{ padding: 0 }}>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        Agent payouts — {payouts.length} agents
                      </span>
                      <button onClick={exportAllStatements} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>
                        ↓ Export all
                      </button>
                    </div>

                    {loading ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
                    ) : payouts.length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-icon">✅</div>
                        <div className="empty-title">No agent payouts</div>
                        <div className="empty-sub">This NHP statement has no Commission-type records</div>
                      </div>
                    ) : (
                      payouts.map((p, i) => {
                        const isPaid = paidStatus[p.agent];
                        const [expanded, setExpanded] = React.useState(false);
                        return (
                          <div key={p.agent} style={{ borderBottom: '1px solid var(--border)' }}>
                            {/* Agent row */}
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                              background: isPaid ? 'var(--green-light)' : 'transparent'
                            }}>
                              {/* Paid toggle */}
                              <button onClick={() => togglePaid(p.agent)} style={{
                                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                                border: isPaid ? 'none' : '2px solid var(--border)',
                                background: isPaid ? '#1D9E75' : 'transparent',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                              }}>
                                {isPaid && <span style={{ color: '#fff', fontSize: 12 }}>✓</span>}
                              </button>

                              {/* Agent info */}
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.agent}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                                  {p.records.length} record{p.records.length !== 1 ? 's' : ''}
                                  {isPaid && paidDates[p.agent] && <span style={{ color: '#1D9E75', marginLeft: 8 }}>Paid {paidDates[p.agent]}</span>}
                                </div>
                              </div>

                              {/* Amount */}
                              <div style={{ fontWeight: 700, fontSize: 15, color: isPaid ? '#1D9E75' : 'var(--blue)' }}>
                                {fmt(p.total)}
                              </div>

                              {/* Actions */}
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => setExpanded(e => !e)} style={{
                                  background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                                  padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--text)'
                                }}>
                                  {expanded ? '▲ Hide' : '▼ Details'}
                                </button>
                                <button onClick={() => exportStatement(p.agent)} style={{
                                  background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                                  padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--text)'
                                }}>
                                  ↓ CSV
                                </button>
                              </div>
                            </div>

                            {/* Expanded records */}
                            {expanded && (
                              <div style={{ background: 'var(--gray-50)', padding: '0 14px 12px 52px' }}>
                                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                                  <thead>
                                    <tr>
                                      <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11, borderBottom: '1px solid var(--border)' }}>Client</th>
                                      <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11, borderBottom: '1px solid var(--border)' }}>Carrier</th>
                                      <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11, borderBottom: '1px solid var(--border)' }}>Effective</th>
                                      <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11, borderBottom: '1px solid var(--border)' }}>Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {p.records.map((r, j) => (
                                      <tr key={j}>
                                        <td style={{ padding: '5px 8px' }}>{r.client_full_name}</td>
                                        <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{r.carrier}</td>
                                        <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{r.effective_date}</td>
                                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: parseFloat(r.commission) < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(r.commission)}</td>
                                      </tr>
                                    ))}
                                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                                      <td colSpan={3} style={{ padding: '6px 8px', fontWeight: 600, fontSize: 12 }}>Total</td>
                                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--blue)' }}>{fmt(p.total)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Statement</th>
                    <th>Agent</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date paid</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No statements uploaded yet</td></tr>
                  ) : uploads.flatMap(u => {
                    const key = `payroll_${u.id}`;
                    const saved = JSON.parse(localStorage.getItem(key) || '{}');
                    const paid = saved.paid || {};
                    const dates = saved.dates || {};
                    return Object.entries(paid).map(([agent, isPaid]) => ({
                      statement: u.original_name.replace(/_/g, ' ').replace('.xlsx', ''),
                      agent, isPaid, date: dates[agent]
                    }));
                  }).filter(r => r.isPaid).map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.statement}</td>
                      <td style={{ fontWeight: 500 }}>{r.agent}</td>
                      <td>—</td>
                      <td><span className="badge badge-green">Paid</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

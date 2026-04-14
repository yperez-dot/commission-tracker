import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function PayoutRow({ p, isPaid, paidDate, onTogglePaid, onExport }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
        background: isPaid ? 'var(--green-light)' : 'transparent'
      }}>
        <button onClick={() => onTogglePaid(p.agent)} style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          border: isPaid ? 'none' : '2px solid var(--border)',
          background: isPaid ? '#1D9E75' : 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          {isPaid && <span style={{ color: '#fff', fontSize: 12 }}>✓</span>}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{p.agent}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            {p.records.length} record{p.records.length !== 1 ? 's' : ''}
            {isPaid && paidDate && <span style={{ color: '#1D9E75', marginLeft: 8 }}>Paid {paidDate}</span>}
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: isPaid ? '#1D9E75' : 'var(--blue)' }}>
          {fmt(p.total)}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setExpanded(e => !e)} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--text)'
          }}>
            {expanded ? '▲ Hide' : '▼ Details'}
          </button>
          <button onClick={() => onExport(p.agent)} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--text)'
          }}>
            ↓ CSV
          </button>
        </div>
      </div>
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
}

export default function Payroll({ user }) {
  const [uploads, setUploads] = useState([]);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [paidStatus, setPaidStatus] = useState({});
  const [paidDates, setPaidDates] = useState({});
  const [tab, setTab] = useState('statements');

  useEffect(() => { loadUploads(); }, []);

  async function loadUploads() {
    setLoading(true);
    try {
      const data = await apiFetch('/files/uploads');
      setUploads(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function loadPayouts(uploadId) {
    setLoading(true);
    try {
      const data = await apiFetch(`/records?upload_id=${uploadId}&limit=500`);
      const allRecs = data.records || [];
      // Agent Commission = Type=Commission rows from NHP = what you owe agents
      const records = allRecs.filter(r =>
        r.classification === 'Agent Commission' && parseFloat(r.commission) > 0
      );
      // Group by agent
      const grouped = {};
      for (const r of records) {
        const agent = r.agent_name || 'Unknown';
        if (!grouped[agent]) grouped[agent] = { agent, records: [], total: 0 };
        grouped[agent].records.push(r);
        grouped[agent].total += parseFloat(r.commission) || 0;
      }
      setPayouts(Object.values(grouped).sort((a, b) => b.total - a.total));
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
    if (newStatus[agent]) newDates[agent] = new Date().toISOString().slice(0, 10);
    else delete newDates[agent];
    setPaidStatus(newStatus);
    setPaidDates(newDates);
    localStorage.setItem(`payroll_${selectedUpload.id}`, JSON.stringify({ paid: newStatus, dates: newDates }));
  }

  function exportStatement(agent) {
    const payout = payouts.find(p => p.agent === agent);
    if (!payout) return;
    const headers = ['Client', 'Carrier', 'Effective Date', 'Commission', 'Period'];
    const rows = payout.records.map(r => [r.client_full_name, r.carrier, r.effective_date, r.commission, r.payment_period]);
    const csv = [
      [`Agent: ${agent}`], [`Statement: ${selectedUpload?.original_name}`], [`Total: ${fmt(payout.total)}`], [],
      headers, ...rows
    ].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `payout_${agent.replace(/\s+/g,'_')}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportAll() {
    if (!payouts.length) return;
    const lines = [`NHP Payout Summary`, `Statement: ${selectedUpload?.original_name}`, `Generated: ${new Date().toLocaleDateString()}`, ``];
    for (const p of payouts) {
      lines.push(`Agent: ${p.agent}`, `Total: ${fmt(p.total)}`, `Status: ${paidStatus[p.agent] ? `Paid ${paidDates[p.agent]}` : 'Unpaid'}`, `Client,Carrier,Effective,Commission`);
      for (const r of p.records) lines.push(`"${r.client_full_name}","${r.carrier}","${r.effective_date}","${r.commission}"`);
      lines.push(``);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `NHP_Payouts_${new Date().toISOString().slice(0,10)}.csv`; a.click();
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
            <div>
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  All Uploads
                </div>
                {uploads.length === 0 ? (
                  <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No statements uploaded yet</div>
                ) : uploads.map(u => {
                  const isSelected = selectedUpload?.id === u.id;
                  const saved = JSON.parse(localStorage.getItem(`payroll_${u.id}`) || '{}');
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
                })}
              </div>
            </div>

            <div>
              {!selectedUpload ? (
                <div className="card">
                  <div className="empty-state">
                    <div className="empty-icon">💰</div>
                    <div className="empty-title">Select a statement</div>
                    <div className="empty-sub">Choose an upload from the left to see agent payouts</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="kpi-grid" style={{ marginBottom: 14 }}>
                    <div className="kpi-card"><div className="kpi-label">Total owed</div><div className="kpi-value blue">{fmt(totalOwed)}</div></div>
                    <div className="kpi-card"><div className="kpi-label">Paid out</div><div className="kpi-value green">{fmt(totalPaid)}</div></div>
                    <div className="kpi-card"><div className="kpi-label">Still owed</div><div className={`kpi-value ${totalUnpaid > 0 ? 'amber' : 'green'}`}>{fmt(totalUnpaid)}</div></div>
                    <div className="kpi-card"><div className="kpi-label">Agents paid</div><div className="kpi-value">{paidCount} / {payouts.length}</div></div>
                  </div>

                  {totalUnpaid === 0 && payouts.length > 0 && (
                    <div style={{ background: 'var(--green-light)', border: '1px solid #C0DD97', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#3B6D11', fontWeight: 600 }}>
                      ✓ All agents paid for this statement!
                    </div>
                  )}

                  <div className="card" style={{ padding: 0 }}>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Agent payouts — {payouts.length} agents</span>
                      <button onClick={exportAll} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>↓ Export all</button>
                    </div>
                    {loading ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
                    ) : payouts.length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-icon">✅</div>
                        <div className="empty-title">No agent payouts found</div>
                        <div className="empty-sub">This statement has no Agent Commission records. Try re-uploading the NHP file.</div>
                      </div>
                    ) : payouts.map(p => (
                      <PayoutRow
                        key={p.agent}
                        p={p}
                        isPaid={!!paidStatus[p.agent]}
                        paidDate={paidDates[p.agent]}
                        onTogglePaid={togglePaid}
                        onExport={exportStatement}
                      />
                    ))}
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
                  <tr><th>Statement</th><th>Agent</th><th>Status</th><th>Date paid</th></tr>
                </thead>
                <tbody>
                  {uploads.flatMap(u => {
                    const saved = JSON.parse(localStorage.getItem(`payroll_${u.id}`) || '{}');
                    return Object.entries(saved.paid || {}).filter(([,v]) => v).map(([agent]) => ({
                      statement: u.original_name.replace(/_/g,' ').replace('.xlsx',''),
                      agent, date: (saved.dates || {})[agent]
                    }));
                  }).map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.statement}</td>
                      <td style={{ fontWeight: 500 }}>{r.agent}</td>
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

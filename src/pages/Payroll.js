import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Agents you don't pay out — their commissions are yours to keep
const YOUR_TEAM = [
  'yahoska perez', 'katy robles', 'gina berenguer', 'jill taylor',
  'osmary orozco', 'sabri perez', 'the health experts insurance',
  'health experts insurance'
];

function isYourTeam(name) {
  return YOUR_TEAM.some(t => String(name || '').toLowerCase().includes(t));
}

function formatPeriodLabel(p) {
  if (!p) return p;
  const s = String(p).trim();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (s.match(/^\d{6}$/)) return months[parseInt(s.slice(4,6))-1] + ' ' + s.slice(0,4);
  if (s.match(/^\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(3);
  if (s.match(/^\d{2}\/\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(6);
  return null;
}

function PayoutRow({ p, isPaid, paidDate, onTogglePaid, onExport }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
        background: isPaid ? '#EAF3DE' : 'transparent'
      }}>
        <button onClick={() => onTogglePaid(p.agent)} style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          border: isPaid ? 'none' : '2px solid var(--border)',
          background: isPaid ? '#1D9E75' : 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          {isPaid && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>✓</span>}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{p.agent}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {p.records.length} record{p.records.length !== 1 ? 's' : ''}
            {isPaid && paidDate && <span style={{ color: '#1D9E75', marginLeft: 8, fontWeight: 600 }}>✓ Paid {paidDate}</span>}
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, color: isPaid ? '#1D9E75' : '#185FA5' }}>
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
          }}>↓ CSV</button>
        </div>
      </div>
      {expanded && (
        <div style={{ background: 'var(--gray-50)', padding: '0 14px 12px 54px' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Client','Carrier','Effective','Period','Statement','Amount'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11, borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.records.map((r, j) => (
                <tr key={j}>
                  <td style={{ padding: '5px 8px' }}>{r.client_full_name}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{r.carrier}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{r.effective_date || '—'}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{r.payment_period || '—'}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.upload_name}>{r.upload_name ? r.upload_name.replace('.xlsx','').replace('.xls','').replace(/_/g,' ') : '—'}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: parseFloat(r.commission) < 0 ? '#E24B4A' : '#1D9E75' }}>{fmt(r.commission)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td colSpan={3} style={{ padding: '6px 8px', fontWeight: 600 }}>Total</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#185FA5' }}>{fmt(p.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Payroll({ user }) {
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [paidStatus, setPaidStatus] = useState({});
  const [paidDates, setPaidDates] = useState({});
  const [tab, setTab] = useState('payroll');
  const [history, setHistory] = useState([]);
  const [filterAgent, setFilterAgent] = useState('');

  useEffect(() => {
    // Load available periods from NHP records
    apiFetch('/records/filters').then(d => {
      const valid = (d.periods || []).filter(p => {
        if (!p || p === 'Unknown') return false;
        const s = String(p);
        return s.match(/^\d{6}$/) || s.match(/^\d{2}\/\d{4}$/) || s.match(/^\d{2}\/\d{2}\/\d{4}$/);
      });
      // Deduplicate by label
      const seen = new Set();
      const deduped = valid.filter(p => {
        const label = formatPeriodLabel(p);
        if (!label || seen.has(label)) return false;
        seen.add(label);
        return true;
      });
      setPeriods(deduped);
    }).catch(console.error);

    // Load history from localStorage
    const saved = JSON.parse(localStorage.getItem('payroll_history') || '[]');
    setHistory(saved);
  }, []);

  async function loadPayouts(period) {
    if (!period) return;
    setLoading(true);
    try {
      // 'all' means no period filter — show everything unpaid
      const url = period === 'all'
        ? `/records?classification=Agent%20Commission&limit=1000`
        : `/records?period=${encodeURIComponent(period)}&classification=Agent%20Commission&limit=500`;
      const data = await apiFetch(url);
      const allRecs = (data.records || []).filter(r =>
        !isYourTeam(r.agent_name) && parseFloat(r.commission) > 0
      );

      const grouped = {};
      const seen = new Set();
      for (const r of allRecs) {
        const agent = r.agent_name || 'Unknown';
        // Deduplicate by client+carrier+period+amount to avoid counting same record multiple times
        const dedupKey = `${agent}|${r.client_full_name}|${r.carrier}|${r.payment_period}|${r.commission}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        if (!grouped[agent]) grouped[agent] = { agent, records: [], total: 0 };
        grouped[agent].records.push(r);
        grouped[agent].total += parseFloat(r.commission) || 0;
      }
      setPayouts(Object.values(grouped).sort((a, b) => b.total - a.total));

      // Load paid status for this period
      const saved = JSON.parse(localStorage.getItem(`payroll_period_${period}`) || '{}');
      setPaidStatus(saved.paid || {});
      setPaidDates(saved.dates || {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function handlePeriodChange(period) {
    setSelectedPeriod(period);
    setPayouts([]);
    setPaidStatus({});
    setPaidDates({});
    setFilterAgent('');
    if (period) loadPayouts(period);
  }

  function togglePaid(agent) {
    const newStatus = { ...paidStatus, [agent]: !paidStatus[agent] };
    const newDates = { ...paidDates };
    if (newStatus[agent]) {
      newDates[agent] = new Date().toISOString().slice(0, 10);
      // Add to history
      const payout = payouts.find(p => p.agent === agent);
      const newHistory = JSON.parse(localStorage.getItem('payroll_history') || '[]');
      newHistory.unshift({
        period: selectedPeriod,
        periodLabel: formatPeriodLabel(selectedPeriod) || selectedPeriod,
        agent, amount: payout?.total || 0,
        date: newDates[agent]
      });
      localStorage.setItem('payroll_history', JSON.stringify(newHistory.slice(0, 200)));
      setHistory(newHistory.slice(0, 200));
    } else {
      delete newDates[agent];
    }
    setPaidStatus(newStatus);
    setPaidDates(newDates);
    localStorage.setItem(`payroll_period_${selectedPeriod}`, JSON.stringify({ paid: newStatus, dates: newDates }));
  }

  function exportStatement(agent) {
    const payout = payouts.find(p => p.agent === agent);
    if (!payout) return;
    const periodLabel = selectedPeriod === 'all' ? 'All Periods' : (formatPeriodLabel(selectedPeriod) || selectedPeriod);
    const headers = ['Client', 'Carrier', 'Effective Date', 'Commission'];
    const rows = payout.records.map(r => [r.client_full_name, r.carrier, r.effective_date, r.commission]);
    const csv = [
      [`NHP Commission Statement`],
      [`Period: ${periodLabel}`],
      [`Agent: ${agent}`],
      [`Total: ${fmt(payout.total)}`],
      [],
      headers, ...rows
    ].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NHP_${agent.replace(/\s+/g,'_')}_${selectedPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAll() {
    if (!payouts.length) return;
    const periodLabel = selectedPeriod === 'all' ? 'All Periods' : (formatPeriodLabel(selectedPeriod) || selectedPeriod);
    const lines = [`NHP Payout Summary — ${periodLabel}`, `Generated: ${new Date().toLocaleDateString()}`, ``];
    for (const p of payouts) {
      lines.push(`Agent: ${p.agent}`, `Total: ${fmt(p.total)}`, `Status: ${paidStatus[p.agent] ? `Paid ${paidDates[p.agent]}` : 'Unpaid'}`, `Client,Carrier,Effective,Commission`);
      for (const r of p.records) lines.push(`"${r.client_full_name}","${r.carrier}","${r.effective_date}","${r.commission}"`);
      lines.push(``);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `NHP_Payouts_${selectedPeriod}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const totalOwed = payouts.reduce((s, p) => s + p.total, 0);
  const totalPaid = payouts.filter(p => paidStatus[p.agent]).reduce((s, p) => s + p.total, 0);
  const totalUnpaid = totalOwed - totalPaid;
  const paidCount = payouts.filter(p => paidStatus[p.agent]).length;
  const periodLabel = selectedPeriod === 'all' ? 'All Periods' : (formatPeriodLabel(selectedPeriod) || selectedPeriod);

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
        <div className="page-sub">Agent payout statements — track who you owe and mark as paid</div>
      </div>
      <div className="page-body">

        <div style={{ display: 'flex', gap: 8, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
          <button style={tabStyle('payroll')} onClick={() => setTab('payroll')}>Agent Statements</button>
          <button style={tabStyle('history')} onClick={() => setTab('history')}>
            Payment History {history.length > 0 && <span style={{ background: '#185FA5', color: '#fff', borderRadius: 99, fontSize: 10, padding: '1px 6px', marginLeft: 4 }}>{history.length}</span>}
          </button>
        </div>

        {tab === 'payroll' && (
          <div>
            {/* Period selector */}
            <div className="card" style={{ marginBottom: 14, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="form-label">Select month</div>
                  <select className="filter-select" value={selectedPeriod} onChange={e => handlePeriodChange(e.target.value)} style={{ minWidth: 160 }}>
                    <option value="">Select period...</option>
                    <option value="all">— All periods (show everything) —</option>
                    {periods.map(p => {
                      const label = formatPeriodLabel(p);
                      return label ? <option key={p} value={p}>{label}</option> : null;
                    })}
                  </select>
                </div>
                {selectedPeriod && payouts.length > 0 && (
                  <button onClick={exportAll} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
                    ↓ Export all
                  </button>
                )}
              </div>
            </div>

            {!selectedPeriod ? (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-icon">💰</div>
                  <div className="empty-title">Select a month</div>
                  <div className="empty-sub">Choose a statement period to see who you owe</div>
                </div>
              </div>
            ) : loading ? (
              <div className="card">
                <div className="empty-state"><div className="empty-title" style={{ color: 'var(--text-muted)' }}>Loading...</div></div>
              </div>
            ) : (
              <div>
                {/* KPI cards */}
                <div className="kpi-grid" style={{ marginBottom: 14 }}>
                  <div className="kpi-card"><div className="kpi-label">Total owed — {periodLabel}</div><div className="kpi-value blue">{fmt(totalOwed)}</div></div>
                  <div className="kpi-card"><div className="kpi-label">Paid out</div><div className="kpi-value green">{fmt(totalPaid)}</div></div>
                  <div className="kpi-card"><div className="kpi-label">Still owed</div><div className={`kpi-value ${totalUnpaid > 0 ? 'amber' : 'green'}`}>{fmt(totalUnpaid)}</div></div>
                  <div className="kpi-card"><div className="kpi-label">Agents paid</div><div className="kpi-value">{paidCount} / {payouts.length}</div></div>
                </div>

                {totalUnpaid === 0 && payouts.length > 0 && (
                  <div style={{ background: '#EAF3DE', border: '1px solid #C0DD97', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#3B6D11', fontWeight: 600 }}>
                    ✓ All agents paid for {periodLabel}!
                  </div>
                )}

                {/* Agent filter */}
              {payouts.length > 0 && (
                <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <select className="filter-select" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
                    <option value="">All agents</option>
                    {payouts.map(p => <option key={p.agent} value={p.agent}>{p.agent}</option>)}
                  </select>
                  {filterAgent && <button onClick={() => setFilterAgent('')} style={{ fontSize: 11, color: '#E24B4A', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Clear</button>}
                </div>
              )}

              <div className="card" style={{ padding: 0 }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Agent payouts — {payouts.filter(p => !filterAgent || p.agent === filterAgent).length} agent{payouts.filter(p => !filterAgent || p.agent === filterAgent).length !== 1 ? 's' : ''}</span>
                  </div>
                  {payouts.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">✅</div>
                      <div className="empty-title">No payouts for this period</div>
                      <div className="empty-sub">No Agent Commission records found for {periodLabel}. Make sure you've uploaded the NHP statement for this month.</div>
                    </div>
                  ) : payouts.filter(p => !filterAgent || p.agent === filterAgent).map(p => (
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
        )}

        {tab === 'history' && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
              Payment history
            </div>
            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <div className="empty-title">No payments recorded yet</div>
                <div className="empty-sub">Mark agents as paid to track history here</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Period</th><th>Agent</th><th>Amount</th><th>Date paid</th><th></th></tr>
                  </thead>
                  <tbody>
                    {history.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12 }}>{r.periodLabel}</td>
                        <td style={{ fontWeight: 500 }}>{r.agent}</td>
                        <td style={{ fontWeight: 600, color: '#1D9E75' }}>{fmt(r.amount)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.date}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => { handlePeriodChange(r.period); setTab('payroll'); }} style={{
                              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                              padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#185FA5', fontWeight: 600
                            }}>View</button>
                            <button onClick={() => {
                              const updated = history.filter((_, j) => j !== i);
                              setHistory(updated);
                              localStorage.setItem('payroll_history', JSON.stringify(updated));
                              // Also unmark as paid in the period storage
                              const key = `payroll_period_${r.period}`;
                              const saved = JSON.parse(localStorage.getItem(key) || '{}');
                              if (saved.paid) { delete saved.paid[r.agent]; delete saved.dates[r.agent]; }
                              localStorage.setItem(key, JSON.stringify(saved));
                            }} style={{
                              background: 'none', border: '1px solid #F7C1C1', borderRadius: 6,
                              padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#E24B4A', fontWeight: 600
                            }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

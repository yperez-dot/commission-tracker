import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import LOAStatements from '../components/LOAStatements';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const YOUR_TEAM = [
  'yahoska perez', 'katy robles'
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

function getRaw(r) {
  try { return typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : (r.raw_data || {}); }
  catch(e) { return {}; }
}

function generateStatement(agent, records, periodLabel, total, isBSI) {
  const agencyName = isBSI ? 'Broker Society Insurance / Level Up Insurance' : 'The Health Experts Insurance';
  const filename = isBSI
    ? `BSI_Statement_${agent.replace(/\s+/g,'_')}_${periodLabel.replace(/\s+/g,'_')}.csv`
    : `THEI_Statement_${agent.replace(/\s+/g,'_')}_${periodLabel.replace(/\s+/g,'_')}.csv`;

  // Format currency without commas so CSV doesn't break columns
  const fmtCsv = n => '$' + Number(n||0).toFixed(2);

  const positives = records.filter(r => parseFloat(r.commission) >= 0);
  const negatives = records.filter(r => parseFloat(r.commission) < 0);
  const grossTotal = positives.reduce((s,r) => s + (parseFloat(r.commission)||0), 0);
  const chargebackTotal = negatives.reduce((s,r) => s + (parseFloat(r.commission)||0), 0);
  const netTotal = grossTotal + chargebackTotal;

  const headers = ['Policy #','Client','Statement','Effective Date','Commission','Type'];

  const rows = [
    [`*** AGENT: ${agent} ***`,'','','','',''],
    [`Period: ${periodLabel}`,'','','','',''],
    ['','','','','',''],
    headers,
    ...positives.map(r => [
      r.policy_number||'—', r.client_full_name, r.statement_month || r.carrier,
      r.effective_date||'—', fmtCsv(r.commission), r.classification||'—'
    ]),
    ...(negatives.length ? [
      ['--- CHARGEBACKS ---','','','','',''],
      ...negatives.map(r => [
        r.policy_number||'—', r.client_full_name, r.statement_month || r.carrier,
        r.effective_date||'—', fmtCsv(r.commission), r.classification||'—'
      ])
    ] : []),
    ['','','','','',''],
    ['Gross Commission','','','',fmtCsv(grossTotal),''],
    ...(negatives.length ? [['Chargebacks','','','',fmtCsv(chargebackTotal),'']] : []),
    ['NET TOTAL','','','',fmtCsv(netTotal),''],
    ['','','','','',''],
  ];

  const csv = rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function PayoutRow({ p, isPaid, paidDate, onTogglePaid, onExport, periodLabel, isBSI }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background: isPaid ? 'rgba(80,160,80,0.06)' : 'transparent' }}>
        <button onClick={() => onTogglePaid(p.agent)} style={{ width:26, height:26, borderRadius:'50%', flexShrink:0, border: isPaid ? 'none' : '2px solid var(--border)', background: isPaid ? 'var(--green)' : 'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          {isPaid && <span style={{ color:'#fff', fontSize:12, fontWeight:600 }}>✓</span>}
        </button>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:14, color:'var(--text)' }}>{p.agent}</div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>
            {p.records.filter(r=>parseFloat(r.commission)>0).length} commission{p.records.filter(r=>parseFloat(r.commission)>0).length!==1?'s':''}
            {p.records.filter(r=>parseFloat(r.commission)<0).length > 0 && (
              <span style={{ marginLeft:8, color:'var(--red)', fontWeight:500 }}>
                · {p.records.filter(r=>parseFloat(r.commission)<0).length} chargeback{p.records.filter(r=>parseFloat(r.commission)<0).length!==1?'s':''} ({fmt(p.records.filter(r=>parseFloat(r.commission)<0).reduce((s,r)=>s+(parseFloat(r.commission)||0),0))})
              </span>
            )}
            {isPaid && paidDate && <span style={{ color:'var(--green)', marginLeft:8, fontWeight:500 }}>✓ Paid {paidDate}</span>}
          </div>
        </div>
        <div style={{ fontWeight:600, fontSize:16, color: isPaid ? 'var(--green)' : 'var(--accent-dark)' }}>{fmt(p.total)}</div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={() => setExpanded(e => !e)} style={{ background:'none', border:'0.5px solid var(--border)', borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer', color:'var(--text)' }}>
            {expanded ? '▲ Hide' : '▼ Details'}
          </button>
          <button onClick={onExport} style={{ background:'var(--accent)', border:'none', borderRadius:6, padding:'4px 12px', fontSize:11, cursor:'pointer', color:'var(--sidebar-bg)', fontWeight:500 }}>
            ↓ Statement
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ background:'var(--bg-subtle)', padding:'0 14px 12px 54px' }}>
          <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse' }}>
            <thead><tr>
              {['Policy #','Client','Statement','Effective','Period','Type','Amount'].map(h => (
                <th key={h} style={{ textAlign: h==='Amount' ? 'right' : 'left', padding:'6px 8px', color:'var(--text-muted)', fontWeight:500, fontSize:11, borderBottom:'0.5px solid var(--border)' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {p.records.map((r,j) => {
                const amount = parseFloat(r.sub_agent_override) > 0 
                  ? parseFloat(r.sub_agent_override) 
                  : (parseFloat(r.producer_payable) > 0 ? parseFloat(r.producer_payable) : parseFloat(r.commission) || 0);
                return (
                  <tr key={j} style={{ borderBottom:'0.5px solid var(--border)' }}>
                    <td style={{ padding:'6px 8px', color:'var(--accent-dark)', fontWeight:500, fontSize:11 }}>{r.policy_number||'—'}</td>
                    <td style={{ padding:'6px 8px', color:'var(--text)' }}>{r.client_full_name}</td>
                    <td style={{ padding:'6px 8px', color:'var(--text-muted)', fontSize:11 }}>{r.statement_month || r.carrier}</td>
                    <td style={{ padding:'6px 8px', color:'var(--text-muted)', fontSize:11 }}>{r.effective_date||'—'}</td>
                    <td style={{ padding:'6px 8px', color:'var(--text-muted)', fontSize:11 }}>{r.payment_period||'—'}</td>
                    <td style={{ padding:'6px 8px', color:'var(--text-muted)', fontSize:11 }}>{r.classification||'—'}</td>
                    <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:500, color: amount<0?'var(--red)':'var(--green)' }}>{fmt(amount)}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop:'0.5px solid var(--border)', background:'var(--bg-subtle)' }}>
                <td colSpan={6} style={{ padding:'7px 8px', fontWeight:500, fontSize:12 }}>Total ({p.records.length} records)</td>
                <td style={{ padding:'7px 8px', textAlign:'right', fontWeight:600, color:'var(--green)', fontSize:12 }}>{fmt(p.total)}</td>
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
  const historyKey = `payroll_history_${(user.agency||'thei').toLowerCase().replace(/[^a-z]/g,'_')}`;
  const [filterAgent, setFilterAgent] = useState('');
  const isBSI = (user.agency||'').toLowerCase().includes('broker society');

  useEffect(() => {
    apiFetch('/records/filters').then(d => {
      const valid = (d.periods||[]).filter(p => {
        if (!p||p==='Unknown') return false;
        const s = String(p);
        return s.match(/^\d{6}$/)||s.match(/^\d{2}\/\d{4}$/)||s.match(/^\d{2}\/\d{2}\/\d{4}$/);
      });
      const seen = new Set();
      setPeriods(valid.filter(p => { const l=formatPeriodLabel(p); if(!l||seen.has(l))return false; seen.add(l); return true; }));
    }).catch(console.error);
    setHistory(JSON.parse(localStorage.getItem(historyKey)||'[]'));
  }, [user.agency]);

  async function loadPayouts(period) {
    if (!period) return;
    setLoading(true);
    try {
      const url = period==='all' ? `/records?limit=2000` : `/records?period=${encodeURIComponent(period)}&limit=2000`;
      const data = await apiFetch(url);
      let allRecs = data.records || [];

      if (isBSI) {
        // BSI: only New Business and Chargebacks — no renewals
        allRecs = allRecs.filter(r => {
          const c = (r.classification || '').toLowerCase();
          return c.includes('new business') || c.includes('chargeback');
        });
      } else {
        // THEI: Include ACA, sub-agent overrides, and chargebacks
        // Will filter agents after grouping (must have at least one positive payable record)
        allRecs = allRecs.filter(r => {
          const classification = (r.classification || '').toLowerCase();
          const lob = (r.lob || '').toUpperCase();
          const hasSubAgentOverride = parseFloat(r.sub_agent_override || 0) > 0;
          const producerPayable = parseFloat(r.producer_payable || 0);
          
          // ACA payable: ANY record with producer_payable !== 0 (includes chargebacks)
          const isACAPayable = lob === 'ACA' && producerPayable !== 0;
          const isChargeback = classification.includes('chargeback');
          
          return (isACAPayable || hasSubAgentOverride || isChargeback) && !isYourTeam(r.agent_name);
        });
      }

      const grouped = {}, seen = new Set();
      for (const r of allRecs) {
        const agent = r.agent_name || 'Unknown';
        // Use sub_agent_override (Christian/Horacio), or producer_payable (ACA), or commission (fallback)
        const commission = parseFloat(r.sub_agent_override) > 0 
          ? parseFloat(r.sub_agent_override) 
          : (parseFloat(r.producer_payable) > 0 ? parseFloat(r.producer_payable) : parseFloat(r.commission) || 0);
        const key = `${agent}|${r.client_full_name}|${r.statement_month || r.carrier}|${r.payment_period}|${r.policy_number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!grouped[agent]) grouped[agent] = { agent, records: [], total: 0, hasPositivePayable: false };
        grouped[agent].records.push(r);
        grouped[agent].total += commission;
        // Track if agent has at least one positive payable record (ACA or sub-agent override, NOT chargeback)
        const isChargeback = (r.classification || '').toLowerCase().includes('chargeback');
        const producerPayable = parseFloat(r.producer_payable || 0);
        const isACAPayable = r.lob === 'ACA' && producerPayable > 0 && !isChargeback;
        const hasSubAgentOV = parseFloat(r.sub_agent_override) > 0 && !isChargeback;
        if ((isACAPayable || hasSubAgentOV) && commission > 0) grouped[agent].hasPositivePayable = true;
      }

      // Only show agents who have at least one positive payable record (not just chargebacks)
      setPayouts(Object.values(grouped).filter(p => p.hasPositivePayable).sort((a,b) => b.total - a.total));
      const saved = JSON.parse(localStorage.getItem(`payroll_period_${period}`)||'{}');
      setPaidStatus(saved.paid||{}); setPaidDates(saved.dates||{});
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }

  function handlePeriodChange(period) {
    setSelectedPeriod(period); setPayouts([]); setPaidStatus({}); setPaidDates({}); setFilterAgent('');
    if (period) loadPayouts(period);
  }

  function togglePaid(agent) {
    const newStatus = {...paidStatus, [agent]: !paidStatus[agent]};
    const newDates = {...paidDates};
    if (newStatus[agent]) {
      newDates[agent] = new Date().toISOString().slice(0,10);
      const payout = payouts.find(p=>p.agent===agent);
      const h = JSON.parse(localStorage.getItem(historyKey)||'[]');
      h.unshift({ period:selectedPeriod, periodLabel:formatPeriodLabel(selectedPeriod)||selectedPeriod, agent, amount:payout?.total||0, date:newDates[agent] });
      localStorage.setItem(historyKey, JSON.stringify(h.slice(0,200)));
      setHistory(h.slice(0,200));
    } else { delete newDates[agent]; }
    setPaidStatus(newStatus); setPaidDates(newDates);
    localStorage.setItem(`payroll_period_${selectedPeriod}`, JSON.stringify({paid:newStatus, dates:newDates}));
  }

  function exportAll() {
    if (!payouts.length) return;
    const pl = selectedPeriod==='all' ? 'All Periods' : (formatPeriodLabel(selectedPeriod)||selectedPeriod);
    const agencyName = isBSI ? 'Broker Society Insurance / Level Up Insurance' : 'The Health Experts Insurance';
    const fmtCsv = n => '$' + Number(n||0).toFixed(2);
    const lines = [`"${agencyName} — Payout Summary"`,`"Period: ${pl}"`,`"Generated by OliComm"`,``];
    for (const p of payouts) {
      const positives = p.records.filter(r => parseFloat(r.commission) >= 0);
      const negatives = p.records.filter(r => parseFloat(r.commission) < 0);
      const gross = positives.reduce((s,r)=>s+(parseFloat(r.commission)||0),0);
      const cb = negatives.reduce((s,r)=>s+(parseFloat(r.commission)||0),0);
      const net = gross + cb;
      lines.push(`"*** AGENT: ${p.agent} ***"`);
      lines.push(`"Status: ${paidStatus[p.agent]?`Paid ${paidDates[p.agent]}`:'Unpaid'}"`);
      lines.push(`"Policy #","Client","Statement","Effective","Commission","Type"`);
      for (const r of positives) lines.push(`"${r.policy_number||''}","${r.client_full_name}","${r.statement_month || r.carrier}","${r.effective_date}","${fmtCsv(r.commission)}","${r.classification||''}"`);
      if (negatives.length) {
        lines.push(`"--- CHARGEBACKS ---"`);
        for (const r of negatives) lines.push(`"${r.policy_number||''}","${r.client_full_name}","${r.statement_month || r.carrier}","${r.effective_date}","${fmtCsv(r.commission)}","${r.classification||''}"`);
      }
      lines.push(`"Gross Commission","","","","${fmtCsv(gross)}",""`);
      if (negatives.length) lines.push(`"Chargebacks","","","","${fmtCsv(cb)}",""`);
      lines.push(`"NET TOTAL","","","","${fmtCsv(net)}",""`);
      lines.push(``);
    }
    const blob = new Blob([lines.join('\n')],{type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`${isBSI?'BSI':'THEI'}_Payouts_${selectedPeriod}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const totalOwed = payouts.reduce((s,p)=>s+p.total,0);
  const totalPaid = payouts.filter(p=>paidStatus[p.agent]).reduce((s,p)=>s+p.total,0);
  const totalUnpaid = totalOwed-totalPaid;
  const paidCount = payouts.filter(p=>paidStatus[p.agent]).length;
  const periodLabel = selectedPeriod==='all' ? 'All Periods' : (formatPeriodLabel(selectedPeriod)||selectedPeriod);
  const tabStyle = id => ({ padding:'7px 14px', border:'none', background:'none', fontSize:13, cursor:'pointer', borderBottom: tab===id?'2px solid var(--accent)':'2px solid transparent', color: tab===id?'var(--accent-dark)':'var(--text-muted)', fontWeight: tab===id?500:400, marginBottom:-1 });

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Payroll</div>
        <div className="page-sub">Agent payout statements — track commissions owed and payments</div>
      </div>
      <div className="page-body">
        <div style={{ display:'flex', gap:8, marginBottom:14, borderBottom:'1px solid var(--border)' }}>
          <button style={tabStyle('payroll')} onClick={()=>setTab('payroll')}>Agent Statements</button>
          <button style={tabStyle('loa')} onClick={()=>setTab('loa')}>LOA Statements</button>
          <button style={tabStyle('history')} onClick={()=>setTab('history')}>
            Payment History
            {history.length>0 && <span style={{ background:'var(--accent)', color:'var(--sidebar-bg)', borderRadius:99, fontSize:10, padding:'1px 6px', marginLeft:4, fontWeight:500 }}>{history.length}</span>}
          </button>
        </div>

        {tab==='loa' && (
          <LOAStatements />
        )}

        {tab==='payroll' && (
          <div>
            <div className="card" style={{ marginBottom:14, padding:'14px 16px' }}>
              <div style={{ display:'flex', alignItems:'flex-end', gap:12, flexWrap:'wrap' }}>
                <div>
                  <div className="form-label">Select month</div>
                  <select className="filter-select" value={selectedPeriod} onChange={e=>handlePeriodChange(e.target.value)} style={{ minWidth:160 }}>
                    <option value="">Select period...</option>
                    <option value="all">— All periods —</option>
                    {periods.map(p => { const l=formatPeriodLabel(p); return l ? <option key={p} value={p}>{l}</option> : null; })}
                  </select>
                </div>
                {selectedPeriod && payouts.length>0 && (
                  <button onClick={exportAll} style={{ background:'none', border:'0.5px solid var(--border)', borderRadius:6, padding:'6px 14px', fontSize:12, cursor:'pointer', color:'var(--text)' }}>↓ Export all</button>
                )}
              </div>
            </div>

            {!selectedPeriod ? (
              <div className="card"><div className="empty-state"><div className="empty-icon">💰</div><div className="empty-title">Select a month</div><div className="empty-sub">Choose a statement period to see agent payouts</div></div></div>
            ) : loading ? (
              <div className="card"><div className="empty-state"><div className="empty-title" style={{color:'var(--text-muted)'}}>Loading...</div></div></div>
            ) : (
              <div>
                <div className="kpi-grid" style={{ marginBottom:14 }}>
                  <div className="kpi-card"><div className="kpi-label">Total owed — {periodLabel}</div><div className="kpi-value blue">{fmt(totalOwed)}</div></div>
                  <div className="kpi-card"><div className="kpi-label">Paid out</div><div className="kpi-value green">{fmt(totalPaid)}</div></div>
                  <div className="kpi-card"><div className="kpi-label">Still owed</div><div className={`kpi-value ${totalUnpaid>0?'amber':'green'}`}>{fmt(totalUnpaid)}</div></div>
                  <div className="kpi-card"><div className="kpi-label">Agents paid</div><div className="kpi-value">{paidCount} / {payouts.length}</div></div>
                </div>
                {totalUnpaid===0 && payouts.length>0 && (
                  <div style={{ background:'#EAF3DE', border:'1px solid #C0DD97', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:13, color:'#3B6D11', fontWeight:500 }}>✓ All agents paid for {periodLabel}!</div>
                )}
                {payouts.length>0 && (
                  <div style={{ marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
                    <select className="filter-select" value={filterAgent} onChange={e=>setFilterAgent(e.target.value)}>
                      <option value="">All agents</option>
                      {payouts.map(p=><option key={p.agent} value={p.agent}>{p.agent}</option>)}
                    </select>
                    {filterAgent && <button onClick={()=>setFilterAgent('')} style={{ fontSize:11, color:'var(--red)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Clear</button>}
                  </div>
                )}
                <div className="card" style={{ padding:0 }}>
                  <div style={{ padding:'10px 14px', borderBottom:'0.5px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span style={{ fontSize:13, fontWeight:500 }}>Agent payouts — {payouts.filter(p=>!filterAgent||p.agent===filterAgent).length} agent{payouts.filter(p=>!filterAgent||p.agent===filterAgent).length!==1?'s':''}</span>
                    <span style={{ fontSize:11, color:'var(--text-muted)' }}>Click ↓ Statement to download</span>
                  </div>
                  {payouts.length===0 ? (
                    <div className="empty-state"><div className="empty-icon">✅</div><div className="empty-title">No payouts for this period</div><div className="empty-sub">No eligible commission records found for {periodLabel}.</div></div>
                  ) : payouts.filter(p=>!filterAgent||p.agent===filterAgent).map(p => (
                    <PayoutRow key={p.agent} p={p} isPaid={!!paidStatus[p.agent]} paidDate={paidDates[p.agent]} onTogglePaid={togglePaid}
                      onExport={()=>generateStatement(p.agent, p.records, periodLabel, p.total, isBSI)} periodLabel={periodLabel} isBSI={isBSI} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab==='history' && (
          <div className="card" style={{ padding:0 }}>
            <div style={{ padding:'10px 14px', borderBottom:'0.5px solid var(--border)', fontSize:13, fontWeight:500 }}>Payment history</div>
            {history.length===0 ? (
              <div className="empty-state"><div className="empty-icon">📋</div><div className="empty-title">No payments recorded yet</div><div className="empty-sub">Mark agents as paid to track history here</div></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Period</th><th>Agent</th><th>Amount</th><th>Date paid</th><th></th></tr></thead>
                  <tbody>
                    {history.map((r,i) => (
                      <tr key={i}>
                        <td style={{ fontSize:12 }}>{r.periodLabel}</td>
                        <td style={{ fontWeight:500 }}>{r.agent}</td>
                        <td style={{ fontWeight:500, color:'var(--green)' }}>{fmt(r.amount)}</td>
                        <td style={{ fontSize:12, color:'var(--text-muted)' }}>{r.date}</td>
                        <td>
                          <div style={{ display:'flex', gap:6 }}>
                            <button onClick={()=>{ handlePeriodChange(r.period); setTab('payroll'); }} style={{ background:'none', border:'0.5px solid var(--border)', borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', color:'var(--accent-dark)', fontWeight:500 }}>View</button>
                            <button onClick={() => {
                              const updated = history.filter((_,j)=>j!==i);
                              setHistory(updated);
                              localStorage.setItem(historyKey, JSON.stringify(updated));
                              const k=`payroll_period_${r.period}`;
                              const sv=JSON.parse(localStorage.getItem(k)||'{}');
                              if(sv.paid){delete sv.paid[r.agent]; delete sv.dates[r.agent];}
                              localStorage.setItem(k,JSON.stringify(sv));
                            }} className="btn btn-danger" style={{ fontSize:11, padding:'3px 10px' }}>Delete</button>
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

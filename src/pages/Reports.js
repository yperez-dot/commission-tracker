import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n) {
  return Number(n || 0).toFixed(1) + '%';
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function periodLabel(p) {
  const s = String(p || '').trim();
  if (s.match(/^\d{6}$/)) return MONTHS[parseInt(s.slice(4,6))-1] + ' ' + s.slice(0,4);
  return s;
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Mini bar chart ──────────────────────────────────────────────────────────
function MiniBar({ value, max, color = '#C9A96E' }) {
  const pct = max > 0 ? Math.max(0, (value / max) * 100) : 0;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ flex:1, height:6, background:'var(--border)', borderRadius:3, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:3, transition:'width 0.3s' }} />
      </div>
    </div>
  );
}

// ─── Chart: period trend ─────────────────────────────────────────────────────
function TrendChart({ data, keys, colors, height = 180 }) {
  if (!data.length) return null;
  const allVals = data.flatMap(d => keys.map(k => parseFloat(d[k]) || 0));
  const maxVal = Math.max(...allVals, 1);
  const barW = Math.max(8, Math.min(32, Math.floor(600 / data.length) - 6));

  return (
    <div style={{ overflowX:'auto' }}>
      <div style={{ display:'flex', alignItems:'flex-end', gap:4, height, paddingBottom:24, minWidth: data.length * (barW * keys.length + 6) }}>
        {data.map((d, i) => (
          <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
            <div style={{ display:'flex', alignItems:'flex-end', gap:2, height: height - 24 }}>
              {keys.map((k, ki) => {
                const val = parseFloat(d[k]) || 0;
                const h = Math.max(2, (val / maxVal) * (height - 24));
                return (
                  <div key={k} title={`${k}: ${fmt(val)}`}
                    style={{ width:barW, height:h, background:colors[ki], borderRadius:'2px 2px 0 0', cursor:'default', opacity:0.9 }} />
                );
              })}
            </div>
            <div style={{ fontSize:9, color:'var(--text-muted)', textAlign:'center', whiteSpace:'nowrap', transform:'rotate(-35deg)', transformOrigin:'top center', marginTop:4 }}>
              {periodLabel(d.period)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Agent Detail Modal ──────────────────────────────────────────────────────
function AgentDetailModal({ agent, year, records, onClose }) {
  const agentRecs = records.filter(r =>
    r.agent_name === agent && String(r.payment_period || '').startsWith(year)
    && parseFloat(r.commission) !== 0
    && r.carrier !== 'Unknown'
  ).sort((a,b) => (b.payment_period||'').localeCompare(a.payment_period||''));

  const total = agentRecs.reduce((s,r) => s+(parseFloat(r.commission)||0), 0);
  const nb = agentRecs.filter(r=>r.classification==='New Business').reduce((s,r)=>s+Math.max(0,parseFloat(r.commission)||0),0);
  const ren = agentRecs.filter(r=>r.classification==='Renewal').reduce((s,r)=>s+Math.max(0,parseFloat(r.commission)||0),0);
  const cb = agentRecs.filter(r=>parseFloat(r.commission)<0).reduce((s,r)=>s+Math.abs(parseFloat(r.commission)||0),0);

  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const modal = (
    <div onClick={onClose} style={{
      position:'fixed', top:0, left:0, width:'100vw', height:'100vh',
      background:'rgba(0,0,0,0.72)', zIndex:99999,
      display:'flex', alignItems:'center', justifyContent:'center',
      padding:32
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:'#2a2118', borderRadius:12, width:'100%', maxWidth:900,
        maxHeight:'85vh', overflow:'hidden', display:'flex', flexDirection:'column',
        boxShadow:'0 24px 80px rgba(0,0,0,0.6)', border:'1px solid rgba(255,255,255,0.08)'
      }}>
        {/* Header */}
        <div style={{ padding:'18px 24px', borderBottom:'1px solid rgba(255,255,255,0.1)', display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexShrink:0 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:18, color:'#F0EAE0' }}>{agent}</div>
            <div style={{ fontSize:12, color:'rgba(240,234,224,0.5)', marginTop:4 }}>{year} · {agentRecs.length} records</div>
          </div>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.08)', border:'none', borderRadius:6, width:32, height:32, fontSize:18, cursor:'pointer', color:'#F0EAE0', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>×</button>
        </div>

        {/* KPI strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', borderBottom:'1px solid rgba(255,255,255,0.1)', flexShrink:0 }}>
          {[['Total',total,'#C9A96E'],['New Business',nb,'#4A9C6A'],['Renewals',ren,'#4A7C59'],['Chargebacks',-cb,'#E05252']].map(([label,val,color])=>(
            <div key={label} style={{ padding:'14px 20px', borderRight:'1px solid rgba(255,255,255,0.08)', textAlign:'center' }}>
              <div style={{ fontSize:10, color:'rgba(240,234,224,0.45)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.7px' }}>{label}</div>
              <div style={{ fontWeight:700, fontSize:17, color }}>{fmt(val)}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ overflowY:'auto', flex:1 }}>
          {agentRecs.length === 0 ? (
            <div style={{ padding:48, textAlign:'center', color:'rgba(240,234,224,0.4)', fontSize:13 }}>No records for {year}</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead style={{ position:'sticky', top:0, background:'#2a2118', zIndex:1 }}>
                <tr style={{ borderBottom:'1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ textAlign:'left', padding:'10px 16px', fontWeight:500, color:'rgba(240,234,224,0.45)', fontSize:11, width:80 }}>Period</th>
                  <th style={{ textAlign:'left', padding:'10px 16px', fontWeight:500, color:'rgba(240,234,224,0.45)', fontSize:11 }}>Client</th>
                  <th style={{ textAlign:'left', padding:'10px 16px', fontWeight:500, color:'rgba(240,234,224,0.45)', fontSize:11, width:140 }}>Carrier</th>
                  <th style={{ textAlign:'left', padding:'10px 16px', fontWeight:500, color:'rgba(240,234,224,0.45)', fontSize:11, width:110 }}>Policy #</th>
                  <th style={{ textAlign:'left', padding:'10px 16px', fontWeight:500, color:'rgba(240,234,224,0.45)', fontSize:11, width:110 }}>Type</th>
                  <th style={{ textAlign:'right', padding:'10px 16px', fontWeight:500, color:'rgba(240,234,224,0.45)', fontSize:11, width:110 }}>Commission</th>
                </tr>
              </thead>
              <tbody>
                {agentRecs.map((r,i)=>(
                  <tr key={i} style={{ borderBottom:'0.5px solid rgba(255,255,255,0.06)', background: i%2===0?'transparent':'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding:'9px 16px', color:'rgba(240,234,224,0.45)', fontSize:11, whiteSpace:'nowrap' }}>{periodLabel(r.payment_period)}</td>
                    <td style={{ padding:'9px 16px', fontWeight:500, color:'#F0EAE0' }}>{r.client_full_name}</td>
                    <td style={{ padding:'9px 16px', color:'rgba(240,234,224,0.6)', fontSize:11 }}>{r.carrier}</td>
                    <td style={{ padding:'9px 16px', color:'#C9A96E', fontSize:11, fontFamily:'monospace' }}>{r.policy_number||'—'}</td>
                    <td style={{ padding:'9px 16px' }}>
                      <span style={{ fontSize:10, padding:'2px 8px', borderRadius:4, fontWeight:500,
                        background: r.classification==='New Business'?'rgba(201,169,110,0.2)':r.classification==='Renewal'?'rgba(74,124,89,0.2)':'rgba(224,82,82,0.2)',
                        color: r.classification==='New Business'?'#C9A96E':r.classification==='Renewal'?'#4A9C6A':'#E05252'
                      }}>{r.classification}</span>
                    </td>
                    <td style={{ padding:'9px 16px', textAlign:'right', fontWeight:600, color:parseFloat(r.commission)<0?'#E05252':'#4A9C6A', fontFamily:'monospace' }}>{fmt(r.commission)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)' }}>
                  <td colSpan={5} style={{ padding:'10px 16px', fontWeight:600, fontSize:12, color:'rgba(240,234,224,0.6)' }}>Total · {agentRecs.length} records</td>
                  <td style={{ padding:'10px 16px', textAlign:'right', fontWeight:700, fontSize:14, color: total < 0 ? '#E05252' : '#C9A96E', fontFamily:'monospace' }}>{fmt(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

function MonthlySummary({ records }) {
  const allYears = [...new Set(records.map(r => String(r.payment_period || '').slice(0,4)).filter(y => y.match(/^\d{4}$/) && parseInt(y) >= 2020))].sort().reverse();
  const [selectedYear, setSelectedYear] = React.useState(allYears[0] || '');
  const [agentSearch, setAgentSearch] = React.useState('');
  const [selectedAgent, setSelectedAgent] = React.useState(null);

  const yearRecords = records.filter(r =>
    String(r.payment_period || '').startsWith(selectedYear) &&
    parseFloat(r.commission) !== 0 &&
    r.carrier !== 'Unknown' &&
    r.agent_name !== 'Broker Society Insurance'
  );
  const allAgents = [...new Set(yearRecords.map(r => r.agent_name))].sort();
  const periods = [...new Set(yearRecords.map(r => r.payment_period))].filter(Boolean).sort();

  // Filter agents by search
  const filteredAgents = agentSearch
    ? allAgents.filter(a => a.toLowerCase().includes(agentSearch.toLowerCase()))
    : allAgents;

  // Build pivot
  const pivot = {};
  for (const r of yearRecords) {
    if (!pivot[r.agent_name]) pivot[r.agent_name] = {};
    pivot[r.agent_name][r.payment_period] = (pivot[r.agent_name][r.payment_period] || 0) + (parseFloat(r.commission) || 0);
  }

  const agentTotals = filteredAgents.map(a => ({
    agent: a,
    total: Object.values(pivot[a] || {}).reduce((s, v) => s + v, 0)
  })).sort((a, b) => b.total - a.total);

  function exportCSV() {
    const header = ['Agent', ...periods.map(periodLabel), 'Total'];
    const rows = agentTotals.map(({ agent }) => [
      agent,
      ...periods.map(p => (pivot[agent]?.[p] || 0).toFixed(2)),
      Object.values(pivot[agent] || {}).reduce((s, v) => s + v, 0).toFixed(2)
    ]);
    downloadCSV(`Monthly_Commission_Summary_${selectedYear}.csv`, [header, ...rows]);
  }

  const maxTotal = Math.max(...agentTotals.map(a => Math.abs(a.total)), 1);

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {allYears.map(y => (
            <button key={y} onClick={() => setSelectedYear(y)} style={{
              padding:'5px 14px', borderRadius:6, fontSize:12, cursor:'pointer', fontWeight:500,
              border: selectedYear===y ? 'none' : '0.5px solid var(--border)',
              background: selectedYear===y ? 'var(--accent)' : 'none',
              color: selectedYear===y ? 'var(--sidebar-bg)' : 'var(--text)'
            }}>{y}</button>
          ))}
        </div>
        <button onClick={exportCSV} style={{ background:'none', border:'0.5px solid var(--border)', borderRadius:6, padding:'5px 14px', fontSize:12, cursor:'pointer', color:'var(--text)' }}>↓ Export CSV</button>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
        <input
          value={agentSearch}
          onChange={e => setAgentSearch(e.target.value)}
          placeholder="Search agent..."
          style={{ padding:'6px 10px', borderRadius:6, border:'0.5px solid var(--border)', background:'var(--card-bg)', color:'var(--text)', fontSize:12, width:220, outline:'none' }}
        />
        {agentSearch && (
          <button onClick={() => setAgentSearch('')} style={{ fontSize:11, color:'var(--red)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>Clear</button>
        )}
        <span style={{ fontSize:11, color:'var(--text-muted)' }}>
          {agentSearch ? `${agentTotals.length} of ${allAgents.length} agents` : `${allAgents.length} agents`}
        </span>
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ borderBottom:'1px solid var(--border)' }}>
              <th style={{ textAlign:'left', padding:'8px 10px', fontWeight:500, color:'var(--text-muted)', fontSize:11, position:'sticky', left:0, background:'var(--card-bg)' }}>Agent</th>
              {periods.map(p => (
                <th key={p} style={{ textAlign:'right', padding:'8px 8px', fontWeight:500, color:'var(--text-muted)', fontSize:11, whiteSpace:'nowrap' }}>{periodLabel(p)}</th>
              ))}
              <th style={{ textAlign:'right', padding:'8px 10px', fontWeight:600, color:'var(--text)', fontSize:11 }}>Total</th>
              <th style={{ width:100, padding:'8px 10px' }}></th>
            </tr>
          </thead>
          <tbody>
            {agentTotals.map(({ agent, total }) => (
              <tr key={agent} style={{ borderBottom:'0.5px solid var(--border)' }}>
                <td style={{ padding:'8px 10px', position:'sticky', left:0, background:'var(--card-bg)' }}>
                  <button onClick={() => setSelectedAgent(agent)} style={{ background:'none', border:'none', cursor:'pointer', fontWeight:500, color:'var(--accent-dark)', fontSize:12, textAlign:'left', padding:0 }}>
                    {agent}
                  </button>
                </td>
                {periods.map(p => {
                  const val = pivot[agent]?.[p] || 0;
                  return (
                    <td key={p} style={{ padding:'8px 8px', textAlign:'right', color: val < 0 ? 'var(--red)' : val === 0 ? 'var(--text-muted)' : 'var(--text)', fontSize:12 }}>
                      {val !== 0 ? fmt(val) : '—'}
                    </td>
                  );
                })}
                <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:600, color: total < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(total)}</td>
                <td style={{ padding:'8px 10px' }}><MiniBar value={total} max={maxTotal} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop:'1px solid var(--border)', background:'var(--bg-subtle)' }}>
              <td style={{ padding:'8px 10px', fontWeight:600, fontSize:12 }}>Total</td>
              {periods.map(p => {
                const total = records.filter(r => r.payment_period === p).reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);
                return <td key={p} style={{ padding:'8px 8px', textAlign:'right', fontWeight:600, fontSize:12, color: total < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(total)}</td>;
              })}
              <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, fontSize:12, color:'var(--green)' }}>
                {fmt(records.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0))}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          year={selectedYear}
          records={records}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
function NBvRenewals({ records }) {
  const [selectedPeriod, setSelectedPeriod] = React.useState(null);
  const [filterType, setFilterType] = React.useState(null);
  const periods = [...new Set(records.map(r => r.payment_period))].filter(Boolean).sort();

  const data = periods.map(p => {
    const recs = records.filter(r => r.payment_period === p);
    const nb = recs.filter(r => r.classification === 'New Business').reduce((s, r) => s + Math.max(0, parseFloat(r.commission) || 0), 0);
    const ren = recs.filter(r => r.classification === 'Renewal').reduce((s, r) => s + Math.max(0, parseFloat(r.commission) || 0), 0);
    const cb = recs.filter(r => r.classification === 'Chargeback' || parseFloat(r.commission) < 0).reduce((s, r) => s + Math.abs(parseFloat(r.commission) || 0), 0);
    return { period: p, 'New Business': nb, 'Renewal': ren, 'Chargeback': cb };
  });

  // Records for selected period drill-down
  const drillRecords = selectedPeriod ? records.filter(r => {
    if (r.payment_period !== selectedPeriod) return false;
    if (!filterType) return true;
    if (filterType === 'Chargeback') return parseFloat(r.commission) < 0;
    return r.classification === filterType;
  }).sort((a,b) => Math.abs(parseFloat(b.commission)||0) - Math.abs(parseFloat(a.commission)||0)) : [];

  function exportCSV() {
    const header = ['Period', 'New Business', 'Renewal', 'Chargeback', 'Net'];
    const rows = data.map(d => [periodLabel(d.period), d['New Business'].toFixed(2), d['Renewal'].toFixed(2), d['Chargeback'].toFixed(2), (d['New Business'] + d['Renewal'] - d['Chargeback']).toFixed(2)]);
    downloadCSV('NB_vs_Renewals_Trend.csv', [header, ...rows]);
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ display:'flex', gap:16 }}>
          {[['New Business','#C9A96E'],['Renewal','#4A7C59'],['Chargeback','#C0392B']].map(([label, color]) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
              <div style={{ width:10, height:10, background:color, borderRadius:2 }} />
              <span style={{ color:'var(--text-muted)' }}>{label}</span>
            </div>
          ))}
        </div>
        <button onClick={exportCSV} style={{ background:'none', border:'0.5px solid var(--border)', borderRadius:6, padding:'5px 14px', fontSize:12, cursor:'pointer', color:'var(--text)' }}>↓ Export CSV</button>
      </div>
      <TrendChart data={data} keys={['New Business','Renewal','Chargeback']} colors={['#C9A96E','#4A7C59','#C0392B']} height={200} />
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, marginTop:16 }}>
        <thead>
          <tr style={{ borderBottom:'1px solid var(--border)' }}>
            {['Period','New Business','Renewal','Chargeback','Net'].map(h => (
              <th key={h} style={{ textAlign: h==='Period'?'left':'right', padding:'7px 10px', fontWeight:500, color:'var(--text-muted)', fontSize:11 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(d => {
            const net = d['New Business'] + d['Renewal'] - d['Chargeback'];
            const isSelected = selectedPeriod === d.period;
            return (
              <React.Fragment key={d.period}>
                <tr onClick={() => { setSelectedPeriod(isSelected ? null : d.period); setFilterType(null); }}
                  style={{ borderBottom:'0.5px solid var(--border)', cursor:'pointer', background: isSelected ? 'rgba(201,169,110,0.08)' : 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.background = isSelected ? 'rgba(201,169,110,0.08)' : 'var(--bg-subtle)'}
                  onMouseLeave={e => e.currentTarget.style.background = isSelected ? 'rgba(201,169,110,0.08)' : 'transparent'}>
                  <td style={{ padding:'7px 10px', fontWeight:500 }}>{periodLabel(d.period)} {isSelected ? '▲' : '▼'}</td>
                  <td onClick={e=>{e.stopPropagation();setSelectedPeriod(d.period);setFilterType('New Business');}} style={{ padding:'7px 10px', textAlign:'right', color:'#C9A96E', cursor:'zoom-in' }}>{fmt(d['New Business'])}</td>
                  <td onClick={e=>{e.stopPropagation();setSelectedPeriod(d.period);setFilterType('Renewal');}} style={{ padding:'7px 10px', textAlign:'right', color:'#4A7C59', cursor:'zoom-in' }}>{fmt(d['Renewal'])}</td>
                  <td onClick={e=>{e.stopPropagation();setSelectedPeriod(d.period);setFilterType('Chargeback');}} style={{ padding:'7px 10px', textAlign:'right', color:'var(--red)', cursor:'zoom-in' }}>{d['Chargeback'] > 0 ? fmt(d['Chargeback']) : '—'}</td>
                  <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:600, color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(net)}</td>
                </tr>
                {isSelected && (
                  <tr>
                    <td colSpan={5} style={{ padding:0, background:'var(--bg-subtle)' }}>
                      <div style={{ padding:'10px 14px' }}>
                        <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                          {[null,'New Business','Renewal','Chargeback'].map(t => (
                            <button key={t||'all'} onClick={() => setFilterType(t)} style={{ padding:'3px 10px', borderRadius:5, fontSize:11, cursor:'pointer', fontWeight:500, border: filterType===t?'none':'0.5px solid var(--border)', background: filterType===t?'var(--accent)':'none', color: filterType===t?'var(--sidebar-bg)':'var(--text)' }}>
                              {t || 'All'}
                            </button>
                          ))}
                          <span style={{ marginLeft:'auto', fontSize:11, color:'var(--text-muted)', alignSelf:'center' }}>{drillRecords.length} records</span>
                        </div>
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                          <thead><tr style={{ borderBottom:'0.5px solid var(--border)' }}>
                            {['Agent','Client','Carrier','Policy #','Type','Commission'].map(h=>(
                              <th key={h} style={{ textAlign:h==='Commission'?'right':'left', padding:'5px 8px', fontWeight:500, color:'var(--text-muted)' }}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {drillRecords.slice(0,50).map((r,i)=>(
                              <tr key={i} style={{ borderBottom:'0.5px solid var(--border)' }}>
                                <td style={{ padding:'5px 8px' }}>{r.agent_name}</td>
                                <td style={{ padding:'5px 8px', fontWeight:500 }}>{r.client_full_name}</td>
                                <td style={{ padding:'5px 8px', color:'var(--text-muted)' }}>{r.carrier}</td>
                                <td style={{ padding:'5px 8px', color:'var(--accent-dark)' }}>{r.policy_number||'—'}</td>
                                <td style={{ padding:'5px 8px' }}>{r.classification}</td>
                                <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:600, color:parseFloat(r.commission)<0?'var(--red)':'var(--green)' }}>{fmt(r.commission)}</td>
                              </tr>
                            ))}
                            {drillRecords.length > 50 && <tr><td colSpan={6} style={{ padding:'5px 8px', color:'var(--text-muted)', fontSize:11 }}>+ {drillRecords.length - 50} more records</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Report 3: Year-over-Year ────────────────────────────────────────────────
function YearOverYear({ records }) {
  const [selected, setSelected] = React.useState(null); // { year, month }
  const years = [...new Set(records.map(r => String(r.payment_period || '').slice(0, 4)))].filter(y => y.match(/^\d{4}$/) && parseInt(y) >= 2020).sort();

  const byYearMonth = {};
  for (const r of records) {
    const p = String(r.payment_period || '');
    if (!p.match(/^\d{6}$/)) continue;
    const year = p.slice(0, 4);
    const month = parseInt(p.slice(4, 6)) - 1;
    if (!byYearMonth[year]) byYearMonth[year] = Array(12).fill(0);
    byYearMonth[year][month] += parseFloat(r.commission) || 0;
  }

  const drillRecords = selected ? records.filter(r => {
    const p = String(r.payment_period || '');
    return p === `${selected.year}${String(selected.month + 1).padStart(2,'0')}`;
  }).sort((a,b) => Math.abs(parseFloat(b.commission)||0) - Math.abs(parseFloat(a.commission)||0)) : [];

  const colors = ['#C9A96E', '#4A7C59', '#5B8DB8', '#C0392B'];

  function exportCSV() {
    const header = ['Month', ...years];
    const rows = MONTHS.map((m, i) => [m, ...years.map(y => (byYearMonth[y]?.[i] || 0).toFixed(2))]);
    const totals = ['Total', ...years.map(y => (byYearMonth[y] || []).reduce((s, v) => s + v, 0).toFixed(2))];
    downloadCSV('Year_Over_Year.csv', [header, ...rows, totals]);
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ display:'flex', gap:16 }}>
          {years.map((y, i) => (
            <div key={y} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
              <div style={{ width:10, height:10, background:colors[i % colors.length], borderRadius:2 }} />
              <span style={{ color:'var(--text-muted)' }}>{y}</span>
            </div>
          ))}
        </div>
        <button onClick={exportCSV} style={{ background:'none', border:'0.5px solid var(--border)', borderRadius:6, padding:'5px 14px', fontSize:12, cursor:'pointer', color:'var(--text)' }}>↓ Export CSV</button>
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr style={{ borderBottom:'1px solid var(--border)' }}>
            <th style={{ textAlign:'left', padding:'7px 10px', fontWeight:500, color:'var(--text-muted)', fontSize:11 }}>Month</th>
            {years.map((y, i) => (
              <th key={y} style={{ textAlign:'right', padding:'7px 10px', fontWeight:500, color:colors[i % colors.length], fontSize:11 }}>{y}</th>
            ))}
            {years.length > 1 && <th style={{ textAlign:'right', padding:'7px 10px', fontWeight:500, color:'var(--text-muted)', fontSize:11 }}>Change</th>}
          </tr>
        </thead>
        <tbody>
          {MONTHS.map((m, mi) => {
            const vals = years.map(y => byYearMonth[y]?.[mi] || 0);
            const change = years.length >= 2 ? vals[vals.length - 1] - vals[vals.length - 2] : null;
            return (
              <React.Fragment key={m}>
                <tr style={{ borderBottom:'0.5px solid var(--border)' }}>
                  <td style={{ padding:'7px 10px', fontWeight:500 }}>{m}</td>
                  {vals.map((v, j) => {
                    const isSelected = selected?.year === years[j] && selected?.month === mi;
                    return (
                      <td key={j} onClick={() => v !== 0 && setSelected(isSelected ? null : { year: years[j], month: mi })}
                        style={{ padding:'7px 10px', textAlign:'right', color: v < 0 ? 'var(--red)' : v === 0 ? 'var(--text-muted)' : colors[j % colors.length], cursor: v !== 0 ? 'pointer' : 'default', fontWeight: isSelected ? 700 : 400, background: isSelected ? 'rgba(201,169,110,0.08)' : 'transparent', borderRadius:4 }}>
                        {v !== 0 ? fmt(v) : '—'}
                      </td>
                    );
                  })}
                  {change !== null && (
                    <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:500, color: change >= 0 ? 'var(--green)' : 'var(--red)', fontSize:11 }}>
                      {change >= 0 ? '+' : ''}{fmt(change)}
                    </td>
                  )}
                </tr>
                {selected?.month === mi && drillRecords.length > 0 && (
                  <tr>
                    <td colSpan={years.length + 2} style={{ padding:0, background:'var(--bg-subtle)' }}>
                      <div style={{ padding:'10px 14px' }}>
                        <div style={{ fontSize:11, fontWeight:600, marginBottom:8, color:'var(--accent-dark)' }}>
                          {m} {selected.year} · {drillRecords.length} records · {fmt(drillRecords.reduce((s,r)=>s+(parseFloat(r.commission)||0),0))}
                        </div>
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                          <thead><tr style={{ borderBottom:'0.5px solid var(--border)' }}>
                            {['Agent','Client','Carrier','Policy #','Type','Commission'].map(h=>(
                              <th key={h} style={{ textAlign:h==='Commission'?'right':'left', padding:'5px 8px', fontWeight:500, color:'var(--text-muted)' }}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {drillRecords.slice(0,50).map((r,i)=>(
                              <tr key={i} style={{ borderBottom:'0.5px solid var(--border)' }}>
                                <td style={{ padding:'5px 8px' }}>{r.agent_name}</td>
                                <td style={{ padding:'5px 8px', fontWeight:500 }}>{r.client_full_name}</td>
                                <td style={{ padding:'5px 8px', color:'var(--text-muted)' }}>{r.carrier}</td>
                                <td style={{ padding:'5px 8px', color:'var(--accent-dark)' }}>{r.policy_number||'—'}</td>
                                <td style={{ padding:'5px 8px' }}>{r.classification}</td>
                                <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:600, color:parseFloat(r.commission)<0?'var(--red)':'var(--green)' }}>{fmt(r.commission)}</td>
                              </tr>
                            ))}
                            {drillRecords.length > 50 && <tr><td colSpan={6} style={{ padding:'5px 8px', color:'var(--text-muted)' }}>+ {drillRecords.length - 50} more records</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop:'1px solid var(--border)', background:'var(--bg-subtle)' }}>
            <td style={{ padding:'8px 10px', fontWeight:600 }}>Total</td>
            {years.map((y, i) => {
              const total = (byYearMonth[y] || []).reduce((s, v) => s + v, 0);
              return <td key={y} style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, color: total < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(total)}</td>;
            })}
            {years.length > 1 && (() => {
              const last = (byYearMonth[years[years.length-1]] || []).reduce((s,v)=>s+v,0);
              const prev = (byYearMonth[years[years.length-2]] || []).reduce((s,v)=>s+v,0);
              const diff = last - prev;
              return <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, color: diff >= 0 ? 'var(--green)' : 'var(--red)' }}>{diff >= 0?'+':''}{fmt(diff)}</td>;
            })()}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
// ─── Report 4: Chargeback Rate by Agent ─────────────────────────────────────
function ChargebackReport({ records }) {
  const [selectedAgent, setSelectedAgent] = React.useState(null);
  const agents = [...new Set(records.map(r => r.agent_name))].sort();

  const data = agents.map(agent => {
    const recs = records.filter(r => r.agent_name === agent);
    const gross = recs.filter(r => parseFloat(r.commission) > 0).reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);
    const cb = recs.filter(r => parseFloat(r.commission) < 0).reduce((s, r) => s + Math.abs(parseFloat(r.commission) || 0), 0);
    const cbCount = recs.filter(r => parseFloat(r.commission) < 0).length;
    const cbRate = gross > 0 ? (cb / gross) * 100 : 0;
    const cbRecords = recs.filter(r => parseFloat(r.commission) < 0).sort((a,b) => parseFloat(a.commission) - parseFloat(b.commission));
    return { agent, gross, cb, cbCount, cbRate, net: gross - cb, count: recs.length, cbRecords };
  }).filter(d => d.count > 0).sort((a, b) => b.cbRate - a.cbRate);

  const maxCbRate = Math.max(...data.map(d => d.cbRate), 1);

  function exportCSV() {
    const header = ['Agent', 'Gross Commission', 'Chargebacks', 'CB Count', 'CB Rate %', 'Net'];
    const rows = data.map(d => [d.agent, d.gross.toFixed(2), d.cb.toFixed(2), d.cbCount, d.cbRate.toFixed(1)+'%', d.net.toFixed(2)]);
    downloadCSV('Chargeback_Report.csv', [header, ...rows]);
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:10 }}>
        <button onClick={exportCSV} style={{ background:'none', border:'0.5px solid var(--border)', borderRadius:6, padding:'5px 14px', fontSize:12, cursor:'pointer', color:'var(--text)' }}>↓ Export CSV</button>
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr style={{ borderBottom:'1px solid var(--border)' }}>
            {['#','Agent','Gross','Chargebacks','CB Rate','Net',''].map((h,i) => (
              <th key={i} style={{ textAlign: i<=1?'left':'right', padding:'7px 10px', fontWeight:500, color:'var(--text-muted)', fontSize:11 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <React.Fragment key={d.agent}>
              <tr onClick={() => setSelectedAgent(selectedAgent === d.agent ? null : d.agent)}
                style={{ borderBottom:'0.5px solid var(--border)', background: selectedAgent === d.agent ? 'rgba(201,169,110,0.08)' : d.cbRate > 20 ? 'rgba(192,57,43,0.04)' : 'transparent', cursor: d.cbCount > 0 ? 'pointer' : 'default' }}>
                <td style={{ padding:'7px 10px', color:'var(--text-muted)', fontSize:11 }}>{i+1}</td>
                <td style={{ padding:'7px 10px', fontWeight:600, color:'var(--accent-dark)' }}>{d.agent} {d.cbCount > 0 ? (selectedAgent===d.agent?'▲':'▼') : ''}</td>
                <td style={{ padding:'7px 10px', textAlign:'right', color:'var(--green)' }}>{fmt(d.gross)}</td>
                <td style={{ padding:'7px 10px', textAlign:'right', color: d.cb > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                  {d.cb > 0 ? `-${fmt(d.cb)}` : '—'}
                  {d.cbCount > 0 && <span style={{ fontSize:10, color:'var(--text-muted)', marginLeft:4 }}>({d.cbCount}x)</span>}
                </td>
                <td style={{ padding:'7px 10px', textAlign:'right' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:8 }}>
                    <span style={{ fontWeight:600, color: d.cbRate > 20 ? 'var(--red)' : d.cbRate > 10 ? '#E67E22' : 'var(--green)', fontSize:12 }}>{pct(d.cbRate)}</span>
                    <div style={{ width:60, height:5, background:'var(--border)', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ width:`${(d.cbRate/maxCbRate)*100}%`, height:'100%', background: d.cbRate > 20 ? 'var(--red)' : d.cbRate > 10 ? '#E67E22' : 'var(--green)', borderRadius:3 }} />
                    </div>
                  </div>
                </td>
                <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:600, color: d.net >= 0 ? 'var(--text)' : 'var(--red)' }}>{fmt(d.net)}</td>
                <td style={{ padding:'7px 10px' }}>
                  {d.cbRate > 20 && <span style={{ fontSize:10, background:'rgba(192,57,43,0.12)', color:'var(--red)', borderRadius:4, padding:'2px 6px', fontWeight:500 }}>⚠ High</span>}
                </td>
              </tr>
              {selectedAgent === d.agent && d.cbRecords.length > 0 && (
                <tr>
                  <td colSpan={7} style={{ padding:0, background:'var(--bg-subtle)' }}>
                    <div style={{ padding:'10px 14px' }}>
                      <div style={{ fontSize:11, fontWeight:600, marginBottom:8, color:'var(--red)' }}>
                        Chargeback records · {d.cbRecords.length} total · -{fmt(d.cb)}
                      </div>
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                        <thead><tr style={{ borderBottom:'0.5px solid var(--border)' }}>
                          {['Period','Client','Carrier','Policy #','Amount'].map(h=>(
                            <th key={h} style={{ textAlign:h==='Amount'?'right':'left', padding:'5px 8px', fontWeight:500, color:'var(--text-muted)' }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {d.cbRecords.map((r,j)=>(
                            <tr key={j} style={{ borderBottom:'0.5px solid var(--border)' }}>
                              <td style={{ padding:'5px 8px', color:'var(--text-muted)' }}>{periodLabel(r.payment_period)}</td>
                              <td style={{ padding:'5px 8px', fontWeight:500 }}>{r.client_full_name}</td>
                              <td style={{ padding:'5px 8px', color:'var(--text-muted)' }}>{r.carrier}</td>
                              <td style={{ padding:'5px 8px', color:'var(--accent-dark)' }}>{r.policy_number||'—'}</td>
                              <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:600, color:'var(--red)' }}>{fmt(r.commission)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Reports({ user }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeReport, setActiveReport] = useState('monthly');
  const [yearFilter, setYearFilter] = useState('all');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch('/records?limit=5000');
        setRecords(data.records || []);
      } catch(e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, [user.agency]);

  const years = [...new Set(records.map(r => String(r.payment_period || '').slice(0,4)).filter(y => y.match(/^\d{4}$/) && parseInt(y) >= 2020))].sort().reverse();
  const filtered = yearFilter === 'all' ? records.filter(r => String(r.payment_period||'').match(/^\d{6}$/) && parseInt(String(r.payment_period).slice(0,4)) >= 2020) : records.filter(r => String(r.payment_period || '').startsWith(yearFilter));

  const reports = [
    { id: 'monthly', label: 'Monthly Summary' },
    { id: 'nbvren', label: 'NB vs Renewals' },
    { id: 'yoy', label: 'Year-over-Year' },
    { id: 'chargeback', label: 'Chargeback Rate' },
  ];

  const tabStyle = id => ({
    padding:'7px 14px', border:'none', background:'none', fontSize:13, cursor:'pointer',
    borderBottom: activeReport===id ? '2px solid var(--accent)' : '2px solid transparent',
    color: activeReport===id ? 'var(--accent-dark)' : 'var(--text-muted)',
    fontWeight: activeReport===id ? 500 : 400, marginBottom:-1, whiteSpace:'nowrap'
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Reports</div>
        <div className="page-sub">Commission analytics and performance reporting</div>
      </div>
      <div className="page-body">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--border)', marginBottom:16 }}>
          <div style={{ display:'flex', gap:0 }}>
            {reports.map(r => <button key={r.id} style={tabStyle(r.id)} onClick={() => setActiveReport(r.id)}>{r.label}</button>)}
          </div>
          {activeReport !== 'yoy' && activeReport !== 'monthly' && (
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)}
              style={{ fontSize:12, padding:'4px 8px', borderRadius:6, border:'0.5px solid var(--border)', background:'var(--card-bg)', color:'var(--text)', cursor:'pointer', marginBottom:4 }}>
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>

        {loading ? (
          <div className="card"><div className="empty-state"><div className="empty-title" style={{color:'var(--text-muted)'}}>Loading...</div></div></div>
        ) : !records.length ? (
          <div className="card"><div className="empty-state"><div className="empty-icon">📊</div><div className="empty-title">No data yet</div><div className="empty-sub">Upload commission statements to see reports</div></div></div>
        ) : (
          <div className="card" style={{ padding:'16px 18px' }}>
            {activeReport === 'monthly' && <MonthlySummary records={filtered} />}
            {activeReport === 'nbvren' && <NBvRenewals records={filtered} />}
            {activeReport === 'yoy' && <YearOverYear records={records} />}
            {activeReport === 'chargeback' && <ChargebackReport records={filtered} />}
          </div>
        )}
      </div>
    </div>
  );
}

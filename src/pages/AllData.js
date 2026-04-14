import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AllData({ user, initialFilters = {} }) {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ agents: [], carriers: [], periods: [] });
  const [agent, setAgent] = useState(initialFilters.agent || '');
  const [carrier, setCarrier] = useState(initialFilters.carrier || '');
  const [period, setPeriod] = useState(initialFilters.period || '');
  const [classification, setClassification] = useState(initialFilters.classification || '');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const PAGE_SIZE = 100;

  useEffect(() => {
    apiFetch('/records/filters').then(d => setFilters(d)).catch(console.error);
  }, []);

  useEffect(() => {
    if (initialFilters.agent !== undefined) setAgent(initialFilters.agent || '');
    if (initialFilters.carrier !== undefined) setCarrier(initialFilters.carrier || '');
    if (initialFilters.period !== undefined) setPeriod(initialFilters.period || '');
    if (initialFilters.classification !== undefined) setClassification(initialFilters.classification || '');
    setPage(0);
  }, [initialFilters.agent, initialFilters.carrier, initialFilters.period, initialFilters.classification]);

  const loadRecords = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset });
      if (agent) params.set('agent', agent);
      if (carrier) params.set('carrier', carrier);
      if (period) params.set('period', period);
      if (classification) params.set('classification', classification);
      const data = await apiFetch(`/records?${params}`);
      setRecords(data.records || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [agent, carrier, period, classification]);

  useEffect(() => { setPage(0); loadRecords(0); }, [loadRecords]);

  function handlePage(dir) {
    const next = page + dir;
    setPage(next);
    loadRecords(next * PAGE_SIZE);
  }

  async function deleteRecord(id) {
    setDeleting(id);
    try {
      await apiFetch(`/records/${id}`, { method: 'DELETE' });
      setRecords(prev => prev.filter(r => r.id !== id));
      setTotal(prev => prev - 1);
      setConfirmDelete(null);
    } catch (e) { console.error(e); }
    finally { setDeleting(null); }
  }

  const agentTotals = records.reduce((acc, r) => {
    const name = r.agent_name || 'Unknown';
    if (!acc[name]) acc[name] = 0;
    acc[name] += parseFloat(r.commission) || 0;
    return acc;
  }, {});
  const grandTotal = records.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);

  function exportCSV() {
    const headers = ['Agent', 'Carrier', 'Client', 'Effective Date', 'Premium', 'Commission', 'Type', 'Period', 'Policy Number'];
    const rows = records.map(r => [r.agent_name, r.carrier, r.client_full_name, r.effective_date, r.premium, r.commission, r.classification, r.payment_period, r.policy_number]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commissions_${agent||'all'}_${carrier||'all'}_${period||'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const classificationTypes = ['Agent Commission', 'Agency Override', 'Chargeback', 'Override', 'Renewal'];
  const hasFilters = agent || carrier || period || classification;

  return (
    <>
      <div className="page-header">
        <div className="page-title">All Data</div>
        <div className="page-sub">All commission records across all carriers and periods</div>
      </div>
      <div className="page-body">

        {/* Confirm delete modal */}
        {confirmDelete && (
          <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <div style={{background:'var(--bg)',borderRadius:12,padding:24,width:360,boxShadow:'0 8px 32px rgba(0,0,0,0.2)'}}>
              <div style={{fontWeight:600,fontSize:15,marginBottom:8}}>Delete this record?</div>
              <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:6}}><strong>{confirmDelete.client_full_name}</strong></div>
              <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:16}}>{confirmDelete.carrier} · {confirmDelete.commission < 0 ? '' : '+'}{fmt(confirmDelete.commission)} · {confirmDelete.payment_period}</div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button onClick={()=>setConfirmDelete(null)} className="btn" style={{fontSize:13}}>Cancel</button>
                <button onClick={()=>deleteRecord(confirmDelete.id)} className="btn" style={{background:'#E24B4A',color:'#fff',border:'none',fontSize:13}} disabled={deleting===confirmDelete.id}>
                  {deleting===confirmDelete.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="filters" style={{marginBottom:12}}>
          <select className="filter-select" value={agent} onChange={e=>{setAgent(e.target.value);setPage(0);}}>
            <option value="">All agents</option>
            {filters.agents.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
          <select className="filter-select" value={carrier} onChange={e=>{setCarrier(e.target.value);setPage(0);}}>
            <option value="">All carriers</option>
            {filters.carriers.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
          <select className="filter-select" value={period} onChange={e=>{setPeriod(e.target.value);setPage(0);}}>
            <option value="">All periods</option>
            {filters.periods.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
          <select className="filter-select" value={classification} onChange={e=>{setClassification(e.target.value);setPage(0);}}>
            <option value="">All types</option>
            {classificationTypes.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
          {hasFilters && (
            <button className="btn" onClick={()=>{setAgent('');setCarrier('');setPeriod('');setClassification('');setPage(0);}} style={{fontSize:11,color:'var(--red)'}}>
              Clear filters
            </button>
          )}
          <span className="row-count">{total.toLocaleString()} records</span>
          <button className="btn btn-primary" onClick={exportCSV} disabled={!records.length} style={{marginLeft:'auto'}}>↓ Export CSV</button>
        </div>

        {hasFilters && (
          <div style={{background:'#E6F1FB',border:'1px solid #B5D4F4',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#0C447C',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span style={{fontWeight:600}}>Filtered view:</span>
            {agent && <span style={{background:'#185FA5',color:'#fff',borderRadius:4,padding:'2px 8px'}}>{agent}</span>}
            {carrier && <span style={{background:'#185FA5',color:'#fff',borderRadius:4,padding:'2px 8px'}}>{carrier}</span>}
            {period && <span style={{background:'#185FA5',color:'#fff',borderRadius:4,padding:'2px 8px'}}>{period}</span>}
            {classification && <span style={{background:'#185FA5',color:'#fff',borderRadius:4,padding:'2px 8px'}}>{classification}</span>}
          </div>
        )}

        {records.length > 0 && (
          <div className="card" style={{marginBottom:12,padding:'10px 14px'}}>
            <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8}}>Totals for current view</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:'6px 20px',alignItems:'center'}}>
              {Object.entries(agentTotals).sort((a,b)=>b[1]-a[1]).map(([name,tot])=>(
                <div key={name} style={{display:'flex',alignItems:'center',gap:6,fontSize:13}}>
                  <span style={{color:'var(--text-muted)'}}>{name}</span>
                  <span style={{fontWeight:600,color:tot<0?'var(--red)':'var(--green)'}}>{fmt(tot)}</span>
                </div>
              ))}
              <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,fontSize:13,borderLeft:'1px solid var(--border)',paddingLeft:16}}>
                <span style={{color:'var(--text-muted)'}}>Grand total</span>
                <span style={{fontWeight:700,fontSize:15,color:grandTotal<0?'var(--red)':'var(--blue)'}}>{fmt(grandTotal)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{padding:0}}>
          {loading ? (
            <div className="empty-state"><div className="empty-title" style={{color:'var(--text-muted)'}}>Loading...</div></div>
          ) : records.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <div className="empty-title">No records found</div>
              <div className="empty-sub">Try adjusting your filters</div>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Agent</th>
                      <th>Carrier</th>
                      <th>Client</th>
                      <th>Effective</th>
                      <th>Premium</th>
                      <th>Commission</th>
                      <th>Type</th>
                      <th>Period</th>
                      {user.role === 'admin' && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => (
                      <tr key={r.id}>
                        <td style={{color:'var(--text-muted)',fontSize:11}}>{page * PAGE_SIZE + i + 1}</td>
                        <td style={{fontWeight:500}}>{r.agent_name}</td>
                        <td style={{fontSize:12}}>{r.carrier}</td>
                        <td>{r.client_full_name || '—'}</td>
                        <td style={{fontSize:12,color:'var(--text-muted)'}}>{r.effective_date || '—'}</td>
                        <td>{r.premium ? fmt(r.premium) : '—'}</td>
                        <td style={{fontWeight:600,color:parseFloat(r.commission)<0?'var(--red)':'inherit'}}>{fmt(r.commission)}</td>
                        <td>
                          <span className={`badge ${r.classification==='Agent Commission'?'badge-green':r.classification==='Agency Override'?'badge-blue':r.classification==='Chargeback'?'badge-red':'badge-gray'}`}>
                            {r.classification||'—'}
                          </span>
                        </td>
                        <td style={{fontSize:11,color:'var(--text-muted)'}}>{r.payment_period||'—'}</td>
                        {user.role === 'admin' && (
                          <td>
                            <button
                              onClick={() => setConfirmDelete(r)}
                              style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:14,padding:'2px 6px',borderRadius:4,lineHeight:1}}
                              title="Delete record"
                            >
                              ✕
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'var(--gray-50)',fontWeight:600}}>
                      <td colSpan={6} style={{padding:'10px 12px',fontSize:13}}>Page total ({records.length} records)</td>
                      <td style={{padding:'10px 12px',fontSize:13,color:grandTotal<0?'var(--red)':'var(--green)'}}>{fmt(grandTotal)}</td>
                      <td colSpan={user.role==='admin'?3:2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {total > PAGE_SIZE && (
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderTop:'1px solid var(--border)',fontSize:13}}>
                  <span style={{color:'var(--text-muted)'}}>Showing {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,total)} of {total.toLocaleString()}</span>
                  <div style={{display:'flex',gap:6}}>
                    <button className="btn" onClick={()=>handlePage(-1)} disabled={page===0}>← Prev</button>
                    <button className="btn" onClick={()=>handlePage(1)} disabled={(page+1)*PAGE_SIZE>=total}>Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

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
  const [selected, setSelected] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // null | 'single' | 'selected' | 'all'
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
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
      setSelected(new Set());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [agent, carrier, period, classification]);

  useEffect(() => { setPage(0); loadRecords(0); }, [loadRecords]);

  function handlePage(dir) {
    const next = page + dir;
    setPage(next);
    loadRecords(next * PAGE_SIZE);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === records.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(records.map(r => r.id)));
    }
  }

  async function executeDelete() {
    setDeleting(true);
    try {
      if (confirmDelete === 'all') {
        await apiFetch('/records/bulk-delete', { method: 'POST', body: JSON.stringify({ deleteAll: true }) });
        setRecords([]);
        setTotal(0);
        setSelected(new Set());
      } else if (confirmDelete === 'selected') {
        await apiFetch('/records/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
        setRecords(prev => prev.filter(r => !selected.has(r.id)));
        setTotal(prev => prev - selected.size);
        setSelected(new Set());
      } else if (confirmDelete === 'single') {
        await apiFetch(`/records/${deleteTarget.id}`, { method: 'DELETE' });
        setRecords(prev => prev.filter(r => r.id !== deleteTarget.id));
        setTotal(prev => prev - 1);
      }
      setConfirmDelete(null);
      setDeleteTarget(null);
    } catch (e) { console.error(e); }
    finally { setDeleting(false); }
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
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `commissions_export.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const classificationTypes = ['Agent Commission', 'Agency Override', 'Chargeback', 'Override', 'Renewal'];
  const hasFilters = agent || carrier || period || classification;
  const allPageSelected = records.length > 0 && selected.size === records.length;

  const deleteModalText = {
    all: { title: 'Delete EVERYTHING?', sub: `This will permanently delete all ${total.toLocaleString()} records and all uploads. This cannot be undone.`, btn: 'Yes, delete everything', color: '#E24B4A' },
    selected: { title: `Delete ${selected.size} selected records?`, sub: 'These records will be permanently deleted.', btn: `Delete ${selected.size} records`, color: '#E24B4A' },
    single: { title: 'Delete this record?', sub: deleteTarget ? `${deleteTarget.client_full_name} · ${deleteTarget.carrier} · ${fmt(deleteTarget.commission)}` : '', btn: 'Delete', color: '#E24B4A' }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">All Data</div>
        <div className="page-sub">All commission records across all carriers and periods</div>
      </div>
      <div className="page-body">

        {/* Confirm delete modal */}
        {confirmDelete && (
          <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <div style={{background:'#ffffff',borderRadius:12,padding:28,width:400,boxShadow:'0 8px 40px rgba(0,0,0,0.25)',border:'1px solid #e0e0e0'}}>
              <div style={{fontWeight:700,fontSize:16,marginBottom:8,color: confirmDelete==='all'?'#E24B4A':'var(--text)'}}>
                {deleteModalText[confirmDelete]?.title}
              </div>
              <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:20}}>
                {deleteModalText[confirmDelete]?.sub}
              </div>
              {confirmDelete === 'all' && (
                <div style={{background:'#FCEBEB',border:'1px solid #F7C1C1',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#A32D2D'}}>
                  ⚠️ This will also delete all upload records and BOB data. You will need to re-upload all your statements from scratch.
                </div>
              )}
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button onClick={()=>{setConfirmDelete(null);setDeleteTarget(null);}} className="btn" style={{fontSize:13}} disabled={deleting}>
                  Cancel
                </button>
                <button onClick={executeDelete} style={{background:'#E24B4A',color:'#fff',border:'none',borderRadius:6,padding:'7px 16px',fontSize:13,fontWeight:600,cursor:'pointer'}} disabled={deleting}>
                  {deleting ? 'Deleting...' : deleteModalText[confirmDelete]?.btn}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters row */}
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
              Clear
            </button>
          )}
          <span className="row-count">{total.toLocaleString()} records</span>
          <div style={{display:'flex',gap:6,marginLeft:'auto'}}>
            <button className="btn" onClick={exportCSV} disabled={!records.length} style={{fontSize:12}}>↓ Export</button>
            {user.role === 'admin' && selected.size > 0 && (
              <button onClick={()=>setConfirmDelete('selected')} style={{background:'#E24B4A',color:'#fff',border:'none',borderRadius:6,padding:'6px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                Delete {selected.size} selected
              </button>
            )}
            {user.role === 'admin' && (
              <button onClick={()=>setConfirmDelete('all')} style={{background:'none',border:'1px solid #E24B4A',color:'#E24B4A',borderRadius:6,padding:'6px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                Reset all
              </button>
            )}
          </div>
        </div>

        {/* Active filter banner */}
        {hasFilters && (
          <div style={{background:'#E6F1FB',border:'1px solid #B5D4F4',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#0C447C',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span style={{fontWeight:600}}>Filtered:</span>
            {agent && <span style={{background:'#185FA5',color:'#fff',borderRadius:4,padding:'2px 8px'}}>{agent}</span>}
            {carrier && <span style={{background:'#185FA5',color:'#fff',borderRadius:4,padding:'2px 8px'}}>{carrier}</span>}
            {period && <span style={{background:'#185FA5',color:'#fff',borderRadius:4,padding:'2px 8px'}}>{period}</span>}
            {classification && <span style={{background:'#185FA5',color:'#fff',borderRadius:4,padding:'2px 8px'}}>{classification}</span>}
          </div>
        )}

        {/* Totals bar */}
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
              <div className="empty-sub">Try adjusting your filters or upload a statement</div>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {user.role === 'admin' && (
                        <th style={{width:36}}>
                          <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll}
                            style={{cursor:'pointer'}} title={allPageSelected ? 'Deselect all' : 'Select all on page'}/>
                        </th>
                      )}
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
                    {records.map((r, i) => {
                      const isSel = selected.has(r.id);
                      return (
                        <tr key={r.id} style={{background: isSel ? 'var(--blue-light)' : 'transparent'}}>
                          {user.role === 'admin' && (
                            <td>
                              <input type="checkbox" checked={isSel} onChange={()=>toggleSelect(r.id)} style={{cursor:'pointer'}}/>
                            </td>
                          )}
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
                              <button onClick={()=>{setDeleteTarget(r);setConfirmDelete('single');}}
                                style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:14,padding:'2px 6px',borderRadius:4}}
                                title="Delete">✕</button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'var(--gray-50)',fontWeight:600}}>
                      {user.role === 'admin' && <td></td>}
                      <td colSpan={6} style={{padding:'10px 12px',fontSize:13}}>Page total ({records.length})</td>
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

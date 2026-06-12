import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload } from '../api';
import { formatCarrier } from '../utils/formatCarrier';
import { formatDate, formatDateTime } from '../utils/dateFormat';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CARRIERS = ['UnitedHealthcare','Humana','Aetna','Devoted','Cigna','Florida Blue','Oscar Health','Molina','WellCare','Sunshine Health','Gold Kidney','NHP','BSI','Solis','Integrity'];
const STATUSES = ['','Termed','Deceased','Plan changed','Duplicate','Resolved'];

export default function BookOfBusiness({ user }) {
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [tab, setTab] = useState('all');
  const [filterCarrier, setFilterCarrier] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [buildStatus, setBuildStatus] = useState('');
  const [checkPeriod, setCheckPeriod] = useState('');
  const [uploadCarrier, setUploadCarrier] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmCarrierDelete, setConfirmCarrierDelete] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, filtersData] = await Promise.all([
        apiFetch('/bob/summary'),
        apiFetch('/records/filters')
      ]);
      setSummary(sum);
      setPeriods(filtersData.periods || []);
      setAgents(filtersData.agents || []);
      if (filtersData.periods?.length) setCheckPeriod(filtersData.periods[0]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const loadClients = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterCarrier) params.set('carrier', filterCarrier);
      if (filterAgent) params.set('agent', filterAgent);
      if (filterStatus) params.set('status', filterStatus);
      const data = await apiFetch(`/bob?${params}`);
      setClients(data);
    } catch (e) { console.error(e); }
  }, [tab, filterCarrier, filterAgent, filterStatus]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadClients(); }, [loadClients]);

  async function buildFromStatements() {
    setBuildStatus('building');
    try {
      const result = await apiFetch('/bob/build-from-statements', { method: 'POST' });
      setBuildStatus(`Added ${result.added} clients to your BOB from existing statements!`);
      loadData(); loadClients();
    } catch (e) { setBuildStatus('Error: ' + e.message); }
  }

  async function runRenewalCheck() {
    if (!checkPeriod) return;
    setLoading(true);
    try {
      const result = await apiFetch('/bob/check-renewals', { method: 'POST', body: JSON.stringify({ period: checkPeriod }) });
      setBuildStatus(`✓ Checked ${result.checkedClients} clients — ${result.missingCount} missing, ${result.recoveredCount} recovered.`);
      loadData(); loadClients();
    } catch (e) { setBuildStatus('Error: ' + e.message); }
    finally { setLoading(false); }
  }

  async function updateStatus(id, resolution) {
    try {
      const status = (resolution === 'Termed' || resolution === 'Deceased') ? 'inactive' : 'active';
      await apiFetch(`/bob/${id}`, { method: 'PATCH', body: JSON.stringify({ resolution, status }) });
      setClients(prev => prev.map(c => c.id === id ? { ...c, resolution, status } : c));
      loadData();
    } catch (e) { console.error(e); }
  }

  async function deleteClient(id) {
    setDeleting(id);
    try {
      await apiFetch(`/bob/${id}`, { method: 'DELETE' });
      setClients(prev => prev.filter(c => c.id !== id));
      setConfirmDelete(null);
      loadData();
    } catch (e) { console.error(e); }
    finally { setDeleting(null); }
  }

  async function deleteCarrier(carrier) {
    try {
      await apiFetch('/bob/bulk-delete', { method: 'POST', body: JSON.stringify({ carrier }) });
      setConfirmCarrierDelete(null);
      loadData(); loadClients();
    } catch (e) { console.error(e); }
  }

  async function bulkDelete() {
    if (!selectedIds.length) return;
    setBulkDeleting(true);
    try {
      await apiFetch('/bob/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: selectedIds }) });
      setSelectedIds([]);
      loadData(); loadClients();
    } catch (e) { console.error(e); }
    finally { setBulkDeleting(false); }
  }

  async function resetAndRebuild() {
    setConfirmReset(false);
    setBuildStatus('building');
    try {
      const result = await apiFetch('/bob/reset-and-rebuild', { method: 'POST' });
      setBuildStatus(`✓ Reset complete — removed duplicates, rebuilt ${result.added} clean clients.`);
      loadData(); loadClients();
    } catch (e) { setBuildStatus('Error: ' + e.message); }
  }

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleSelectAll() {
    if (selectedIds.length === filteredClients.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredClients.map(c => c.id));
    }
  }

  async function handleBOBUpload(e) {
    const file = e.target.files[0];
    if (!file || !uploadCarrier) return;
    setUploadStatus('Uploading...');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('carrier', uploadCarrier);
    try {
      const result = await apiUpload('/bob/upload', fd);
      setUploadStatus(`Done! Added ${result.added} new, updated ${result.updated} existing clients for ${result.carrier}`);
      loadData(); loadClients();
    } catch (err) { setUploadStatus('Error: ' + err.message); }
    e.target.value = '';
  }

  const [sortCol, setSortCol] = useState('client_full_name');
  const [sortDir, setSortDir] = useState('asc');

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  // Filter clients by search
  const filteredClients = search.trim()
    ? clients.filter(c =>
        c.client_full_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.agent_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.carrier?.toLowerCase().includes(search.toLowerCase())
      )
    : clients;

  const sortedClients = [...filteredClients].sort((a, b) => {
    const aVal = String(a[sortCol] || '').toLowerCase();
    const bVal = String(b[sortCol] || '').toLowerCase();
    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  const activeCount = clients.filter(c => c.status === 'active').length;
  const termedCount = clients.filter(c => c.status === 'inactive').length;

  const tabStyle = (id) => ({
    padding:'7px 14px', border:'none', background:'none', fontSize:13, cursor:'pointer',
    borderBottom: tab===id ? '2px solid var(--accent)' : '2px solid transparent',
    color: tab===id ? 'var(--accent)' : 'var(--text-muted)',
    fontWeight: tab===id ? 500 : 400, marginBottom:-1
  });

  return (
    <div>
      {/* Delete client modal */}
      {confirmDelete && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--bg)',borderRadius:12,padding:24,width:360,boxShadow:'0 8px 32px rgba(0,0,0,0.15)',border:'1px solid var(--border)'}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:8}}>Remove from BOB?</div>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:4}}><strong>{confirmDelete.client_full_name}</strong></div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:16}}>{confirmDelete.carrier} · {confirmDelete.agent_name}</div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setConfirmDelete(null)} className="btn">Cancel</button>
              <button onClick={()=>deleteClient(confirmDelete.id)} className="btn btn-danger" disabled={deleting===confirmDelete.id}>
                {deleting===confirmDelete.id ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete carrier modal */}
      {confirmCarrierDelete && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--bg)',borderRadius:12,padding:24,width:380,boxShadow:'0 8px 32px rgba(0,0,0,0.15)',border:'1px solid var(--border)'}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:8,color:'var(--red)'}}>Delete all {confirmCarrierDelete} clients?</div>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:16}}>This will remove all BOB clients for {confirmCarrierDelete}. You can re-upload their BOB export to restore them.</div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setConfirmCarrierDelete(null)} className="btn">Cancel</button>
              <button onClick={()=>deleteCarrier(confirmCarrierDelete)} className="btn btn-danger">Delete all</button>
            </div>
          </div>
        </div>
      )}

      {confirmReset && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--bg)',borderRadius:12,padding:24,width:400,boxShadow:'0 8px 32px rgba(0,0,0,0.2)',border:'1px solid var(--border)'}}>
            <div style={{fontWeight:500,fontSize:15,marginBottom:8,color:'var(--red)'}}>⚠️ Reset & Rebuild BOB?</div>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:16}}>This will <strong>delete all {summary?.totalActive||0} current BOB records</strong> and rebuild cleanly from your uploaded statements — no duplicates. Any manual status changes (Termed, Deceased) will be lost.</div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setConfirmReset(false)} className="btn">Cancel</button>
              <button onClick={resetAndRebuild} className="btn btn-danger">Yes, reset & rebuild</button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">Book of Business</div>
        <div className="page-sub">Active clients across all carriers</div>
      </div>
      <div className="page-body">

        <div className="kpi-grid" style={{marginBottom:14, gridTemplateColumns: 'repeat(3, 1fr)'}}>
          <div className="kpi-card"><div className="kpi-label">Active clients</div><div className="kpi-value blue">{summary?.totalActive||0}</div></div>
          <div className="kpi-card"><div className="kpi-label">Termed / Deceased</div><div className="kpi-value">{termedCount}</div></div>
          <div className="kpi-card"><div className="kpi-label">Carriers tracked</div><div className="kpi-value">{summary?.byCarrier?.length||0}</div></div>
        </div>

        {buildStatus && (
          <div style={{marginBottom:14,padding:'10px 14px',background:'var(--bg-subtle)',border:'1px solid var(--border)',borderRadius:8,fontSize:13,color:'var(--text)',display:'flex',alignItems:'center'}}>
            {buildStatus}
            <button onClick={()=>setBuildStatus('')} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',fontSize:16,color:'var(--text-muted)'}}>×</button>
          </div>
        )}

        <div style={{display:'flex',gap:8,marginBottom:12,borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
          <button style={tabStyle('all')} onClick={()=>{setTab('all');setFilterStatus('active');}}>All active ({summary?.totalActive||0})</button>
          <button style={tabStyle('termed')} onClick={()=>{setTab('termed');setFilterStatus('inactive');}}>Termed / Deceased ({termedCount})</button>
          <button style={tabStyle('carriers')} onClick={()=>setTab('carriers')}>By carrier</button>
          <button style={tabStyle('setup')} onClick={()=>setTab('setup')}>Setup & tools</button>
        </div>

        {(tab==='all' || tab==='termed') && (
          <div>
            {/* Filters + search bar */}
            <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'center',flexWrap:'wrap'}}>
              <input
                type="text"
                placeholder="Search client, agent, carrier..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  padding:'7px 12px',
                  border:'1px solid var(--border)',
                  borderRadius:6,
                  fontSize:13,
                  color:'var(--text)',
                  background:'var(--bg)',
                  outline:'none',
                  minWidth:240,
                  flex:1,
                  maxWidth:360,
                }}
              />
              <select className="filter-select" value={filterCarrier} onChange={e=>setFilterCarrier(e.target.value)}>
                <option value="">All carriers</option>
                {(summary?.byCarrier||[]).map(c=><option key={c.carrier} value={c.carrier}>{formatCarrier(c.carrier)}</option>)}
              </select>
              <select className="filter-select" value={filterAgent} onChange={e=>setFilterAgent(e.target.value)}>
                <option value="">All agents</option>
                {agents.map(a=><option key={a} value={a}>{a}</option>)}
              </select>
              <span style={{fontSize:12,color:'var(--text-muted)'}}>
                {search.trim() ? `${filteredClients.length} of ${clients.length}` : `${clients.length}`} clients
              </span>
              {search && (
                <button onClick={()=>setSearch('')} style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:'var(--text-muted)',padding:'0 4px'}}>✕ Clear</button>
              )}
            </div>

            {selectedIds.length > 0 && (
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'var(--accent-light)',border:'0.5px solid var(--border)',borderRadius:8,marginBottom:8}}>
                <span style={{fontSize:13,fontWeight:500,color:'var(--accent-dark)'}}>{selectedIds.length} selected</span>
                <button onClick={bulkDelete} disabled={bulkDeleting} className="btn btn-danger" style={{fontSize:12,padding:'4px 12px'}}>
                  {bulkDeleting ? 'Deleting...' : `✕ Delete ${selectedIds.length}`}
                </button>
                <button onClick={()=>setSelectedIds([])} style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:'var(--text-muted)'}}>Clear selection</button>
              </div>
            )}

            <div className="card" style={{padding:0}}>
              {sortedClients.length===0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📋</div>
                  <div className="empty-title">{search ? 'No clients match your search' : tab==='termed' ? 'No termed clients' : 'No clients yet'}</div>
                  <div className="empty-sub">{search ? `No results for "${search}"` : tab==='termed' ? 'Mark clients as Termed or Deceased to see them here' : 'Upload a BOB export or build from statements'}</div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{width:36}}></th>
                        <th style={{width:32,color:'var(--text-muted)',fontSize:11}}>#</th>
                        {[['client_full_name','Client'],['agent_name','Agent'],['carrier','Carrier'],['effective_date','Eff. date'],['last_commission','Last comm'],['status','Status']].map(([col,label]) => (
                          <th key={col} onClick={()=>handleSort(col)} style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}}>
                            {label} {sortCol===col ? (sortDir==='asc'?'↑':'↓') : <span style={{opacity:0.3}}>↕</span>}
                          </th>
                        ))}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedClients.map((c,i) => (
                        <tr key={c.id} style={{background: selectedIds.includes(c.id) ? 'var(--accent-light)' : c.status==='inactive' ? 'var(--bg-subtle)' : 'transparent'}}>
                          <td style={{paddingLeft:12}}>
                            <input type="checkbox"
                              checked={selectedIds.includes(c.id)}
                              onChange={()=>toggleSelect(c.id)}
                              style={{cursor:'pointer',accentColor:'var(--accent)'}}
                            />
                          </td>
                          <td style={{color:'var(--text-muted)',fontSize:11}}>{i+1}</td>
                          <td style={{fontWeight:500}}>
                            {search.trim()
                              ? <span dangerouslySetInnerHTML={{__html: c.client_full_name.replace(
                                  new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'),
                                  '<mark style="background:#F5EDD4;color:#6B4E0A;border-radius:2px;padding:0 2px">$1</mark>'
                                )}} />
                              : c.client_full_name
                            }
                          </td>
                          <td style={{fontSize:12}}>{c.agent_name||'—'}</td>
                          <td style={{fontSize:12,color:'var(--text)',fontWeight:500}}>{formatCarrier(c.carrier)}</td>
                          <td style={{fontSize:11,color:'var(--text-muted)'}}>{formatDate(c.effective_date)}</td>
                          <td style={{fontWeight:500,color:c.last_commission_amount && parseFloat(c.last_commission_amount) > 0 ? 'var(--green)' : 'var(--text-light)'}}>
                            {c.last_commission_amount && parseFloat(c.last_commission_amount) > 0 ? fmt(c.last_commission_amount) : '—'}
                          </td>
                          <td>
                            <select value={c.resolution||''} onChange={e=>updateStatus(c.id,e.target.value)}
                              style={{fontSize:11,padding:'3px 6px',borderRadius:5,border:'1px solid var(--border)',background:c.status==='inactive'?'var(--bg-subtle)':'var(--bg)',color:'var(--text)'}}>
                              {STATUSES.map(r=><option key={r} value={r}>{r||'Active'}</option>)}
                            </select>
                          </td>
                          <td>
                            <button onClick={()=>setConfirmDelete(c)}
                              style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:14,padding:'2px 6px',borderRadius:4}}>
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab==='carriers' && (
          <div className="card" style={{padding:0}}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Carrier</th><th>Active clients</th><th>Source</th><th>Last updated</th><th></th><th></th></tr>
                </thead>
                <tbody>
                  {(summary?.byCarrier||[]).map((c,i) => (
                    <tr key={i} onClick={()=>{ setFilterCarrier(c.carrier); setFilterStatus('active'); setTab('all'); }} style={{cursor:'pointer'}}>
                      <td style={{fontWeight:500,color:'var(--text)'}}>{formatCarrier(c.carrier)}</td>
                      <td style={{fontWeight:500,color:'var(--text)'}}>{c.count}</td>
                      <td>{(summary?.bySource||[]).find(s=>s.source==='bob_export')
                        ? <span className="badge badge-blue">BOB export</span>
                        : <span className="badge badge-gray">Statements only</span>}</td>
                      <td style={{fontSize:11,color:'var(--text-muted)'}}>{formatDateTime(c.last_updated)}</td>
                      <td style={{fontSize:11,color:'var(--text-muted)'}}>View →</td>
                      <td onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>setConfirmCarrierDelete(c.carrier)} className="btn btn-danger" style={{fontSize:11,padding:'3px 10px'}}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab==='setup' && (
          <div>
            <div className="card" style={{marginBottom:14}}>
              <div className="card-title">Run monthly renewal check</div>
              <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>
                Select a statement period and run the check — compares every BOB client against that month's commission records.
              </p>
              <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
                <div>
                  <div className="form-label">Statement period</div>
                  <select className="filter-select" value={checkPeriod} onChange={e=>setCheckPeriod(e.target.value)}>
                    <option value="">Select period</option>
                    {periods.filter(p => {
                      if (!p || p === 'Unknown') return false;
                      const s = String(p);
                      return s.match(/^\d{6}$/) || s.match(/^\d{1,2}\/\d{4}$/) || s.match(/^\d{1,2}\/\d{2}\/\d{4}$/);
                    }).map(p => {
                      let label = p;
                      const s = String(p);
                      if (s.match(/^\d{6}$/)) {
                        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                        label = months[parseInt(s.slice(4,6))-1] + ' ' + s.slice(0,4);
                      } else if (s.match(/^\d{2}\/\d{4}$/)) {
                        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                        label = months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(3);
                      }
                      return <option key={p} value={p}>{label}</option>;
                    })}
                  </select>
                </div>
                <button className="btn btn-primary" onClick={runRenewalCheck} disabled={loading||!checkPeriod}>
                  {loading ? 'Checking...' : 'Run renewal check →'}
                </button>
              </div>
            </div>

            <div className="card" style={{marginBottom:14}}>
              <div className="card-title">Build BOB from existing statements</div>
              <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>
                Automatically populate your Book of Business from all commission records already uploaded.
              </p>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button className="btn btn-primary" onClick={buildFromStatements} disabled={loading}>Build BOB from statements →</button>
                <button onClick={()=>setConfirmReset(true)} style={{background:'none',border:'0.5px solid var(--red)',borderRadius:7,padding:'7px 14px',fontSize:13,cursor:'pointer',color:'var(--red)',fontWeight:500}}>
                  ⚠️ Reset & rebuild clean
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Upload carrier BOB export</div>
              <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>
                Upload a BOB export file directly from a carrier portal for more accurate tracking.
              </p>
              {uploadStatus && (
                <div style={{marginBottom:12,padding:'8px 12px',background:'var(--bg-subtle)',border:'1px solid var(--border)',borderRadius:6,fontSize:13}}>
                  {uploadStatus}
                </div>
              )}
              <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
                <div>
                  <div className="form-label">Carrier</div>
                  <select className="filter-select" value={uploadCarrier} onChange={e=>setUploadCarrier(e.target.value)}>
                    <option value="">Select carrier</option>
                    {CARRIERS.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <div className="form-label">BOB export file (.xlsx or .csv)</div>
                  <input type="file" accept=".xlsx,.csv,.xls" disabled={!uploadCarrier} onChange={handleBOBUpload} style={{fontSize:12}}/>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload } from '../api';

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
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [buildStatus, setBuildStatus] = useState('');
  const [checkPeriod, setCheckPeriod] = useState('');
  const [uploadCarrier, setUploadCarrier] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmCarrierDelete, setConfirmCarrierDelete] = useState(null);
  const [deleting, setDeleting] = useState(null);

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

  const activeCount = clients.filter(c => c.status === 'active').length;
  const termedCount = clients.filter(c => c.status === 'inactive').length;

  const tabStyle = (id) => ({
    padding:'7px 14px', border:'none', background:'none', fontSize:13, cursor:'pointer',
    borderBottom: tab===id ? '2px solid var(--blue)' : '2px solid transparent',
    color: tab===id ? 'var(--blue)' : 'var(--text-muted)',
    fontWeight: tab===id ? 600 : 400, marginBottom:-1
  });

  return (
    <div>
      {/* Delete client modal */}
      {confirmDelete && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#ffffff',borderRadius:12,padding:24,width:360,boxShadow:'0 8px 32px rgba(0,0,0,0.2)',border:'1px solid #e0e0e0'}}>
            <div style={{fontWeight:600,fontSize:15,marginBottom:8}}>Remove from BOB?</div>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:4}}><strong>{confirmDelete.client_full_name}</strong></div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:16}}>{confirmDelete.carrier} · {confirmDelete.agent_name}</div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setConfirmDelete(null)} className="btn">Cancel</button>
              <button onClick={()=>deleteClient(confirmDelete.id)} style={{background:'#E24B4A',color:'#fff',border:'none',borderRadius:6,padding:'7px 16px',fontSize:13,fontWeight:600,cursor:'pointer'}} disabled={deleting===confirmDelete.id}>
                {deleting===confirmDelete.id ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete carrier modal */}
      {confirmCarrierDelete && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#ffffff',borderRadius:12,padding:24,width:380,boxShadow:'0 8px 32px rgba(0,0,0,0.2)',border:'1px solid #e0e0e0'}}>
            <div style={{fontWeight:600,fontSize:15,marginBottom:8,color:'#E24B4A'}}>Delete all {confirmCarrierDelete} clients?</div>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:16}}>This will remove all BOB clients for {confirmCarrierDelete}. You can re-upload their BOB export to restore them.</div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setConfirmCarrierDelete(null)} className="btn">Cancel</button>
              <button onClick={()=>deleteCarrier(confirmCarrierDelete)} style={{background:'#E24B4A',color:'#fff',border:'none',borderRadius:6,padding:'7px 16px',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">Book of Business</div>
        <div className="page-sub">Active clients across all carriers</div>
      </div>
      <div className="page-body">

        <div className="kpi-grid" style={{marginBottom:14}}>
          <div className="kpi-card"><div className="kpi-label">Active clients</div><div className="kpi-value blue">{summary?.totalActive||0}</div></div>
          <div className="kpi-card"><div className="kpi-label">Termed / Deceased</div><div className="kpi-value">{termedCount}</div></div>
          <div className="kpi-card"><div className="kpi-label">Carriers tracked</div><div className="kpi-value">{summary?.byCarrier?.length||0}</div></div>
          <div className="kpi-card"><div className="kpi-label">New this month</div><div className="kpi-value green">{summary?.newEnrollments||0}</div></div>
        </div>

        {buildStatus && (
          <div className="alert alert-success" style={{marginBottom:14,display:'flex',alignItems:'center'}}>
            {buildStatus}
            <button onClick={()=>setBuildStatus('')} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',fontSize:14}}>×</button>
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
            <div className="filters" style={{marginBottom:10}}>
              <select className="filter-select" value={filterCarrier} onChange={e=>setFilterCarrier(e.target.value)}>
                <option value="">All carriers</option>
                {(summary?.byCarrier||[]).map(c=><option key={c.carrier} value={c.carrier}>{c.carrier}</option>)}
              </select>
              <select className="filter-select" value={filterAgent} onChange={e=>setFilterAgent(e.target.value)}>
                <option value="">All agents</option>
                {agents.map(a=><option key={a} value={a}>{a}</option>)}
              </select>
              <span className="row-count">{clients.length} clients</span>
            </div>

            <div className="card" style={{padding:0}}>
              {clients.length===0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📋</div>
                  <div className="empty-title">{tab==='termed' ? 'No termed clients' : 'No clients yet'}</div>
                  <div className="empty-sub">{tab==='termed' ? 'Mark clients as Termed or Deceased to see them here' : 'Upload a BOB export or build from statements'}</div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Client</th>
                        <th>Agent</th>
                        <th>Carrier</th>
                        <th>Eff. date</th>
                        <th>Last commission</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((c,i) => (
                        <tr key={c.id} style={{background: c.status==='inactive' ? '#FFF5F5' : 'transparent'}}>
                          <td style={{color:'var(--text-muted)',fontSize:11}}>{i+1}</td>
                          <td style={{fontWeight:500}}>{c.client_full_name}</td>
                          <td style={{fontSize:12}}>{c.agent_name||'—'}</td>
                          <td style={{fontSize:12}}>{c.carrier}</td>
                          <td style={{fontSize:11,color:'var(--text-muted)'}}>{c.effective_date||'—'}</td>
                          <td style={{fontWeight:600,color:'var(--green)'}}>{fmt(c.last_commission_amount)}</td>
                          <td>
                            <select value={c.resolution||''} onChange={e=>updateStatus(c.id,e.target.value)}
                              style={{fontSize:11,padding:'3px 6px',borderRadius:'var(--radius)',border:'1px solid var(--border)',background: c.status==='inactive'?'#FCE8E8':'var(--gray-50)',color:'var(--text)'}}>
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
                      <td style={{fontWeight:500,color:'#185FA5'}}>{c.carrier}</td>
                      <td style={{fontWeight:600,color:'#185FA5'}}>{c.count}</td>
                      <td>{(summary?.bySource||[]).find(s=>s.source==='bob_export')
                        ? <span className="badge badge-blue">BOB export</span>
                        : <span className="badge badge-gray">Statements only</span>}</td>
                      <td style={{fontSize:11,color:'var(--text-muted)'}}>{c.last_updated?new Date(c.last_updated).toLocaleDateString():'—'}</td>
                      <td style={{fontSize:11,color:'var(--text-muted)'}}>View →</td>
                      <td onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>setConfirmCarrierDelete(c.carrier)}
                          style={{background:'none',border:'1px solid #F7C1C1',borderRadius:6,padding:'3px 10px',fontSize:11,cursor:'pointer',color:'#E24B4A',fontWeight:600}}>
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
                  {loading?<><span className="spinner"></span> Checking...</>:'Run renewal check →'}
                </button>
              </div>
            </div>

            <div className="card" style={{marginBottom:14}}>
              <div className="card-title">Build BOB from existing statements</div>
              <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>
                Automatically populate your Book of Business from all commission records already uploaded.
              </p>
              <button className="btn btn-primary" onClick={buildFromStatements}>Build BOB from statements →</button>
            </div>

            <div className="card">
              <div className="card-title">Upload carrier BOB export</div>
              <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>
                Upload a BOB export file directly from a carrier portal for more accurate tracking.
              </p>
              {uploadStatus && (
                <div className={`alert ${uploadStatus.startsWith('Error')?'alert-error':'alert-success'}`} style={{marginBottom:12}}>
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

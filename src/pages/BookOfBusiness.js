import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CARRIERS = ['UnitedHealthcare','Humana','Aetna','Devoted','Cigna','Florida Blue','Oscar Health','Molina','WellCare','Sunshine Health','Gold Kidney','NHP','BSI','Solis','Integrity'];
const RESOLUTIONS = ['','Termed','Payment delayed','Plan changed','Duplicate','Resolved'];

export default function BookOfBusiness({ user }) {
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [tab, setTab] = useState('missing');
  const [filterCarrier, setFilterCarrier] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [buildStatus, setBuildStatus] = useState('');
  const [checkPeriod, setCheckPeriod] = useState('');
  const [uploadCarrier, setUploadCarrier] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
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
      if (tab === 'missing') params.set('missing', 'true');
      else if (tab === 'all') params.set('status', 'active');
      const data = await apiFetch(`/bob?${params}`);
      setClients(data);
    } catch (e) { console.error(e); }
  }, [tab, filterCarrier, filterAgent]);

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
      setBuildStatus(`Checked ${result.checkedClients} clients — ${result.missingCount} missing, ${result.recoveredCount} recovered`);
      loadData(); loadClients();
    } catch (e) { setBuildStatus('Error: ' + e.message); }
    finally { setLoading(false); }
  }

  async function updateResolution(id, resolution) {
    try {
      const status = resolution === 'Termed' ? 'inactive' : 'active';
      await apiFetch(`/bob/${id}`, { method: 'PATCH', body: JSON.stringify({ resolution, status }) });
      setClients(prev => prev.map(c => c.id === id ? { ...c, resolution, status } : c));
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

  const missingClients = clients.filter(c => c.months_missing > 0 && c.status === 'active');
  const activeClients = clients.filter(c => c.status === 'active');
  const displayClients = tab === 'missing' ? missingClients : activeClients;

  const tabStyle = (id) => ({
    padding:'7px 14px', border:'none', background:'none', fontSize:13, cursor:'pointer',
    borderBottom: tab===id ? '2px solid var(--blue)' : '2px solid transparent',
    color: tab===id ? 'var(--blue)' : 'var(--text-muted)',
    fontWeight: tab===id ? 600 : 400, marginBottom:-1
  });

  return (
    <div>
      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--bg)',borderRadius:12,padding:24,width:360,boxShadow:'0 8px 32px rgba(0,0,0,0.2)'}}>
            <div style={{fontWeight:600,fontSize:15,marginBottom:8}}>Remove from BOB?</div>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:4}}><strong>{confirmDelete.client_full_name}</strong></div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:16}}>{confirmDelete.carrier} · {confirmDelete.agent_name}</div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setConfirmDelete(null)} className="btn" style={{fontSize:13}}>Cancel</button>
              <button onClick={()=>deleteClient(confirmDelete.id)} className="btn" style={{background:'#E24B4A',color:'#fff',border:'none',fontSize:13}} disabled={deleting===confirmDelete.id}>
                {deleting===confirmDelete.id ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">Book of Business</div>
        <div className="page-sub">Active clients across all carriers — track renewals monthly</div>
      </div>
      <div className="page-body">

        {summary?.missingCount > 0 && (
          <div style={{background:'var(--red-light)',border:'1px solid #F7C1C1',borderRadius:'var(--radius)',padding:'10px 14px',display:'flex',alignItems:'center',gap:10,marginBottom:14,fontSize:13,color:'#A32D2D'}}>
            <span style={{fontWeight:600}}>{summary.missingCount} clients</span> did not appear in last month's statements —
            <span style={{fontWeight:600}}>{fmt(summary.atRisk)}</span> at risk
            <button onClick={()=>setTab('missing')} style={{marginLeft:'auto',background:'none',border:'1px solid #F7C1C1',borderRadius:'var(--radius)',padding:'4px 10px',fontSize:12,color:'#A32D2D',cursor:'pointer'}}>Review now →</button>
          </div>
        )}

        <div className="kpi-grid" style={{marginBottom:14}}>
          <div className="kpi-card"><div className="kpi-label">Active clients</div><div className="kpi-value blue">{summary?.totalActive||0}</div></div>
          <div className="kpi-card"><div className="kpi-label">Missing this month</div><div className={`kpi-value ${(summary?.missingCount||0)>0?'red':'green'}`}>{summary?.missingCount||0}</div></div>
          <div className="kpi-card"><div className="kpi-label">At risk</div><div className="kpi-value amber">{fmt(summary?.atRisk)}</div></div>
          <div className="kpi-card"><div className="kpi-label">Carriers tracked</div><div className="kpi-value">{summary?.byCarrier?.length||0}</div></div>
        </div>

        {buildStatus && (
          <div className="alert alert-success" style={{marginBottom:14,display:'flex',alignItems:'center'}}>
            {buildStatus}
            <button onClick={()=>setBuildStatus('')} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',fontSize:14}}>×</button>
          </div>
        )}

        <div style={{display:'flex',gap:8,marginBottom:12,borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
          <button style={tabStyle('missing')} onClick={()=>setTab('missing')}>Missing renewals ({summary?.missingCount||0})</button>
          <button style={tabStyle('all')} onClick={()=>setTab('all')}>All active ({summary?.totalActive||0})</button>
          <button style={tabStyle('carriers')} onClick={()=>setTab('carriers')}>By carrier</button>
          <button style={tabStyle('setup')} onClick={()=>setTab('setup')}>Setup & tools</button>
        </div>

        {(tab==='missing'||tab==='all') && (
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
              <span className="row-count">{displayClients.length} clients</span>
            </div>

            <div className="card" style={{padding:0}}>
              {displayClients.length===0 ? (
                <div className="empty-state">
                  <div className="empty-icon">{tab==='missing'?'✅':'📋'}</div>
                  <div className="empty-title">{tab==='missing'?'No missing renewals!':'No clients yet'}</div>
                  <div className="empty-sub">{tab==='missing'?'All BOB clients appeared in last month\'s statements':'Build your BOB from statements or upload a BOB export'}</div>
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
                        <th>Months missing</th>
                        <th>Resolution</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayClients.map((c,i) => (
                        <tr key={c.id}>
                          <td style={{color:'var(--text-muted)',fontSize:11}}>{i+1}</td>
                          <td style={{fontWeight:500}}>{c.client_full_name}</td>
                          <td style={{fontSize:12}}>{c.agent_name||'—'}</td>
                          <td style={{fontSize:12}}>{c.carrier}</td>
                          <td style={{fontSize:11,color:'var(--text-muted)'}}>{c.effective_date||'—'}</td>
                          <td style={{fontWeight:600,color:c.months_missing>0?'var(--red)':'var(--green)'}}>{fmt(c.last_commission_amount)}</td>
                          <td>
                            {c.months_missing>0
                              ? <span className={`badge ${c.months_missing>=2?'badge-red':'badge-amber'}`}>{c.months_missing} month{c.months_missing>1?'s':''}</span>
                              : <span className="badge badge-green">Current</span>}
                          </td>
                          <td>
                            <select value={c.resolution||''} onChange={e=>updateResolution(c.id,e.target.value)}
                              style={{fontSize:11,padding:'3px 6px',borderRadius:'var(--radius)',border:'1px solid var(--border)',background:'var(--gray-50)',color:'var(--text)'}}>
                              {RESOLUTIONS.map(r=><option key={r} value={r}>{r||'Mark as...'}</option>)}
                            </select>
                          </td>
                          <td>
                            <button onClick={()=>setConfirmDelete(c)}
                              style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:14,padding:'2px 6px',borderRadius:4}}
                              title="Remove from BOB">
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
                  <tr><th>Carrier</th><th>Active clients</th><th>Missing</th><th>Source</th><th>Last updated</th></tr>
                </thead>
                <tbody>
                  {(summary?.byCarrier||[]).map((c,i) => (
                    <tr key={i}>
                      <td style={{fontWeight:500}}>{c.carrier}</td>
                      <td>{c.count}</td>
                      <td>{clients.filter(x=>x.carrier===c.carrier&&x.months_missing>0).length>0
                        ? <span className="badge badge-red">{clients.filter(x=>x.carrier===c.carrier&&x.months_missing>0).length}</span>
                        : <span className="badge badge-green">0</span>}</td>
                      <td>{(summary?.bySource||[]).find(s=>s.source==='bob_export')
                        ? <span className="badge badge-blue">BOB export</span>
                        : <span className="badge badge-gray">Statements only</span>}</td>
                      <td style={{fontSize:11,color:'var(--text-muted)'}}>{c.last_updated?new Date(c.last_updated).toLocaleDateString():'—'}</td>
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
                Select a statement period and run the check — compares every BOB client against that month's commission records and flags anyone who didn't get paid.
              </p>
              <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
                <div>
                  <div className="form-label">Statement period</div>
                  <select className="filter-select" value={checkPeriod} onChange={e=>setCheckPeriod(e.target.value)}>
                    <option value="">Select period</option>
                    {periods.map(p=><option key={p} value={p}>{p}</option>)}
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
                Automatically populate your Book of Business from all commission records already uploaded. Run this once to get started.
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

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import { formatCarrier } from '../utils/formatCarrier';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const allSelected = selected.length === 0;

  function toggle(val) {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val));
    else onChange([...selected, val]);
  }

  function clear() { onChange([]); setOpen(false); }

  const displayLabel = allSelected ? `All ${label}` : `${selected.length} ${label}`;

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)',
        background: selected.length > 0 ? 'var(--accent)' : 'var(--bg)',
        color: selected.length > 0 ? 'var(--sidebar-bg)' : 'var(--text)',
        fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: selected.length > 0 ? 500 : 400
      }}>
        {displayLabel} <span style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)', zIndex: 100,
            minWidth: 200, maxWidth: 280, maxHeight: 320, overflowY: 'auto', padding: 6
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px 8px', borderBottom: '0.5px solid var(--border)', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
              {selected.length > 0 && <button onClick={clear} style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Clear</button>}
            </div>
            {options.map(opt => {
              const isSel = selected.includes(opt);
              return (
                <button key={opt} onClick={() => toggle(opt)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', background: isSel ? 'var(--accent-light)' : 'none',
                  border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'left', fontSize: 12,
                  color: isSel ? 'var(--accent-dark)' : 'var(--text)', fontWeight: isSel ? 500 : 400
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: isSel ? 'none' : '1.5px solid var(--border)', background: isSel ? 'var(--accent)' : 'transparent'
                  }}>
                    {isSel && <span style={{ color: 'var(--sidebar-bg)', fontSize: 9 }}>✓</span>}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function AllData({ user, initialFilters = {} }) {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState({ agents: [], carriers: [], periods: [], planTypes: [] });
  const [selAgents, setSelAgents] = useState(initialFilters.agent ? [initialFilters.agent] : []);
  const [selCarriers, setSelCarriers] = useState(initialFilters.carrier ? [initialFilters.carrier] : []);
  const [selPeriods, setSelPeriods] = useState(initialFilters.period ? [initialFilters.period] : []);
  const [selTypes, setSelTypes] = useState(initialFilters.classification ? [initialFilters.classification] : []);
  const [selPayees, setSelPayees] = useState([]);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const PAGE_SIZE = 100;
  const [policyModal, setPolicyModal] = useState(null);

  const classificationTypes = ['New Business', 'Renewal', 'Agent Commission', 'Agency Override', 'Chargeback', 'HRA/Bonus'];

  useEffect(() => {
    apiFetch('/records/filters').then(d => setFilterOptions(d)).catch(console.error);
    setSelAgents([]); setSelCarriers([]); setSelPeriods([]); setSelTypes([]); setSelPayees([]);
    setPage(0);
  }, [user.agency]);

  useEffect(() => {
    if (initialFilters.agent) setSelAgents([initialFilters.agent]);
    if (initialFilters.carrier) setSelCarriers([initialFilters.carrier]);
    if (initialFilters.period) setSelPeriods([initialFilters.period]);
    if (initialFilters.classification) setSelTypes([initialFilters.classification]);
    setPage(0);
  }, [initialFilters.agent, initialFilters.carrier, initialFilters.period, initialFilters.classification]);

  const loadRecords = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset });
      if (selAgents.length === 1) params.set('agent', selAgents[0]);
      if (selCarriers.length === 1) params.set('carrier', selCarriers[0]);
      if (selPeriods.length === 1) params.set('period', selPeriods[0]);
      if (selTypes.length === 1) params.set('classification', selTypes[0]);
      if (selAgents.length > 1) params.set('agents', selAgents.join(','));
      if (selCarriers.length > 1) params.set('carriers', selCarriers.join(','));
      if (selPeriods.length > 1) params.set('periods', selPeriods.join(','));
      if (selTypes.length > 1) params.set('classifications', selTypes.join(','));
      if (selPayees.length === 1) params.set('payee', selPayees[0]);
      if (search.trim()) params.set('search', search.trim());
      const data = await apiFetch(`/records?${params}`);
      setRecords(data.records || []);
      setTotal(data.total || 0);
      setSelected(new Set());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [selAgents, selCarriers, selPeriods, selTypes, selPayees, search, user.agency]);

  useEffect(() => { setPage(0); loadRecords(0); }, [loadRecords]);

  function handlePage(dir) {
    const next = page + dir;
    setPage(next);
    loadRecords(next * PAGE_SIZE);
  }

  function clearAll() {
    setSelAgents([]); setSelCarriers([]); setSelPeriods([]); setSelTypes([]); setSelPayees([]); setSearch('');
    setPage(0);
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSelectAll() {
    setSelected(records.length > 0 && selected.size === records.length ? new Set() : new Set(records.map(r => r.id)));
  }

  async function executeDelete() {
    setDeleting(true);
    try {
      if (confirmDelete === 'all') {
        await apiFetch('/records/bulk-delete', { method: 'POST', body: JSON.stringify({ deleteAll: true }) });
        setRecords([]); setTotal(0); setSelected(new Set());
      } else if (confirmDelete === 'selected') {
        await apiFetch('/records/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
        setRecords(prev => prev.filter(r => !selected.has(r.id)));
        setTotal(prev => prev - selected.size); setSelected(new Set());
      } else if (confirmDelete === 'single') {
        await apiFetch(`/records/${deleteTarget.id}`, { method: 'DELETE' });
        setRecords(prev => prev.filter(r => r.id !== deleteTarget.id));
        setTotal(prev => prev - 1);
      }
      setConfirmDelete(null); setDeleteTarget(null);
    } catch (e) { console.error(e); }
    finally { setDeleting(false); }
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  const sortedRecords = [...records].sort((a, b) => {
    if (!sortCol) return 0;
    const aVal = String(a[sortCol] || '').toLowerCase();
    const bVal = String(b[sortCol] || '').toLowerCase();
    const numA = parseFloat(a[sortCol]);
    const numB = parseFloat(b[sortCol]);
    if (!isNaN(numA) && !isNaN(numB)) return sortDir === 'asc' ? numA - numB : numB - numA;
    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  const grandTotal = records.reduce((s, r) => s + (parseFloat(r.commission) || 0), 0);
  const hasFilters = selAgents.length || selCarriers.length || selPeriods.length || selTypes.length || selPayees.length || search.trim();

  async function exportCSV() {
    try {
      // Build same params as loadRecords but without limit/offset to get ALL records
      const params = new URLSearchParams();
      if (selAgents.length === 1) params.set('agent', selAgents[0]);
      if (selCarriers.length === 1) params.set('carrier', selCarriers[0]);
      if (selPeriods.length === 1) params.set('period', selPeriods[0]);
      if (selTypes.length === 1) params.set('classification', selTypes[0]);
      if (selAgents.length > 1) params.set('agents', selAgents.join(','));
      if (selCarriers.length > 1) params.set('carriers', selCarriers.join(','));
      if (selPeriods.length > 1) params.set('periods', selPeriods.join(','));
      if (selTypes.length > 1) params.set('classifications', selTypes.join(','));
      if (selPayees.length === 1) params.set('payee', selPayees[0]);
      if (search.trim()) params.set('search', search.trim());
      
      // Fetch ALL records (no limit)
      const data = await apiFetch(`/records?${params}`);
      const allRecords = data.records || [];
      
      // Build CSV with all records
      const headers = ['Agent', 'Carrier', 'Client', 'Policy #', 'Effective Date', 'Premium', 'Comm Value', 'Type', 'Period', 'Payee', 'MGA'];
      const rows = allRecords.map(r => [r.agent_name, formatCarrier(r.carrier), r.client_full_name, r.policy_number, r.effective_date, r.premium, r.commission, r.classification, r.payment_period, r.payee, r.mga]);
      const csv = [headers, ...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
      
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `commissions_export_${new Date().toISOString().split('T')[0]}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export error:', e);
      alert('Error exporting data. Please try again.');
    }
  }

  function badgeClass(c) {
    if (c === 'New Business') return 'badge-green';
    if (c === 'Renewal') return 'badge-blue';
    if (c === 'Agent Commission') return 'badge-green';
    if (c === 'Agency Override') return 'badge-blue';
    if (c === 'Chargeback') return 'badge-red';
    if (c === 'HRA/Bonus') return 'badge-amber';
    return 'badge-gray';
  }

  const deleteModalText = {
    all: { title: 'Delete EVERYTHING?', sub: `This will permanently delete all ${total.toLocaleString()} records and all uploads. This cannot be undone.`, btn: 'Yes, delete everything' },
    selected: { title: `Delete ${selected.size} selected records?`, sub: 'These records will be permanently deleted.', btn: `Delete ${selected.size} records` },
    single: { title: 'Delete this record?', sub: deleteTarget ? `${deleteTarget.client_full_name} · ${deleteTarget.carrier} · ${fmt(deleteTarget.commission)}` : '', btn: 'Delete' }
  };

  const hasMGA = records.some(r => r.mga && r.mga.trim());
  const hasCommSplit = records.some(r => {
    try { const raw = typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data; return raw && raw.agentComm !== undefined; } catch(e) { return false; }
  });
  function getCommSplit(r) {
    try { const raw = typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data; return raw || {}; } catch(e) { return {}; }
  }
  const hasLOB = records.some(r => r.lob);
  const hasSplitData = records.some(r => r.thei_share != null || r.bsi_share != null);
  const hasSubAgentOverride = records.some(r => r.sub_agent_override && r.sub_agent_override > 0);
  
  const columns = [
    { col: 'carrier',         label: 'Carrier' },
    { col: 'agent_name',      label: 'Agent' },
    { col: 'policy_number',   label: 'Policy #' },
    { col: 'client_full_name',label: 'Client' },
    { col: 'effective_date',  label: 'Effective' },
    { col: 'premium',         label: 'Premium' },
    { col: 'commission',      label: 'Comm Value' },
    ...(hasCommSplit ? [{ col: 'comm_rate', label: 'Comm Rate' }] : []),
    ...(hasCommSplit ? [{ col: 'agent_comm', label: 'Agent Comm' }] : []),
    ...(hasCommSplit ? [{ col: 'agency_comm', label: 'Agency Comm' }] : []),
    { col: 'payment_period',  label: 'Period' },
    { col: 'classification',  label: 'Type' },
    ...(hasLOB ? [{ col: 'lob', label: 'LOB' }] : []),
    ...(hasSplitData ? [{ col: 'gross_commission', label: 'Gross' }] : []),
    ...(hasSplitData ? [{ col: 'thei_share', label: 'THEI' }] : []),
    ...(hasSplitData ? [{ col: 'bsi_share', label: 'BSI' }] : []),
    ...(hasSplitData ? [{ col: 'producer_payable', label: 'Agent Pay' }] : []),
    ...(hasSubAgentOverride ? [{ col: 'sub_agent_override', label: 'Sub-Agent OV' }] : []),
    ...(hasMGA ? [{ col: 'mga', label: 'MGA' }] : []),
  ];

  return (
    <>
      {policyModal && (
        <div onClick={()=>setPolicyModal(null)} style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg)',borderRadius:12,padding:28,width:520,maxWidth:'95vw',border:'0.5px solid var(--border)',boxShadow:'0 8px 32px rgba(0,0,0,0.15)',maxHeight:'85vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div>
                <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Policy Record</div>
                <div style={{fontSize:16,fontWeight:500,color:'var(--text)'}}>{policyModal.policy_number || '—'}</div>
              </div>
              <button onClick={()=>setPolicyModal(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--text-muted)'}}>×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px 20px',fontSize:13}}>
              {[
                ['Client', policyModal.client_full_name],
                ['Agent', policyModal.agent_name],
                ['Carrier', policyModal.carrier],
                ['Plan Type', policyModal.plan_type],
                ['LOB', policyModal.lob],
                ['Effective Date', policyModal.effective_date],
                ['Period', policyModal.payment_period],
                ['Type', policyModal.classification],
                ['Payee', policyModal.payee],
                ['MGA', policyModal.mga],
                ['Premium', policyModal.premium ? fmt(policyModal.premium) : '—'],
                ['Comm Value', fmt(policyModal.commission)],
                ['Gross Commission', policyModal.gross_commission != null ? fmt(policyModal.gross_commission) : null],
                ['THEI Share', policyModal.thei_share != null ? fmt(policyModal.thei_share) : null],
                ['BSI Share', policyModal.bsi_share != null ? fmt(policyModal.bsi_share) : null],
                ['Agent Payable', policyModal.producer_payable != null ? fmt(policyModal.producer_payable) : null],
                ['Sub-Agent Override', policyModal.sub_agent_override && policyModal.sub_agent_override > 0 ? fmt(policyModal.sub_agent_override) : null],
              ].map(([label, val]) => val && val !== '—' ? (
                <div key={label}>
                  <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>{label}</div>
                  <div style={{fontWeight:500,color:'var(--text)'}}>{val}</div>
                </div>
              ) : null)}
              {(() => {
                const s = policyModal.raw_data ? (typeof policyModal.raw_data === 'string' ? JSON.parse(policyModal.raw_data) : policyModal.raw_data) : {};
                return s.commRate ? (
                  <>
                    <div>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>Comm Rate</div>
                      <div style={{fontWeight:500,color:'var(--text)'}}>{s.commRate}%</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>Comm Value</div>
                      <div style={{fontWeight:500,color:'var(--text)'}}>{fmt(s.commValue)}</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>Agent Comm</div>
                      <div style={{fontWeight:500,color:'var(--green)'}}>{fmt(s.agentComm)}</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:2}}>Agency Comm</div>
                      <div style={{fontWeight:500,color:'var(--text)'}}>{fmt(s.agencyComm)}</div>
                    </div>
                  </>
                ) : null;
              })()}
            </div>
            <div style={{marginTop:16,paddingTop:12,borderTop:'0.5px solid var(--border)',fontSize:11,color:'var(--text-muted)'}}>
              Upload: {policyModal.upload_name || '—'}
            </div>
          </div>
        </div>
      )}
      <div className="page-header">
        <div className="page-title">All Data</div>
        <div className="page-sub">All commission records across all carriers and periods</div>
      </div>
      <div className="page-body">

        {confirmDelete && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--bg)', borderRadius: 12, padding: 28, width: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.2)', border: '0.5px solid var(--border)' }}>
              <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 8, color: 'var(--red)' }}>{deleteModalText[confirmDelete]?.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{deleteModalText[confirmDelete]?.sub}</div>
              {confirmDelete === 'all' && (
                <div style={{ background: '#F5EAE4', border: '0.5px solid #E5C8B8', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#7A3D1F' }}>
                  ⚠️ This will also delete all upload records and BOB data.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setConfirmDelete(null); setDeleteTarget(null); }} className="btn" disabled={deleting}>Cancel</button>
                <button onClick={executeDelete} className="btn btn-danger" disabled={deleting}>
                  {deleting ? 'Deleting...' : deleteModalText[confirmDelete]?.btn}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, alignItems: 'center' }}>
          <MultiSelect label="Agents" options={filterOptions.agents || []} selected={selAgents} onChange={setSelAgents} />
          <MultiSelect label="Carriers" options={filterOptions.carriers || []} selected={selCarriers} onChange={setSelCarriers} />
          <MultiSelect label="Periods" options={(filterOptions.periods || []).filter(p => p && p !== 'Unknown')} selected={selPeriods} onChange={setSelPeriods} />
          <MultiSelect label="Types" options={classificationTypes} selected={selTypes} onChange={setSelTypes} />
          <MultiSelect label="Payee" options={filterOptions.payees || []} selected={selPayees} onChange={setSelPayees} />
          <input
            type="text"
            placeholder="Search client, agent..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', fontSize: 12, minWidth: 200, background: 'var(--bg)', color: 'var(--text)' }}
          />
          {hasFilters && (
            <button onClick={clearAll} style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--red)', background: 'none', color: 'var(--red)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              Reset all
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{total.toLocaleString()} records</span>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button className="btn" onClick={exportCSV} disabled={!records.length} style={{ fontSize: 12 }}>↓ Export</button>
            {user.role === 'admin' && selected.size > 0 && (
              <button onClick={() => setConfirmDelete('selected')} className="btn btn-danger" style={{ fontSize: 12 }}>
                Delete {selected.size} selected
              </button>
            )}
            {user.role === 'admin' && (
              <button onClick={() => setConfirmDelete('all')} style={{ background: 'none', border: '0.5px solid var(--red)', color: 'var(--red)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                Reset all data
              </button>
            )}
          </div>
        </div>

        {hasFilters && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {[...selAgents, ...selCarriers, ...selPeriods, ...selTypes, ...selPayees].map(f => (
              <span key={f} style={{ background: 'var(--accent)', color: 'var(--sidebar-bg)', borderRadius: 4, padding: '2px 10px', fontSize: 11, fontWeight: 500 }}>{f}</span>
            ))}
          </div>
        )}

        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty-state"><div className="empty-title" style={{ color: 'var(--text-muted)' }}>Loading...</div></div>
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
                      {user.role === 'admin' && (
                        <th style={{ width: 36 }}>
                          <input type="checkbox" checked={selected.size === records.length && records.length > 0} onChange={toggleSelectAll} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                        </th>
                      )}
                      <th>#</th>
                      {columns.map(({ col, label }) => {
                        const isActive = sortCol === col;
                        return (
                          <th key={col} onClick={() => handleSort(col)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                            {label} {isActive ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{ opacity: 0.3 }}>↕</span>}
                          </th>
                        );
                      })}
                      {user.role === 'admin' && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRecords.map((r, i) => {
                      const isSel = selected.has(r.id);
                      return (
                        <tr key={r.id} style={{ background: isSel ? 'var(--accent-light)' : 'transparent' }}>
                          {user.role === 'admin' && (
                            <td><input type="checkbox" checked={isSel} onChange={() => toggleSelect(r.id)} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} /></td>
                          )}
                          <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{page * PAGE_SIZE + i + 1}</td>
                          <td style={{ fontSize: 13, fontWeight: 500 }}>{formatCarrier(r.carrier)}</td>
                          <td style={{ fontWeight: 500, fontSize: 13 }}>{r.agent_name}</td>
                          <td style={{ fontSize: 12 }}>
                            {r.policy_number
                              ? <span onClick={()=>setPolicyModal(r)} style={{cursor:'pointer',color:'var(--accent-dark)',fontWeight:500}}>{r.policy_number}</span>
                              : '—'}
                          </td>
                          <td style={{ fontSize: 13 }}>{r.client_full_name || '—'}</td>
                          <td style={{ fontSize: 12 }}>{r.effective_date || '—'}</td>
                          <td>{r.premium ? fmt(r.premium) : '—'}</td>
                          <td style={{ fontWeight: 500, color: parseFloat(r.commission) < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(r.commission)}</td>
                          {hasCommSplit && (() => { const s = getCommSplit(r); return (
                            <>
                              <td style={{ fontSize: 12 }}>{s.commRate !== undefined ? `${s.commRate}%` : '—'}</td>
                              <td style={{ fontWeight: 500, fontSize: 13, color: s.agentComm > 0 ? 'var(--green)' : 'var(--text)' }}>{s.agentComm !== undefined ? fmt(s.agentComm) : '—'}</td>
                              <td style={{ fontSize: 12 }}>{s.agencyComm !== undefined ? fmt(s.agencyComm) : '—'}</td>
                            </>
                          );})()}
                          <td style={{ fontSize: 12 }}>{r.payment_period || '—'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className={`badge ${badgeClass(r.classification)}`}>
                              {r.classification === 'Agency Override' ? 'Override' : (r.classification || '—')}
                            </span>
                          </td>
                          {hasLOB && <td style={{ fontSize: 11, fontWeight: 500, color: r.lob === 'ACA' ? 'var(--amber)' : 'var(--text-muted)' }}>{r.lob || '—'}</td>}
                          {hasSplitData && <td style={{ fontSize: 12, fontWeight: 500 }}>{r.gross_commission != null ? fmt(r.gross_commission) : '—'}</td>}
                          {hasSplitData && <td style={{ fontSize: 12, color: parseFloat(r.thei_share) > 0 ? 'var(--green)' : 'var(--text-muted)' }}>{r.thei_share != null ? fmt(r.thei_share) : '—'}</td>}
                          {hasSplitData && <td style={{ fontSize: 12, color: parseFloat(r.bsi_share) > 0 ? 'var(--blue)' : 'var(--text-muted)' }}>{r.bsi_share != null ? fmt(r.bsi_share) : '—'}</td>}
                          {hasSplitData && <td style={{ fontSize: 12, color: parseFloat(r.producer_payable) > 0 ? 'var(--accent-dark)' : 'var(--text-muted)' }}>{r.producer_payable != null ? fmt(r.producer_payable) : '—'}</td>}
                          {hasSubAgentOverride && <td style={{ fontSize: 12, fontWeight: 500, color: parseFloat(r.sub_agent_override) > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>{r.sub_agent_override && r.sub_agent_override > 0 ? fmt(r.sub_agent_override) : '—'}</td>}
                          {hasMGA && <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.mga || '—'}</td>}
                          {user.role === 'admin' && (
                            <td>
                              <button onClick={() => { setDeleteTarget(r); setConfirmDelete('single'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '2px 6px' }}>✕</button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-subtle)', fontWeight: 500 }}>
                      {user.role === 'admin' && <td></td>}
                      <td colSpan={6} style={{ padding: '10px 12px', fontSize: 13 }}>Page total ({records.length})</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: grandTotal < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(grandTotal)}</td>
                      <td colSpan={100}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {total > PAGE_SIZE && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '0.5px solid var(--border)', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={() => handlePage(-1)} disabled={page === 0}>← Prev</button>
                    <button className="btn" onClick={() => handlePage(1)} disabled={(page + 1) * PAGE_SIZE >= total}>Next →</button>
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

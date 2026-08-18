import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiUpload } from '../api';
import { formatCarrier } from '../utils/formatCarrier';
import { formatDate, formatDateTime } from '../utils/dateFormat';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function displayPolicyNumber(memberId, policyNumber) {
  if (!policyNumber) return '';
  const a = String(memberId || '').replace(/[\s\-]/g, '').toUpperCase();
  const b = String(policyNumber || '').replace(/[\s\-]/g, '').toUpperCase();
  if (a && a === b) return '';
  return policyNumber;
}

const CARRIERS = ['UnitedHealthcare','Humana','Aetna','Devoted','Cigna','Florida Blue','Oscar Health','Molina','WellCare','Sunshine Health','Gold Kidney','NHP','BSI','Solis','Integrity'];
const STATUSES = ['','Termed','Deceased','Plan changed','Duplicate','Resolved'];

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

export default function BookOfBusiness({ user }) {
  const isAdmin = user?.role === 'admin';
  const [summary, setSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [allClients, setAllClients] = useState([]); // Full unfiltered list for tab counts
  const [periods, setPeriods] = useState([]);
  const [tab, setTab] = useState('all');
  const [filterCarrier, setFilterCarrier] = useState([]);
  const [filterAgent, setFilterAgent] = useState([]);
  const [filterLOB, setFilterLOB] = useState([]);
  const [filterStatus, setFilterStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [agents, setAgents] = useState([]);
  const [lobs, setLobs] = useState([]);
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
  const [termedDatePicker, setTermedDatePicker] = useState(null); // { client, date }
  const [planCandidates, setPlanCandidates] = useState([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');
  const [planBusyId, setPlanBusyId] = useState(null);
  const [planStatusFilter, setPlanStatusFilter] = useState('pending');
  const [pendingPlanCount, setPendingPlanCount] = useState(0);
  const [clientDetails, setClientDetails] = useState(null);
  const [clientDetailsLoading, setClientDetailsLoading] = useState(false);

  useEffect(() => {
    if (tab === 'setup' && !isAdmin) setTab('all');
  }, [tab, isAdmin]);

  const loadPlanCandidates = useCallback(async () => {
    setPlanLoading(true);
    setPlanError('');
    try {
      const data = await apiFetch(`/plan-changes/candidates?status=${encodeURIComponent(planStatusFilter)}`);
      setPlanCandidates(data.candidates || []);
      if (planStatusFilter === 'pending') {
        setPendingPlanCount((data.candidates || []).length);
      } else {
        const pending = await apiFetch('/plan-changes/candidates?status=pending');
        setPendingPlanCount((pending.candidates || []).length);
      }
    } catch (e) {
      console.error(e);
      setPlanError(e.message || 'Failed to load plan change candidates');
      setPlanCandidates([]);
    } finally {
      setPlanLoading(false);
    }
  }, [planStatusFilter]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, filtersData] = await Promise.all([
        apiFetch('/bob/summary'),
        apiFetch('/records/filters')
      ]);
      setSummary(sum);
      setPeriods(filtersData.periods || []);
      setAgents((filtersData.agents || []).sort());
      setLobs((filtersData.lobs || []).sort());
      if (filtersData.periods?.length) setCheckPeriod(filtersData.periods[0]);
      try {
        const pending = await apiFetch('/plan-changes/candidates?status=pending');
        setPendingPlanCount((pending.candidates || []).length);
      } catch (_) {
        setPendingPlanCount(0);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const loadClients = useCallback(async () => {
    if (tab === 'planchanges') return;
    try {
      // Load full list for tab counts (no status filter)
      const allData = await apiFetch('/bob');
      setAllClients(allData);
      
      // Load filtered list for display
      const params = new URLSearchParams();
      if (filterCarrier.length === 1) params.set('carrier', filterCarrier[0]);
      if (filterCarrier.length > 1) params.set('carriers', filterCarrier.join(','));
      if (filterAgent.length === 1) params.set('agent', filterAgent[0]);
      if (filterAgent.length > 1) params.set('agents', filterAgent.join(','));
      if (filterLOB.length === 1) params.set('lob', filterLOB[0]);
      if (filterLOB.length > 1) params.set('lobs', filterLOB.join(','));
      if (filterStatus) params.set('status', filterStatus);
      const data = await apiFetch(`/bob?${params}`);
      setClients(data);
    } catch (e) { console.error(e); }
  }, [tab, filterCarrier, filterAgent, filterLOB, filterStatus]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadClients(); }, [loadClients]);
  useEffect(() => {
    if (tab === 'planchanges') loadPlanCandidates();
  }, [tab, loadPlanCandidates]);

  async function confirmPlanChange(id) {
    if (!isAdmin) return;
    setPlanBusyId(id);
    try {
      await apiFetch(`/plan-changes/${id}/confirm`, { method: 'POST' });
      await loadPlanCandidates();
      await loadData();
    } catch (e) {
      alert(e.message || 'Failed to confirm plan change');
    } finally {
      setPlanBusyId(null);
    }
  }

  async function dismissPlanChange(id) {
    if (!isAdmin) return;
    setPlanBusyId(id);
    try {
      await apiFetch(`/plan-changes/${id}/dismiss`, { method: 'POST' });
      await loadPlanCandidates();
    } catch (e) {
      alert(e.message || 'Failed to dismiss plan change');
    } finally {
      setPlanBusyId(null);
    }
  }

  async function buildFromStatements() {
    setBuildStatus('building');
    try {
      const result = await apiFetch('/bob/build-from-statements', { method: 'POST' });
      const ids = result.identifiers || {};
      const idNote = ids.updated != null
        ? ` Filled identifiers on ${ids.updated} existing clients (${ids.withMemberId || 0} member IDs, ${ids.withPolicy || 0} policy numbers, ${ids.withDob || 0} dates of birth).`
        : '';
      setBuildStatus(`Added ${result.added} clients to your BOB from existing statements!${idNote}`);
      loadData(); loadClients();
    } catch (e) { setBuildStatus('Error: ' + e.message); }
  }

  async function backfillIdentifiers() {
    setBuildStatus('Updating existing clients with member ID, policy number, and date of birth…');
    setLoading(true);
    try {
      const result = await apiFetch('/bob/backfill-identifiers', { method: 'POST' });
      setBuildStatus(`Updated existing BOB clients — ${result.updated} rows changed, ${result.withMemberId} member IDs, ${result.withPolicy} policy numbers, ${result.withDob} dates of birth (${result.total} total clients).`);
      loadData(); loadClients();
    } catch (e) { setBuildStatus('Error: ' + e.message); }
    finally { setLoading(false); }
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
      // If Termed is selected, show date picker modal
      if (resolution === 'Termed') {
        const client = clients.find(c => c.id === id);
        if (client) {
          const today = new Date().toISOString().split('T')[0];
          setTermedDatePicker({ client, date: today });
        }
        return;
      }
      
      // For other statuses, update immediately
      const status = (resolution === 'Deceased' || resolution === 'Termed') ? 'termed' : 'active';
      await apiFetch(`/bob/${id}`, { method: 'PATCH', body: JSON.stringify({ resolution, status }) });
      setClients(prev => prev.map(c => c.id === id ? { ...c, resolution, status } : c));
      loadData();
    } catch (e) { console.error(e); }
  }

  async function confirmTermed(client, date) {
    console.log('[BOB-TERMED] confirmTermed called');
    console.log('[BOB-TERMED] client:', client);
    console.log('[BOB-TERMED] date:', date);
    
    try {
      const payload = {
        client: client.client_full_name,
        carrier: client.carrier,
        agent: client.agent_name,
        status: 'termed',
        termedDate: date,
        notes: null
      };
      console.log('[BOB-TERMED] API payload:', payload);
      
      // Call the cascade endpoint (same as Missing Renewals)
      console.log('[BOB-TERMED] Calling API...');
      const response = await apiFetch('/bob/policy-status', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      console.log('[BOB-TERMED] API response:', response);
      
      // Close modal and refresh client list
      console.log('[BOB-TERMED] Closing modal and reloading data...');
      setTermedDatePicker(null);
      await loadData(); // Re-fetch to get fresh termed_date and updated status
      console.log('[BOB-TERMED] Success - data reloaded');
    } catch (e) {
      console.error('[BOB-TERMED] Error:', e);
      alert('Error marking as termed: ' + e.message);
    }
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

  async function openClientDetails(c) {
    setClientDetails(c);
    setClientDetailsLoading(true);
    try {
      const data = await apiFetch(`/bob/${c.id}/details`);
      setClientDetails(prev => (prev && prev.id === c.id ? { ...prev, ...data } : prev));
    } catch (e) {
      console.error(e);
    } finally {
      setClientDetailsLoading(false);
    }
  }

  async function exportCSV() {
    try {
      // Build same params as loadClients to get ALL matching records
      const params = new URLSearchParams();
      if (filterCarrier.length === 1) params.set('carrier', filterCarrier[0]);
      if (filterCarrier.length > 1) params.set('carriers', filterCarrier.join(','));
      if (filterAgent.length === 1) params.set('agent', filterAgent[0]);
      if (filterAgent.length > 1) params.set('agents', filterAgent.join(','));
      if (filterLOB.length === 1) params.set('lob', filterLOB[0]);
      if (filterLOB.length > 1) params.set('lobs', filterLOB.join(','));
      if (filterStatus) params.set('status', filterStatus);
      
      // Fetch ALL matching records
      const allData = await apiFetch(`/bob?${params}`);
      
      // Apply search filter client-side if present
      const filteredData = search.trim()
        ? allData.filter(c =>
            c.client_full_name?.toLowerCase().includes(search.toLowerCase()) ||
            c.agent_name?.toLowerCase().includes(search.toLowerCase()) ||
            c.carrier?.toLowerCase().includes(search.toLowerCase()) ||
            c.member_id?.toLowerCase().includes(search.toLowerCase()) ||
            c.policy_number?.toLowerCase().includes(search.toLowerCase())
          )
        : allData;
      
      // Build CSV
      const headers = ['Client name', 'Agent', 'Carrier', 'Member ID', 'Policy number', 'Date of birth', 'Effective date', 'Last commission date', 'Last commission amount', 'Status', 'LOB'];
      const rows = filteredData.map(c => {
        let status = 'Active';
        if (c.status === 'termed') {
          status = c.resolution || 'Termed';
        } else if (c.resolution && c.resolution !== '') {
          status = c.resolution;
        }
        
        return [
          c.client_full_name || '',
          c.agent_name || '',
          formatCarrier(c.carrier) || '',
          c.member_id || '',
          displayPolicyNumber(c.member_id, c.policy_number) || c.policy_number || '',
          formatDate(c.date_of_birth) === '—' ? '' : formatDate(c.date_of_birth),
          formatDate(c.effective_date) || '',
          formatDate(c.last_commission_date) || '',
          c.last_commission_amount || '',
          status,
          c.lob || ''
        ];
      });
      
      const csv = [headers, ...rows]
        .map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','))
        .join('\n');
      
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `BOB_Export_${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export error:', e);
      alert('Error exporting data. Please try again.');
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
        c.carrier?.toLowerCase().includes(search.toLowerCase()) ||
        c.member_id?.toLowerCase().includes(search.toLowerCase()) ||
        c.policy_number?.toLowerCase().includes(search.toLowerCase())
      )
    : clients;

  const sortedClients = [...filteredClients].sort((a, b) => {
    const aVal = String(a[sortCol] || '').toLowerCase();
    const bVal = String(b[sortCol] || '').toLowerCase();
    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  // Calculate counts from FULL unfiltered dataset, not filtered view
  const activeCount = allClients.filter(c => c.status !== 'termed').length;
  const termedCount = allClients.filter(c => c.status === 'termed').length;

  const tabStyle = (id) => ({
    padding:'7px 14px', border:'none', background:'none', fontSize:13, cursor:'pointer',
    borderBottom: tab===id ? '2px solid var(--accent)' : '2px solid transparent',
    color: tab===id ? 'var(--accent)' : 'var(--text-muted)',
    fontWeight: tab===id ? 500 : 400, marginBottom:-1
  });

  return (
    <div>
      {clientDetails && (
        <div
          onClick={() => setClientDetails(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)', borderRadius: 12, padding: 24, width: 520, maxWidth: '96vw',
              maxHeight: '85vh', overflowY: 'auto', border: '0.5px solid var(--border)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                  Client details
                </div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{clientDetails.client_full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {formatCarrier(clientDetails.carrier)}
                  {clientDetails.agent_name ? ` · ${clientDetails.agent_name}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClientDetails(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)' }}
              >
                ×
              </button>
            </div>

            {clientDetailsLoading && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Looking up member ID, policy number, and date of birth…</div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', fontSize: 13 }}>
              {[
                ['Member ID', clientDetails.member_id],
                ['Policy number', displayPolicyNumber(clientDetails.member_id, clientDetails.policy_number)],
                ['Date of birth', clientDetails.date_of_birth ? formatDate(clientDetails.date_of_birth) : ''],
                ['Effective date', formatDate(clientDetails.effective_date)],
                ['Plan', clientDetails.plan_type],
                ['Last commission', clientDetails.last_commission_amount && parseFloat(clientDetails.last_commission_amount) > 0
                  ? `${fmt(clientDetails.last_commission_amount)}${clientDetails.last_commission_date ? ` · ${formatDate(clientDetails.last_commission_date)}` : ''}`
                  : ''],
                ['Status', clientDetails.resolution || (clientDetails.status === 'termed' ? 'Termed' : 'Active')],
              ].map(([label, value]) => {
                const showPolicy = label !== 'Policy number' || value;
                if (label === 'Policy number' && !showPolicy) return null;
                const display = value && value !== '—' ? value : '—';
                return (
                  <div key={label} style={label === 'Last commission' || label === 'Status' ? { gridColumn: '1 / -1' } : undefined}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontWeight: 500, color: display === '—' ? 'var(--text-muted)' : 'var(--text)' }}>{display}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
          <button style={tabStyle('termed')} onClick={()=>{setTab('termed');setFilterStatus('termed');}}>Termed / Deceased ({termedCount})</button>
          <button style={tabStyle('planchanges')} onClick={()=>setTab('planchanges')}>
            Plan changes{pendingPlanCount > 0 ? ` (${pendingPlanCount})` : ''}
          </button>
          <button style={tabStyle('carriers')} onClick={()=>setTab('carriers')}>By carrier</button>
          {isAdmin && (
            <button style={tabStyle('setup')} onClick={()=>setTab('setup')}>Setup & tools</button>
          )}
        </div>

        {tab === 'planchanges' && (
          <div>
            <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
              <select
                className="filter-select"
                value={planStatusFilter}
                onChange={(e) => setPlanStatusFilter(e.target.value)}
              >
                <option value="pending">Pending review</option>
                <option value="confirmed">Confirmed</option>
                <option value="dismissed">Dismissed</option>
              </select>
              <button className="btn" onClick={loadPlanCandidates} disabled={planLoading} style={{fontSize:12}}>
                {planLoading ? 'Loading…' : 'Refresh'}
              </button>
              <span style={{fontSize:12,color:'var(--text-muted)'}}>
                Detected after statement uploads when the same agent/client appears under a new carrier.
              </span>
            </div>

            {planError && (
              <div className="card" style={{marginBottom:12,borderColor:'#E5C8B8',background:'#F5EAE4',color:'#7A3D1F',fontSize:13}}>
                {planError}
              </div>
            )}

            <div className="card" style={{padding:0}}>
              {planLoading ? (
                <div className="empty-state">
                  <div className="empty-title" style={{color:'var(--text-muted)'}}>Loading candidates…</div>
                </div>
              ) : planCandidates.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-title">No {planStatusFilter} plan changes</div>
                  <div className="empty-sub">
                    {planStatusFilter === 'pending'
                      ? 'New candidates appear after commission uploads when detection finds a carrier switch.'
                      : 'Nothing in this status yet.'}
                  </div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Agent</th>
                        <th>Old carrier</th>
                        <th>New carrier</th>
                        <th>Old last paid / new eff</th>
                        <th>Confidence</th>
                        {planStatusFilter === 'pending' && isAdmin && <th style={{width:200}}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {planCandidates.map((c) => (
                        <tr key={c.id}>
                          <td style={{fontWeight:500}}>{c.bob_client || c.client_name}</td>
                          <td style={{fontSize:12}}>{c.agent_name}</td>
                          <td style={{fontSize:12}}>{formatCarrier(c.old_carrier)}</td>
                          <td style={{fontSize:12,fontWeight:500}}>{formatCarrier(c.new_carrier)}</td>
                          <td style={{fontSize:12,color:'var(--text-muted)'}}>
                            {formatDate(c.old_effective_date) || '—'}
                            {' → '}
                            {formatDate(c.new_effective_date) || '—'}
                          </td>
                          <td style={{fontSize:12}}>
                            {c.confidence_score != null ? Number(c.confidence_score).toFixed(1) : '—'}
                          </td>
                          {planStatusFilter === 'pending' && isAdmin && (
                            <td>
                              <div style={{display:'flex',gap:6}}>
                                <button
                                  className="btn btn-primary"
                                  style={{fontSize:11,padding:'4px 10px'}}
                                  disabled={planBusyId === c.id}
                                  onClick={() => confirmPlanChange(c.id)}
                                >
                                  Confirm
                                </button>
                                <button
                                  className="btn"
                                  style={{fontSize:11,padding:'4px 10px'}}
                                  disabled={planBusyId === c.id}
                                  onClick={() => dismissPlanChange(c.id)}
                                >
                                  Not a change
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {(tab==='all' || tab==='termed') && (
          <div>
            {/* Filters + search bar */}
            <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'center',flexWrap:'wrap'}}>
              <input
                type="text"
                placeholder="Search client, agent, carrier, member ID..."
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
              <MultiSelect 
                label="Carriers" 
                options={(summary?.byCarrier||[]).sort((a,b)=>a.carrier.localeCompare(b.carrier)).map(c=>c.carrier)} 
                selected={filterCarrier} 
                onChange={setFilterCarrier} 
              />
              <MultiSelect 
                label="Agents" 
                options={agents} 
                selected={filterAgent} 
                onChange={setFilterAgent} 
              />
              <MultiSelect 
                label="LOB" 
                options={lobs} 
                selected={filterLOB} 
                onChange={setFilterLOB} 
              />
              <select className="filter-select" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="termed">Termed</option>
                <option value="never_paid">Never paid</option>
              </select>
              <span style={{fontSize:12,color:'var(--text-muted)'}}>
                {search.trim() ? `${filteredClients.length} of ${clients.length}` : `${clients.length}`} clients
              </span>
              {search && (
                <button onClick={()=>setSearch('')} style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:'var(--text-muted)',padding:'0 4px'}}>✕ Clear</button>
              )}
              <button className="btn" onClick={exportCSV} disabled={!sortedClients.length} style={{ fontSize: 12, marginLeft: 'auto' }}>↓ Export</button>
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
                        <tr key={c.id} style={{background: selectedIds.includes(c.id) ? 'var(--accent-light)' : c.status==='termed' ? 'var(--bg-subtle)' : 'transparent'}}>
                          <td style={{paddingLeft:12}}>
                            <input type="checkbox"
                              checked={selectedIds.includes(c.id)}
                              onChange={()=>toggleSelect(c.id)}
                              style={{cursor:'pointer',accentColor:'var(--accent)'}}
                            />
                          </td>
                          <td style={{color:'var(--text-muted)',fontSize:11}}>{i+1}</td>
                          <td style={{fontWeight:500}}>
                            <button
                              type="button"
                              onClick={() => openClientDetails(c)}
                              title="Open client details"
                              style={{
                                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                color: 'var(--accent-dark)', fontWeight: 600, fontSize: 13,
                                textDecoration: 'underline', textAlign: 'left',
                              }}
                            >
                            {search.trim()
                              ? <span dangerouslySetInnerHTML={{__html: c.client_full_name.replace(
                                  new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'),
                                  '<mark style="background:#F5EDD4;color:#6B4E0A;border-radius:2px;padding:0 2px">$1</mark>'
                                )}} />
                              : c.client_full_name
                            }
                            </button>
                          </td>
                          <td style={{fontSize:12}}>{c.agent_name||'—'}</td>
                          <td style={{fontSize:12,color:'var(--text)',fontWeight:500}}>{formatCarrier(c.carrier)}</td>
                          <td style={{fontSize:11,color:'var(--text-muted)'}}>{formatDate(c.effective_date)}</td>
                          <td style={{fontWeight:500,color:c.last_commission_amount && parseFloat(c.last_commission_amount) > 0 ? 'var(--green)' : 'var(--text-light)'}}>
                            {c.last_commission_amount && parseFloat(c.last_commission_amount) > 0 ? fmt(c.last_commission_amount) : '—'}
                          </td>
                          <td>
                            {tab === 'termed' ? (
                              // Termed/Deceased tab: show badge based on c.status
                              c.status === 'termed' ? (
                                <span className="badge badge-red">Termed</span>
                              ) : (
                                <span className="badge badge-green">Active</span>
                              )
                            ) : (
                              // Active/All tab: show dropdown for manual status changes
                              <select value={c.resolution||''} onChange={e=>updateStatus(c.id,e.target.value)}
                                style={{fontSize:11,padding:'3px 6px',borderRadius:5,border:'1px solid var(--border)',background:c.status==='termed'?'var(--bg-subtle)':'var(--bg)',color:'var(--text)'}}>
                                {STATUSES.map(r=><option key={r} value={r}>{r||'Active'}</option>)}
                              </select>
                            )}
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
                    <tr key={i} onClick={()=>{ setFilterCarrier([c.carrier]); setFilterStatus('active'); setTab('all'); }} style={{cursor:'pointer'}}>
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

        {tab==='setup' && isAdmin && (
          <div>
            <div className="card" style={{marginBottom:14}}>
              <div className="card-title">Fill member ID, policy number, and date of birth</div>
              <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>
                Update every existing Book of Business client from commission statements, production files, and MedicarePro. Empty fields are filled in; values already on the BOB record are left alone.
              </p>
              <button className="btn btn-primary" onClick={backfillIdentifiers} disabled={loading}>
                {loading ? 'Updating existing clients…' : 'Update existing clients →'}
              </button>
            </div>

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

      {/* Termed Date Picker Modal */}
      {termedDatePicker && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'white',
            borderRadius: 12,
            padding: '20px',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Mark as Termed</h3>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 500, marginBottom: 8 }}>
                {termedDatePicker.client.client_full_name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {formatCarrier(termedDatePicker.client.carrier)} · {termedDatePicker.client.agent_name}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>When did they term?</label>
              <input
                type="date"
                value={termedDatePicker.date}
                onChange={e => setTermedDatePicker({ ...termedDatePicker, date: e.target.value })}
                style={{
                  padding: '8px 10px',
                  fontSize: 13,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  width: '100%',
                  background: 'var(--bg)'
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setTermedDatePicker(null)}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  console.log('[BOB-TERMED] Confirm button clicked');
                  console.log('[BOB-TERMED] termedDatePicker:', termedDatePicker);
                  confirmTermed(termedDatePicker.client, termedDatePicker.date);
                }}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 6,
                  background: '#EF4444',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                Confirm Termed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

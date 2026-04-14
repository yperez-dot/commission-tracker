import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

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
        background: selected.length > 0 ? '#185FA5' : 'var(--bg)',
        color: selected.length > 0 ? '#fff' : 'var(--text)',
        fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: selected.length > 0 ? 600 : 400
      }}>
        {displayLabel} <span style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            background: '#ffffff', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 100,
            minWidth: 200, maxWidth: 280, maxHeight: 320, overflowY: 'auto', padding: 6
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px 8px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
              {selected.length > 0 && <button onClick={clear} style={{ fontSize: 11, color: '#E24B4A', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Clear</button>}
            </div>
            {options.map(opt => {
              const isSel = selected.includes(opt);
              return (
                <button key={opt} onClick={() => toggle(opt)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', background: isSel ? '#E6F1FB' : 'none',
                  border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'left', fontSize: 12,
                  color: isSel ? '#0C447C' : 'var(--text)', fontWeight: isSel ? 600 : 400
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: isSel ? 'none' : '1.5px solid var(--border)', background: isSel ? '#185FA5' : 'transparent'
                  }}>
                    {isSel && <span style={{ color: '#fff', fontSize: 9 }}>✓</span>}
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

  const classificationTypes = ['New Business', 'Renewal', 'Agent Commission', 'Agency Override', 'Chargeback'];

  useEffect(() => {
    apiFetch('/records/filters').then(d => setFilterOptions(d)).catch(console.error);
  }, []);

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
      // For multi-select, use comma-separated (handled by backend ANY filter)
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
  }, [selAgents, selCarriers, selPeriods, selTypes, selPayees, search]);

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

  function exportCSV() {
    const headers = ['Agent', 'Carrier', 'Client', 'Effective Date', 'Premium', 'Commission', 'Type', 'Period'];
    const rows = records.map(r => [r.agent_name, r.carrier, r.client_full_name, r.effective_date, r.premium, r.commission, r.classification, r.payment_period]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `commissions_export.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const deleteModalText = {
    all: { title: 'Delete EVERYTHING?', sub: `This will permanently delete all ${total.toLocaleString()} records and all uploads. This cannot be undone.`, btn: 'Yes, delete everything' },
    selected: { title: `Delete ${selected.size} selected records?`, sub: 'These records will be permanently deleted.', btn: `Delete ${selected.size} records` },
    single: { title: 'Delete this record?', sub: deleteTarget ? `${deleteTarget.client_full_name} · ${deleteTarget.carrier} · ${fmt(deleteTarget.commission)}` : '', btn: 'Delete' }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">All Data</div>
        <div className="page-sub">All commission records across all carriers and periods</div>
      </div>
      <div className="page-body">

        {/* Delete modal */}
        {confirmDelete && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#ffffff', borderRadius: 12, padding: 28, width: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.25)', border: '1px solid #e0e0e0' }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: '#E24B4A' }}>{deleteModalText[confirmDelete]?.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{deleteModalText[confirmDelete]?.sub}</div>
              {confirmDelete === 'all' && (
                <div style={{ background: '#FCEBEB', border: '1px solid #F7C1C1', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#A32D2D' }}>
                  ⚠️ This will also delete all upload records and BOB data. You will need to re-upload all your statements from scratch.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setConfirmDelete(null); setDeleteTarget(null); }} className="btn" disabled={deleting}>Cancel</button>
                <button onClick={executeDelete} style={{ background: '#E24B4A', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} disabled={deleting}>
                  {deleting ? 'Deleting...' : deleteModalText[confirmDelete]?.btn}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Multi-select filter bar */}
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
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, minWidth: 200, background: 'var(--bg)', color: 'var(--text)' }}
          />
          {hasFilters && (
            <button onClick={clearAll} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #E24B4A', background: 'none', color: '#E24B4A', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Clear all
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{total.toLocaleString()} records</span>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button className="btn" onClick={exportCSV} disabled={!records.length} style={{ fontSize: 12 }}>↓ Export</button>
            {user.role === 'admin' && selected.size > 0 && (
              <button onClick={() => setConfirmDelete('selected')} style={{ background: '#E24B4A', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Delete {selected.size} selected
              </button>
            )}
            {user.role === 'admin' && (
              <button onClick={() => setConfirmDelete('all')} style={{ background: 'none', border: '1px solid #E24B4A', color: '#E24B4A', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Reset all
              </button>
            )}
          </div>
        </div>

        {/* Active filter pills */}
        {hasFilters && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {[...selAgents, ...selCarriers, ...selPeriods, ...selTypes, ...selPayees].map(f => (
              <span key={f} style={{ background: '#185FA5', color: '#fff', borderRadius: 4, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>{f}</span>
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
                      {user.role === 'admin' && <th style={{ width: 36 }}><input type="checkbox" checked={selected.size === records.length && records.length > 0} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} /></th>}
                      <th>#</th>
                      {['agent_name','carrier','client_full_name','effective_date','premium','commission','classification','payment_period','payee'].map((col, i) => {
                        const labels = ['Agent','Carrier','Client','Effective','Premium','Commission','Type','Period','Payee'];
                        const isActive = sortCol === col;
                        return (
                          <th key={col} onClick={() => handleSort(col)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                            {labels[i]} {isActive ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{opacity:0.3}}>↕</span>}
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
                        <tr key={r.id} style={{ background: isSel ? 'var(--blue-light)' : 'transparent' }}>
                          {user.role === 'admin' && <td><input type="checkbox" checked={isSel} onChange={() => toggleSelect(r.id)} style={{ cursor: 'pointer' }} /></td>}
                          <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{page * PAGE_SIZE + i + 1}</td>
                          <td style={{ fontWeight: 500 }}>{r.agent_name}</td>
                          <td style={{ fontSize: 12 }}>{r.carrier}</td>
                          <td>{r.client_full_name || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.effective_date || '—'}</td>
                          <td>{r.premium ? fmt(r.premium) : '—'}</td>
                          <td style={{ fontWeight: 600, color: parseFloat(r.commission) < 0 ? 'var(--red)' : 'inherit' }}>{fmt(r.commission)}</td>
                          <td>
                            <span className={`badge ${r.classification === 'New Business' ? 'badge-green' : r.classification === 'Renewal' ? 'badge-blue' : r.classification === 'Agent Commission' ? 'badge-green' : r.classification === 'Agency Override' ? 'badge-blue' : r.classification === 'Chargeback' ? 'badge-red' : 'badge-gray'}`}>
                              {r.classification || '—'}
                            </span>
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.payment_period || '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.payee || '—'}</td>
                          {user.role === 'admin' && (
                            <td><button onClick={() => { setDeleteTarget(r); setConfirmDelete('single'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '2px 6px' }}>✕</button></td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--gray-50)', fontWeight: 600 }}>
                      {user.role === 'admin' && <td></td>}
                      <td colSpan={6} style={{ padding: '10px 12px', fontSize: 13 }}>Page total ({records.length})</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: grandTotal < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(grandTotal)}</td>
                      <td colSpan={user.role === 'admin' ? 4 : 3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {total > PAGE_SIZE && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 13 }}>
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

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const CLASSIFICATIONS = ['', 'Renewal', 'New Business', 'Advance', 'Chargeback', 'Unknown'];

export default function AllData({ user }) {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ agents: [], carriers: [], periods: [] });
  const [agent, setAgent] = useState('');
  const [carrier, setCarrier] = useState('');
  const [period, setPeriod] = useState('');
  const [classification, setClassification] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch('/records/filters').then(setFilters).catch(console.error);
  }, []);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (agent) params.set('agent', agent);
      if (carrier) params.set('carrier', carrier);
      if (period) params.set('period', period);
      if (classification) params.set('classification', classification);
      params.set('limit', '500');
      const data = await apiFetch(`/records?${params}`);
      setRecords(data.records);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [agent, carrier, period, classification]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const classColor = c => {
    if (!c) return 'badge-gray';
    const l = c.toLowerCase();
    if (l.includes('renewal')) return 'badge-blue';
    if (l.includes('new')) return 'badge-green';
    if (l.includes('advance')) return 'badge-amber';
    if (l.includes('charge')) return 'badge-red';
    return 'badge-gray';
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">All time data</div>
        <div className="page-sub">All commission records across all carriers and periods</div>
      </div>
      <div className="page-body">
        <div className="filters">
          <select className="filter-select" value={agent} onChange={e => setAgent(e.target.value)}>
            <option value="">All agents</option>
            {filters.agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="filter-select" value={carrier} onChange={e => setCarrier(e.target.value)}>
            <option value="">All carriers</option>
            {filters.carriers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="filter-select" value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="">All periods</option>
            {filters.periods.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="filter-select" value={classification} onChange={e => setClassification(e.target.value)}>
            {CLASSIFICATIONS.map(c => <option key={c} value={c}>{c || 'All types'}</option>)}
          </select>
          <span className="row-count">
            {loading ? <span className="spinner"></span> : `${records.length} of ${total} records`}
          </span>
        </div>

        <div className="card" style={{padding:0}}>
          {!records.length && !loading ? (
            <div className="empty-state">
              <div className="empty-icon">🗂️</div>
              <div className="empty-title">No records found</div>
              <div className="empty-sub">Try adjusting your filters or upload a statement</div>
            </div>
          ) : (
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
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={r.id}>
                      <td style={{color:'var(--text-muted)', fontSize:11}}>{i + 1}</td>
                      <td style={{fontWeight:500}}>{r.agent_name}</td>
                      <td style={{fontSize:12}}>{r.carrier}</td>
                      <td>{r.client_full_name || '—'}</td>
                      <td style={{fontSize:12, color:'var(--text-muted)'}}>{r.effective_date || '—'}</td>
                      <td>{r.premium > 0 ? fmt(r.premium) : '—'}</td>
                      <td style={{fontWeight:600}}>{fmt(r.commission)}</td>
                      <td><span className={`badge ${classColor(r.classification)}`}>{r.classification || '—'}</span></td>
                      <td style={{fontSize:12, color:'var(--text-muted)'}}>{r.payment_period || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

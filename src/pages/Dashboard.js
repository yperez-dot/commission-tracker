import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MY_AGENTS = [
  'Gina Berenguer',
  'Jill Taylor',
  'Katy Robles',
  'Osmary Orozco',
  'Sabri Perez',
  'The Health Experts Insurance',
  'Yahoska Perez',
];

const CLASSIFICATION_TYPES = [
  'Agent Commission',
  'Agency Override',
  'Chargeback',
  'Renewal',
  'Override',
];

function BarChart({ data, valueKey = 'total', labelKey = 'name', color = '#185FA5' }) {
  if (!data || !data.length) return <div style={{color:'var(--text-muted)', fontSize:12, padding:'20px 0'}}>No data</div>;
  const max = Math.max(...data.map(d => Math.abs(parseFloat(d[valueKey]) || 0)));
  return (
    <div style={{display:'flex', flexDirection:'column', gap:6}}>
      {data.slice(0, 8).map((d, i) => {
        const val = parseFloat(d[valueKey]) || 0;
        const pct = max > 0 ? (Math.abs(val) / max) * 100 : 0;
        return (
          <div key={i} style={{display:'flex', alignItems:'center', gap:8}}>
            <div style={{width:120, fontSize:11, color:'var(--text-muted)', textAlign:'right', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={d[labelKey]}>
              {d[labelKey]}
            </div>
            <div style={{flex:1, background:'var(--gray-100)', borderRadius:3, height:20, overflow:'hidden'}}>
              <div style={{width:`${pct}%`, background: val < 0 ? '#E24B4A' : color, height:'100%', borderRadius:3, transition:'width 0.3s ease'}}></div>
            </div>
            <div style={{width:80, fontSize:11, fontWeight:600, flexShrink:0, color: val < 0 ? 'var(--red)' : 'inherit'}}>
              {fmt(val)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard({ user }) {
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({ agents: [], carriers: [], periods: [] });
  const [loading, setLoading] = useState(false);

  // Filter state
  const [selAgents, setSelAgents] = useState([]);
  const [selCarriers, setSelCarriers] = useState([]);
  const [selPeriods, setSelPeriods] = useState([]);
  const [selClassifications, setSelClassifications] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(true);

  useEffect(() => {
    apiFetch('/records/filters').then(d => setFilters(d)).catch(console.error);
  }, []);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selAgents.length) params.set('agents', selAgents.join(','));
      if (selCarriers.length) params.set('carriers', selCarriers.join(','));
      if (selPeriods.length) params.set('periods', selPeriods.join(','));
      if (selClassifications.length) params.set('classifications', selClassifications.join(','));
      if (user.role === 'agent') params.set('agentName', user.name);
      const data = await apiFetch(`/records/summary?${params}`);
      setSummary(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [selAgents, selCarriers, selPeriods, selClassifications, user]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  function toggleItem(list, setList, item) {
    setList(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);
  }

  function toggleAll(list, setList, allItems) {
    setList(prev => prev.length === allItems.length ? [] : [...allItems]);
  }

  function clearAll() {
    setSelAgents([]);
    setSelCarriers([]);
    setSelPeriods([]);
    setSelClassifications([]);
  }

  const hasFilters = selAgents.length || selCarriers.length || selPeriods.length || selClassifications.length;

  const byAgentData = (summary?.byAgent || []).map(a => ({ name: a.agent_name, total: a.total }));
  const byCarrierData = (summary?.byCarrier || []).map(c => ({ name: c.carrier, total: c.total }));

  function FilterSection({ title, items, selected, onToggle, onToggleAll }) {
    const allSelected = selected.length === items.length && items.length > 0;
    return (
      <div style={{marginBottom:12}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
          <div style={{fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.5px'}}>{title}</div>
          <button onClick={() => onToggleAll(items)} style={{fontSize:10, color:'var(--blue)', background:'none', border:'none', cursor:'pointer', padding:0}}>
            {allSelected ? 'Clear' : 'Select all'}
          </button>
        </div>
        <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
          {items.map(item => (
            <button
              key={item}
              onClick={() => onToggle(item)}
              style={{
                padding:'3px 9px', borderRadius:99, fontSize:11, cursor:'pointer',
                border: selected.includes(item) ? '1.5px solid var(--blue)' : '1px solid var(--border)',
                background: selected.includes(item) ? 'var(--blue-light)' : 'var(--gray-50)',
                color: selected.includes(item) ? '#0C447C' : 'var(--text)',
                fontWeight: selected.includes(item) ? 600 : 400,
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">Dashboard</div>
        <div className="page-sub">Welcome back, {user.name.split(' ')[0]} — here's your commission overview</div>
      </div>
      <div className="page-body">

        {/* Filter Panel */}
        <div className="card" style={{marginBottom:14}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: filtersOpen ? 14 : 0}}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span style={{fontSize:13, fontWeight:600}}>Filters</span>
              {hasFilters ? (
                <span style={{background:'#185FA5', color:'#fff', borderRadius:99, fontSize:10, padding:'1px 7px', fontWeight:600}}>
                  {[selAgents, selCarriers, selPeriods, selClassifications].filter(a => a.length).length} active
                </span>
              ) : null}
            </div>
            <div style={{display:'flex', gap:8}}>
              {hasFilters && (
                <button onClick={clearAll} style={{fontSize:11, color:'var(--red)', background:'none', border:'none', cursor:'pointer'}}>
                  Clear all
                </button>
              )}
              <button
                onClick={() => setFiltersOpen(p => !p)}
                style={{fontSize:11, color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer'}}
              >
                {filtersOpen ? '▲ Hide' : '▼ Show'}
              </button>
            </div>
          </div>

          {filtersOpen && (
            <div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 24px'}}>
                <FilterSection
                  title="Agent"
                  items={user.role === 'admin' ? MY_AGENTS.filter(a => filters.agents.includes(a)) : [user.name]}
                  selected={selAgents}
                  onToggle={item => toggleItem(selAgents, setSelAgents, item)}
                  onToggleAll={items => toggleAll(selAgents, setSelAgents, items)}
                />
                <FilterSection
                  title="Carrier"
                  items={filters.carriers}
                  selected={selCarriers}
                  onToggle={item => toggleItem(selCarriers, setSelCarriers, item)}
                  onToggleAll={items => toggleAll(selCarriers, setSelCarriers, items)}
                />
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 24px'}}>
                <FilterSection
                  title="Period"
                  items={filters.periods.slice(0, 12)}
                  selected={selPeriods}
                  onToggle={item => toggleItem(selPeriods, setSelPeriods, item)}
                  onToggleAll={items => toggleAll(selPeriods, setSelPeriods, items)}
                />
                <FilterSection
                  title="Type"
                  items={CLASSIFICATION_TYPES}
                  selected={selClassifications}
                  onToggle={item => toggleItem(selClassifications, setSelClassifications, item)}
                  onToggleAll={items => toggleAll(selClassifications, setSelClassifications, items)}
                />
              </div>
            </div>
          )}
        </div>

        {/* KPI Cards */}
        <div className="kpi-grid" style={{marginBottom:14}}>
          <div className="kpi-card">
            <div className="kpi-label">Total commissions</div>
            <div className="kpi-value green">{loading ? '...' : fmt(summary?.totalCommission)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Total records</div>
            <div className="kpi-value blue">{loading ? '...' : (summary?.totalRecords || 0).toLocaleString()}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Agents</div>
            <div className="kpi-value">{loading ? '...' : summary?.agentCount || 0}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Carriers</div>
            <div className="kpi-value">{loading ? '...' : summary?.carrierCount || 0}</div>
          </div>
        </div>

        {/* Charts */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14}}>
          <div className="card">
            <div className="card-title">By agent</div>
            <BarChart data={byAgentData} color="#185FA5" />
          </div>
          <div className="card">
            <div className="card-title">By carrier</div>
            <BarChart data={byCarrierData} color="#1D9E75" />
          </div>
        </div>

        {/* Agent Breakdown Table */}
        <div className="card" style={{padding:0}}>
          <div className="card-title" style={{padding:'12px 14px', borderBottom:'1px solid var(--border)'}}>Agent breakdown</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Agent</th>
                  <th>Total commission</th>
                  <th>Records</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} style={{textAlign:'center', padding:20, color:'var(--text-muted)'}}>Loading...</td></tr>
                ) : (summary?.byAgent || []).map((a, i) => (
                  <tr key={i}>
                    <td style={{color:'var(--text-muted)', fontSize:11}}>{i + 1}</td>
                    <td style={{fontWeight:500}}>{a.agent_name}</td>
                    <td style={{fontWeight:600, color: parseFloat(a.total) < 0 ? 'var(--red)' : 'var(--green)'}}>{fmt(a.total)}</td>
                    <td style={{color:'var(--text-muted)'}}>{a.count}</td>
                  </tr>
                ))}
              </tbody>
              {summary && (
                <tfoot>
                  <tr style={{background:'var(--gray-50)', fontWeight:700}}>
                    <td colSpan={2} style={{padding:'10px 12px'}}>Total</td>
                    <td style={{padding:'10px 12px', color:'var(--green)'}}>{fmt(summary.totalCommission)}</td>
                    <td style={{padding:'10px 12px', color:'var(--text-muted)'}}>{summary.totalRecords}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

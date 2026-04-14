import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  return Number(n || 0).toFixed(2) + '%';
}

const MY_AGENTS = [
  'Gina Berenguer','Jill Taylor','Katy Robles','Osmary Orozco',
  'Sabri Perez','The Health Experts Insurance','Yahoska Perez',
];
const CLASSIFICATION_TYPES = ['Agent Commission','Agency Override','Chargeback','Renewal','Override'];

function formatPeriod(p) {
  if (!p || p === 'Unknown') return null;
  const s = String(p).trim();
  if (s.match(/^\d{6}$/)) return s.slice(4,6) + '/' + s.slice(0,4);
  if (s.match(/^\d{2}\/\d{2}\/\d{4}$/)) return s.slice(0,2) + '/' + s.slice(6,10);
  if (s.match(/^\d{2}\/\d{4}$/)) return s;
  return null;
}

function BarChart({ data, color, onClickItem }) {
  if (!data || !data.length) return <div style={{color:'var(--text-muted)',fontSize:12,padding:16,textAlign:'center'}}>No data</div>;
  const max = Math.max(...data.map(d => Math.abs(parseFloat(d.total)||0)));
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {data.slice(0,8).map((d,i) => {
        const val = parseFloat(d.total)||0;
        const pct = max>0?(Math.abs(val)/max)*100:0;
        const name = d.agent_name || d.carrier || '';
        return (
          <div key={i} onClick={()=>onClickItem&&onClickItem(d)} style={{cursor:onClickItem?'pointer':'default'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
              <span style={{fontSize:13,color:onClickItem?'#185FA5':'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'65%'}} title={name}>{name}</span>
              <span style={{fontSize:13,fontWeight:600,color:val<0?'#E24B4A':color}}>{fmt(val)}</span>
            </div>
            <div style={{background:'var(--gray-100)',borderRadius:4,height:6,overflow:'hidden'}}>
              <div style={{width:`${pct}%`,background:val<0?'#E24B4A':color,height:'100%',borderRadius:4,transition:'width 0.4s ease'}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FilterGroup({ title, items, selected, onToggle, onToggleAll, format }) {
  const allSel = items.length > 0 && selected.length === items.length;
  return (
    <div style={{marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
        <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.6px',color:'var(--text-muted)'}}>{title}</span>
        <button onClick={()=>onToggleAll(items)} style={{fontSize:10,color:'#185FA5',background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:600}}>
          {allSel?'Clear all':'Select all'}
        </button>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:1}}>
        {items.map(item => {
          const label = format ? format(item) : item;
          if (!label) return null;
          const isSel = selected.includes(item);
          return (
            <button key={item} onClick={()=>onToggle(item)} style={{
              display:'flex',alignItems:'center',gap:8,padding:'5px 8px',borderRadius:6,
              border:'none',background:isSel?'var(--blue-light)':'transparent',
              cursor:'pointer',textAlign:'left',width:'100%',
              color:isSel?'#0C447C':'var(--text)',transition:'background 0.15s'
            }}>
              <span style={{width:14,height:14,borderRadius:3,flexShrink:0,border:isSel?'none':'1.5px solid var(--border)',background:isSel?'#185FA5':'transparent',display:'flex',alignItems:'center',justifyContent:'center'}}>
                {isSel && <span style={{color:'#fff',fontSize:9,lineHeight:1}}>✓</span>}
              </span>
              <span style={{fontSize:12,fontWeight:isSel?600:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard({ user, onNavigate }) {
  const [summary, setSummary] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [allFilters, setAllFilters] = useState({ agents:[], carriers:[], periods:[], planTypes:[] });
  const [loading, setLoading] = useState(false);
  const [selAgents, setSelAgents] = useState([]);
  const [selCarriers, setSelCarriers] = useState([]);
  const [selPeriods, setSelPeriods] = useState([]);
  const [selTypes, setSelTypes] = useState([]);
  const [selPlanTypes, setSelPlanTypes] = useState([]);
  const [activeView, setActiveView] = useState('kpi'); // 'kpi' or 'charts'

  useEffect(() => {
    apiFetch('/records/filters').then(d => setAllFilters(d)).catch(console.error);
  }, []);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (selAgents.length) params.set('agents', selAgents.join(','));
    if (selCarriers.length) params.set('carriers', selCarriers.join(','));
    if (selPeriods.length) params.set('periods', selPeriods.join(','));
    if (selTypes.length) params.set('classifications', selTypes.join(','));
    if (selPlanTypes.length) params.set('planTypes', selPlanTypes.join(','));
    return params;
  }, [selAgents, selCarriers, selPeriods, selTypes, selPlanTypes]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams();
      const [summaryData, kpiData] = await Promise.all([
        apiFetch(`/records/summary?${params}`),
        apiFetch(`/records/kpi?${params}`)
      ]);
      setSummary(summaryData);
      setKpi(kpiData);
    } catch(e){ console.error(e); }
    finally { setLoading(false); }
  }, [buildParams]);

  useEffect(() => { loadData(); }, [loadData]);

  function toggle(list, setList, item) { setList(p => p.includes(item) ? p.filter(x=>x!==item) : [...p, item]); }
  function toggleAll(list, setList, items) { setList(p => p.length===items.length ? [] : [...items]); }
  function clearAll() { setSelAgents([]); setSelCarriers([]); setSelPeriods([]); setSelTypes([]); setSelPlanTypes([]); }

  function drillDown(overrides = {}) {
    if (!onNavigate) return;
    onNavigate('alldata', {
      agent: overrides.agent || (selAgents.length===1 ? selAgents[0] : ''),
      carrier: overrides.carrier || (selCarriers.length===1 ? selCarriers[0] : ''),
      period: overrides.period || (selPeriods.length===1 ? selPeriods[0] : ''),
      classification: overrides.classification || (selTypes.length===1 ? selTypes[0] : ''),
    });
  }

  function exportKPI() {
    if (!kpi) return;
    const headers = ['Agent Name','Total $','Total Count','Distribution %','Advance $','Chargeback $','Chargeback Ratio','Net Sales $','Net Apps','Advance Count','Chargeback Count'];
    const rows = kpi.agents.map(a => [
      a.agent_name, fmt(a.total_commission), a.total_count, fmtPct(a.distribution_pct),
      fmt(a.advance_amount), fmt(a.chargeback_amount), fmtPct(a.chargeback_ratio),
      fmt(a.net_sales), a.new_apps, a.advance_count, a.chargeback_count
    ]);
    const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`KPIs-Dashboard-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const cleanPeriods = [];
  const seen = new Set();
  (allFilters.periods||[]).forEach(p => {
    const label = formatPeriod(p);
    if (label && !seen.has(label)) { seen.add(label); cleanPeriods.push(p); }
  });

  const hasFilters = selAgents.length||selCarriers.length||selPeriods.length||selTypes.length||selPlanTypes.length;
  const agentList = user.role==='admin' ? MY_AGENTS.filter(a=>allFilters.agents.includes(a)) : [user.name];
  const totalFiltersActive = [selAgents,selCarriers,selPeriods,selTypes,selPlanTypes].reduce((s,a)=>s+a.length,0);

  return (
    <>
      <div className="page-header">
        <div className="page-title">Dashboard</div>
        <div className="page-sub">Welcome back, {user.name.split(' ')[0]} — here's your commission overview</div>
      </div>

      <div style={{display:'flex',height:'calc(100vh - 100px)',overflow:'hidden'}}>

        {/* Left filter sidebar */}
        <div style={{width:220,minWidth:220,background:'var(--gray-50)',borderRight:'1px solid var(--border)',overflowY:'auto',padding:'16px 12px',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <span style={{fontSize:13,fontWeight:700}}>Filters</span>
            {hasFilters && <button onClick={clearAll} style={{fontSize:11,color:'#E24B4A',background:'none',border:'none',cursor:'pointer',fontWeight:600,padding:0}}>Clear</button>}
          </div>
          {hasFilters && (
            <div style={{background:'#E6F1FB',borderRadius:6,padding:'6px 8px',marginBottom:12,fontSize:11,color:'#0C447C',fontWeight:600}}>
              {totalFiltersActive} filter{totalFiltersActive!==1?'s':''} active
            </div>
          )}
          <FilterGroup title="Agent" items={agentList} selected={selAgents}
            onToggle={item=>toggle(selAgents,setSelAgents,item)}
            onToggleAll={items=>toggleAll(selAgents,setSelAgents,items)}
          />
          <div style={{borderTop:'1px solid var(--border)',marginBottom:16}}/>
          <FilterGroup title="Plan Type" items={allFilters.planTypes||[]} selected={selPlanTypes}
            onToggle={item=>toggle(selPlanTypes,setSelPlanTypes,item)}
            onToggleAll={items=>toggleAll(selPlanTypes,setSelPlanTypes,items)}
          />
          <div style={{borderTop:'1px solid var(--border)',marginBottom:16}}/>
          <FilterGroup title="Carrier" items={allFilters.carriers||[]} selected={selCarriers}
            onToggle={item=>toggle(selCarriers,setSelCarriers,item)}
            onToggleAll={items=>toggleAll(selCarriers,setSelCarriers,items)}
          />
          <div style={{borderTop:'1px solid var(--border)',marginBottom:16}}/>
          <FilterGroup title="Period" items={cleanPeriods} selected={selPeriods}
            onToggle={item=>toggle(selPeriods,setSelPeriods,item)}
            onToggleAll={items=>toggleAll(selPeriods,setSelPeriods,items)}
            format={formatPeriod}
          />
          <div style={{borderTop:'1px solid var(--border)',marginBottom:16}}/>
          <FilterGroup title="Type" items={CLASSIFICATION_TYPES} selected={selTypes}
            onToggle={item=>toggle(selTypes,setSelTypes,item)}
            onToggleAll={items=>toggleAll(selTypes,setSelTypes,items)}
          />
        </div>

        {/* Main content */}
        <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>

          {hasFilters && (
            <div style={{background:'#E6F1FB',border:'1px solid #B5D4F4',borderRadius:8,padding:'10px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,fontSize:13}}>
              <span style={{color:'#0C447C'}}>Filtered view — <strong>{(summary?.totalRecords||0).toLocaleString()} records</strong></span>
              <button onClick={()=>drillDown()} style={{background:'#185FA5',color:'#fff',border:'none',borderRadius:6,padding:'6px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                View all records →
              </button>
            </div>
          )}

          {/* KPI Cards */}
          <div className="kpi-grid" style={{marginBottom:16}}>
            <div className="kpi-card"><div className="kpi-label">Total commissions</div><div className="kpi-value green">{loading?'...':fmt(summary?.totalCommission)}</div></div>
            <div className="kpi-card"><div className="kpi-label">Total records</div><div className="kpi-value blue">{loading?'...':(summary?.totalRecords||0).toLocaleString()}</div></div>
            <div className="kpi-card"><div className="kpi-label">Agents</div><div className="kpi-value">{loading?'...':kpi?.agents?.length||0}</div></div>
            <div className="kpi-card"><div className="kpi-label">Net sales</div><div className="kpi-value green">{loading?'...':fmt(kpi?.agents?.reduce((s,a)=>s+a.net_sales,0))}</div></div>
          </div>

          {/* View toggle */}
          <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center'}}>
            <div style={{display:'flex',background:'var(--gray-100)',borderRadius:8,padding:3,gap:2}}>
              <button onClick={()=>setActiveView('kpi')} style={{padding:'5px 14px',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:activeView==='kpi'?600:400,background:activeView==='kpi'?'var(--bg)':'transparent',color:activeView==='kpi'?'var(--text)':'var(--text-muted)',boxShadow:activeView==='kpi'?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>
                KPIs
              </button>
              <button onClick={()=>setActiveView('charts')} style={{padding:'5px 14px',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:activeView==='charts'?600:400,background:activeView==='charts'?'var(--bg)':'transparent',color:activeView==='charts'?'var(--text)':'var(--text-muted)',boxShadow:activeView==='charts'?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>
                Charts
              </button>
            </div>
            {activeView==='kpi' && kpi?.agents?.length>0 && (
              <button onClick={exportKPI} style={{marginLeft:'auto',background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'5px 12px',fontSize:12,cursor:'pointer',color:'var(--text)'}}>
                ↓ Download
              </button>
            )}
          </div>

          {/* KPI Table */}
          {activeView==='kpi' && (
            <div className="card" style={{padding:0}}>
              <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',fontSize:12,color:'var(--text-muted)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Total Agents: {kpi?.agents?.length||0}</span>
              </div>
              <div className="table-wrap">
                <table style={{fontSize:12}}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Agent Name</th>
                      <th>Total $</th>
                      <th>Total Count</th>
                      <th>Distribution %</th>
                      <th>Advance $</th>
                      <th>Chargeback $</th>
                      <th>Chargeback Ratio</th>
                      <th>Net Sales $</th>
                      <th>Net Apps</th>
                      <th>Adv Count</th>
                      <th>CB Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={12} style={{textAlign:'center',padding:24,color:'var(--text-muted)'}}>Loading...</td></tr>
                    ) : (kpi?.agents||[]).map((a,i) => (
                      <tr key={i} onClick={()=>drillDown({agent:a.agent_name})} style={{cursor:'pointer'}}>
                        <td style={{color:'var(--text-muted)',fontSize:11}}>{i+1}</td>
                        <td style={{fontWeight:600,color:'#185FA5'}}>{a.agent_name}</td>
                        <td style={{fontWeight:600,color:a.total_commission<0?'var(--red)':'var(--green)'}}>{fmt(a.total_commission)}</td>
                        <td>{a.total_count.toLocaleString()}</td>
                        <td>{fmtPct(a.distribution_pct)}</td>
                        <td style={{color:a.advance_amount>0?'var(--blue)':'var(--text-muted)'}}>{fmt(a.advance_amount)}</td>
                        <td style={{color:a.chargeback_amount>0?'var(--red)':'var(--text-muted)'}}>
                          {a.chargeback_amount>0?'- ':''}
                          {fmt(a.chargeback_amount)}
                        </td>
                        <td style={{color:a.chargeback_ratio>10?'var(--red)':a.chargeback_ratio>5?'var(--amber)':'var(--text-muted)'}}>{fmtPct(a.chargeback_ratio)}</td>
                        <td style={{fontWeight:600,color:a.net_sales<0?'var(--red)':'var(--green)'}}>{fmt(a.net_sales)}</td>
                        <td>{a.new_apps}</td>
                        <td>{a.advance_count}</td>
                        <td style={{color:a.chargeback_count>0?'var(--red)':'var(--text-muted)'}}>{a.chargeback_count}</td>
                      </tr>
                    ))}
                  </tbody>
                  {kpi?.totals && (
                    <tfoot>
                      <tr style={{background:'#185FA5',color:'#fff',fontWeight:700}}>
                        <td colSpan={2} style={{padding:'10px 12px'}}>Total</td>
                        <td style={{padding:'10px 12px'}}>{fmt(kpi.totals.total_commission)}</td>
                        <td style={{padding:'10px 12px'}}>{(kpi.totals.total_count||0).toLocaleString()}</td>
                        <td style={{padding:'10px 12px'}}>100.00%</td>
                        <td style={{padding:'10px 12px'}}>{fmt(kpi.totals.advance_amount)}</td>
                        <td style={{padding:'10px 12px'}}>- {fmt(kpi.totals.chargeback_amount)}</td>
                        <td style={{padding:'10px 12px'}}>{kpi.totals.total_commission>0?fmtPct(kpi.totals.chargeback_amount/Math.abs(kpi.totals.total_commission)*100):'0.00%'}</td>
                        <td style={{padding:'10px 12px'}}>{fmt(kpi.totals.total_commission-(kpi.totals.chargeback_amount||0))}</td>
                        <td style={{padding:'10px 12px'}}>{kpi.totals.new_apps}</td>
                        <td style={{padding:'10px 12px'}}>{kpi.totals.advance_count}</td>
                        <td style={{padding:'10px 12px'}}>{kpi.totals.chargeback_count}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* Charts view */}
          {activeView==='charts' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
                <div className="card">
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                    <div className="card-title" style={{margin:0}}>By agent</div>
                    <span style={{fontSize:10,color:'var(--text-muted)'}}>Click to drill down</span>
                  </div>
                  <BarChart data={summary?.byAgent||[]} color="#185FA5" onClickItem={d=>drillDown({agent:d.agent_name})}/>
                </div>
                <div className="card">
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                    <div className="card-title" style={{margin:0}}>By carrier</div>
                    <span style={{fontSize:10,color:'var(--text-muted)'}}>Click to drill down</span>
                  </div>
                  <BarChart data={summary?.byCarrier||[]} color="#1D9E75" onClickItem={d=>drillDown({carrier:d.carrier})}/>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  return Number(n || 0).toFixed(2) + '%';
}
function fmtK(n) {
  const num = Number(n || 0);
  if (Math.abs(num) >= 1000) return '$' + (num / 1000).toFixed(1) + 'k';
  return '$' + num.toFixed(0);
}

const MY_AGENTS = [
  'Gina Berenguer','Jill Taylor','Katy Robles','Osmary Orozco',
  'Sabri Perez','The Health Experts Insurance','Yahoska Perez',
];
const CLASSIFICATION_TYPES = ['New Business','Renewal','Agent Commission','Agency Override','Chargeback'];

function formatPeriod(p) {
  if (!p || p === 'Unknown') return null;
  const s = String(p).trim();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (s.match(/^\d{6}$/)) return months[parseInt(s.slice(4,6))-1] + ' ' + s.slice(0,4);
  if (s.match(/^\d{2}\/\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(6);
  if (s.match(/^\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(3);
  return null;
}

function VerticalBarChart({ data, loading }) {
  if (loading) return <div style={{height:240,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)',fontSize:13}}>Loading...</div>;
  if (!data || !data.length) return <div style={{height:240,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)',fontSize:13}}>No data for selected filters</div>;
  const max = Math.max(...data.map(d => Math.abs(parseFloat(d.total) || 0)));
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:8,height:240,paddingBottom:32,paddingTop:12,position:'relative',overflowX:'auto'}}>
      <div style={{position:'absolute',left:0,top:0,bottom:32,display:'flex',flexDirection:'column',justifyContent:'space-between',pointerEvents:'none'}}>
        {[1,0.75,0.5,0.25,0].map(f => (
          <span key={f} style={{fontSize:11,color:'var(--text-muted)',lineHeight:1}}>{fmtK(max*f)}</span>
        ))}
      </div>
      <div style={{flex:1,display:'flex',alignItems:'flex-end',gap:6,paddingLeft:42,height:'100%'}}>
        {data.map((d, i) => {
          const val = parseFloat(d.total) || 0;
          const pct = max > 0 ? (Math.abs(val) / max) * 100 : 0;
          const label = formatPeriod(d.period || d.payment_period) || d.period || '';
          const isNeg = val < 0;
          return (
            <div key={i} style={{flex:1,minWidth:44,maxWidth:90,display:'flex',flexDirection:'column',alignItems:'center',height:'100%',justifyContent:'flex-end'}}>
              <span style={{fontSize:11,fontWeight:700,color:isNeg?'#E24B4A':'var(--text)',marginBottom:5,whiteSpace:'nowrap'}}>{fmtK(val)}</span>
              <div style={{width:'100%',height:`${pct}%`,minHeight:4,background:isNeg?'#E24B4A':'#185FA5',borderRadius:'4px 4px 0 0',transition:'height 0.4s ease'}}/>
              <span style={{fontSize:11,color:'var(--text-muted)',marginTop:7,textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',maxWidth:'100%',textOverflow:'ellipsis'}}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HBar({ data, color, onClickItem, loading }) {
  if (loading) return <div style={{padding:20,color:'var(--text-muted)',fontSize:13,textAlign:'center'}}>Loading...</div>;
  if (!data || !data.length) return <div style={{padding:20,color:'var(--text-muted)',fontSize:13,textAlign:'center'}}>No data</div>;
  const max = Math.max(...data.map(d => Math.abs(parseFloat(d.total)||0)));
  return (
    <div style={{display:'flex',flexDirection:'column',gap:11}}>
      {data.slice(0,8).map((d,i) => {
        const val = parseFloat(d.total)||0;
        const pct = max>0?(Math.abs(val)/max)*100:0;
        const name = d.agent_name || d.carrier || '';
        const isNeg = val < 0;
        return (
          <div key={i} onClick={()=>onClickItem&&onClickItem(d)} style={{cursor:onClickItem?'pointer':'default'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:13,color:onClickItem?'#185FA5':'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'65%',fontWeight:500}} title={name}>{name}</span>
              <span style={{fontSize:13,fontWeight:700,color:isNeg?'#E24B4A':color}}>{fmt(val)}</span>
            </div>
            <div style={{background:'var(--gray-100)',borderRadius:4,height:5,overflow:'hidden'}}>
              <div style={{width:`${pct}%`,background:isNeg?'#E24B4A':color,height:'100%',borderRadius:4,transition:'width 0.5s ease'}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FilterGroup({ title, items, selected, onToggle, onSelectAll, onClearAll, format }) {
  const [open, setOpen] = useState(true);
  const allSel = items.length > 0 && selected.length === items.length;
  const activeCount = selected.length;
  return (
    <div style={{marginBottom:4}}>
      <div onClick={() => setOpen(o => !o)}
        style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 0',cursor:'pointer',userSelect:'none'}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.7px',color:'var(--text-muted)'}}>{title}</span>
          {activeCount > 0 && (
            <span style={{background:'#185FA5',color:'#fff',borderRadius:10,fontSize:9,fontWeight:700,padding:'1px 6px',lineHeight:'14px'}}>{activeCount}</span>
          )}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {open && (
            <button onClick={e=>{e.stopPropagation(); allSel?onClearAll():onSelectAll(items);}}
              style={{fontSize:10,color:'#185FA5',background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:600}}>
              {allSel?'Clear':'All'}
            </button>
          )}
          <span style={{fontSize:11,color:'var(--text-muted)',lineHeight:1,display:'inline-block',transition:'transform 0.15s',transform:open?'rotate(0deg)':'rotate(-90deg)'}}>▾</span>
        </div>
      </div>
      {open && (
        <div style={{display:'flex',flexDirection:'column',gap:1,marginBottom:8}}>
          {items.map(item => {
            const label = format ? format(item) : item;
            if (!label) return null;
            const isSel = selected.includes(item);
            return (
              <label key={item} style={{display:'flex',alignItems:'center',gap:7,padding:'4px 6px',borderRadius:5,cursor:'pointer',background:isSel?'#EBF3FC':'transparent',transition:'background 0.1s'}}>
                <input type="checkbox" checked={isSel} onChange={()=>onToggle(item)}
                  style={{width:13,height:13,accentColor:'#185FA5',cursor:'pointer',flexShrink:0}} />
                <span style={{fontSize:12,color:isSel?'#0C447C':'var(--text)',fontWeight:isSel?600:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
              </label>
            );
          })}
        </div>
      )}
      <div style={{borderTop:'1px solid var(--border)',marginBottom:4}}/>
    </div>
  );
}

export default function Dashboard({ user, onNavigate }) {
  const [summary, setSummary] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [periodData, setPeriodData] = useState([]);
  const [allFilters, setAllFilters] = useState({ agents:[], carriers:[], periods:[], planTypes:[] });
  const [loading, setLoading] = useState(false);
  const [selAgents, setSelAgents] = useState([]);
  const [selCarriers, setSelCarriers] = useState([]);
  const [selPeriods, setSelPeriods] = useState([]);
  const [selTypes, setSelTypes] = useState([]);
  const [selPlanTypes, setSelPlanTypes] = useState([]);

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
      if (summaryData?.byPeriod) {
        const sorted = [...summaryData.byPeriod]
          .filter(p => p.period && p.period !== 'Unknown' && String(p.period).match(/^\d{6}$/))
          .sort((a,b) => String(a.period).localeCompare(String(b.period)))
          .slice(-12);
        setPeriodData(sorted);
      }
    } catch(e){ console.error(e); }
    finally { setLoading(false); }
  }, [buildParams]);

  useEffect(() => { loadData(); }, [loadData]);

  function toggle(list, setList, item) { setList(p => p.includes(item) ? p.filter(x=>x!==item) : [...p, item]); }
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
    const a = document.createElement('a'); a.href=url;
    a.download=`KPIs-Dashboard-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const cleanPeriods = [];
  const seenLabels = new Set();
  (allFilters.periods||[]).forEach(p => {
    const label = formatPeriod(p);
    if (label && !seenLabels.has(label)) { seenLabels.add(label); cleanPeriods.push(p); }
  });

  const agentList = user.role==='admin' ? MY_AGENTS.filter(a=>allFilters.agents.includes(a)) : [user.name];
  const hasFilters = selAgents.length||selCarriers.length||selPeriods.length||selTypes.length||selPlanTypes.length;
  const totalFiltersActive = [selAgents,selCarriers,selPeriods,selTypes,selPlanTypes].reduce((s,a)=>s+a.length,0);
  const netSales = kpi?.agents?.reduce((s,a)=>s+a.net_sales,0) || 0;
  const totalCB = kpi?.totals?.chargeback_amount || 0;
  const totalAdv = kpi?.totals?.advance_amount || 0;

  return (
    <div style={{display:'flex',height:'100vh',overflow:'hidden',background:'var(--gray-50)'}}>

      {/* Sidebar filters */}
      <div style={{width:215,minWidth:215,background:'var(--bg)',borderRight:'1px solid var(--border)',overflowY:'auto',padding:'16px 12px',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
          <span style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Filters</span>
          {hasFilters
            ? <button onClick={clearAll} style={{fontSize:11,color:'#E24B4A',background:'none',border:'none',cursor:'pointer',fontWeight:600,padding:0}}>✕ Clear all</button>
            : <span style={{fontSize:11,color:'var(--text-muted)'}}>None active</span>
          }
        </div>
        {hasFilters && (
          <div style={{background:'#EBF3FC',borderRadius:6,padding:'5px 10px',marginBottom:12,fontSize:11,color:'#185FA5',fontWeight:600}}>
            {totalFiltersActive} filter{totalFiltersActive!==1?'s':''} active
          </div>
        )}
        <FilterGroup title="Agent" items={agentList} selected={selAgents}
          onToggle={item=>toggle(selAgents,setSelAgents,item)}
          onSelectAll={items=>setSelAgents([...items])} onClearAll={()=>setSelAgents([])} />
        <FilterGroup title="Plan Type" items={allFilters.planTypes||[]} selected={selPlanTypes}
          onToggle={item=>toggle(selPlanTypes,setSelPlanTypes,item)}
          onSelectAll={items=>setSelPlanTypes([...items])} onClearAll={()=>setSelPlanTypes([])} />
        <FilterGroup title="Carrier" items={allFilters.carriers||[]} selected={selCarriers}
          onToggle={item=>toggle(selCarriers,setSelCarriers,item)}
          onSelectAll={items=>setSelCarriers([...items])} onClearAll={()=>setSelCarriers([])} />
        <FilterGroup title="Period" items={cleanPeriods} selected={selPeriods}
          onToggle={item=>toggle(selPeriods,setSelPeriods,item)}
          onSelectAll={items=>setSelPeriods([...items])} onClearAll={()=>setSelPeriods([])}
          format={formatPeriod} />
        <FilterGroup title="Type" items={CLASSIFICATION_TYPES} selected={selTypes}
          onToggle={item=>toggle(selTypes,setSelTypes,item)}
          onSelectAll={items=>setSelTypes([...items])} onClearAll={()=>setSelTypes([])} />
      </div>

      {/* Main */}
      <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'18px 24px 0',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:16}}>
            <div>
              <div style={{fontSize:22,fontWeight:700,color:'var(--text)'}}>Dashboard</div>
              <div style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
                Welcome back, {user.name.split(' ')[0]} — here's your commission overview
              </div>
            </div>
            {hasFilters && (
              <div style={{display:'flex',flexWrap:'wrap',gap:4,justifyContent:'flex-end',maxWidth:500}}>
                {[...selAgents,...selCarriers,...selPeriods.map(formatPeriod),...selTypes,...selPlanTypes].filter(Boolean).map(f=>(
                  <span key={f} style={{background:'#185FA5',color:'#fff',borderRadius:4,padding:'2px 8px',fontSize:11,fontWeight:600}}>{f}</span>
                ))}
              </div>
            )}
          </div>

          {/* KPI cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
            {[
              { label:'Total Commissions', value: fmt(summary?.totalCommission), color:'#1D9E75', sub: `${(summary?.totalRecords||0).toLocaleString()} records` },
              { label:'Net Sales', value: fmt(netSales), color:'#185FA5', sub: 'after chargebacks' },
              { label:'Chargebacks', value: fmt(totalCB), color: totalCB > 0 ? '#E24B4A' : 'var(--text-muted)', sub: totalAdv > 0 ? `${fmt(totalAdv)} advance` : 'no advances' },
              { label:'Agents', value: kpi?.agents?.length || 0, color:'var(--text)', sub: 'active this period' },
            ].map((card,i) => (
              <div key={i} style={{background:'var(--bg)',borderRadius:10,padding:'14px 18px',border:'1px solid var(--border)',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
                <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}}>{card.label}</div>
                <div style={{fontSize:24,fontWeight:800,color:card.color,lineHeight:1}}>{loading ? '—' : card.value}</div>
                <div style={{fontSize:13,color:'var(--text-muted)',marginTop:5}}>{card.sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{padding:'0 24px 24px',flex:1,display:'flex',flexDirection:'column',gap:14}}>
          {/* Bar chart */}
          <div style={{background:'var(--bg)',borderRadius:10,border:'1px solid var(--border)',padding:'16px 20px',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
              <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>Commission &amp; Count</div>
              <div style={{display:'flex',alignItems:'center',gap:14,fontSize:12,color:'var(--text-muted)'}}>
                <span style={{display:'flex',alignItems:'center',gap:4}}>
                  <span style={{width:10,height:10,borderRadius:2,background:'#185FA5',display:'inline-block'}}/>
                  Commission
                </span>
                {periodData.length > 0 && <span>{formatPeriod(periodData[0]?.period)} – {formatPeriod(periodData[periodData.length-1]?.period)}</span>}
              </div>
            </div>
            <VerticalBarChart data={periodData} loading={loading} />
          </div>

          {/* By agent + carrier */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div style={{background:'var(--bg)',borderRadius:10,border:'1px solid var(--border)',padding:'16px 20px',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
              <div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:14}}>By Agent</div>
              <HBar data={summary?.byAgent||[]} color="#185FA5" onClickItem={d=>drillDown({agent:d.agent_name})} loading={loading} />
            </div>
            <div style={{background:'var(--bg)',borderRadius:10,border:'1px solid var(--border)',padding:'16px 20px',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
              <div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:14}}>By Carrier</div>
              <HBar data={summary?.byCarrier||[]} color="#1D9E75" onClickItem={d=>drillDown({carrier:d.carrier})} loading={loading} />
            </div>
          </div>

          {/* KPI table */}
          <div style={{background:'var(--bg)',borderRadius:10,border:'1px solid var(--border)',boxShadow:'0 1px 3px rgba(0,0,0,0.04)',overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <span style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>KPIs</span>
                <span style={{fontSize:13,color:'var(--text-muted)',marginLeft:10}}>Total Agents: {kpi?.agents?.length||0}</span>
              </div>
              {kpi?.agents?.length > 0 && (
                <button onClick={exportKPI} style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'5px 12px',fontSize:12,cursor:'pointer',color:'var(--text)'}}>↓ Download</button>
              )}
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'var(--gray-50)'}}>
                    {['#','Agent Name','Total $','Total Count','Distribution %','Advance $','Chargeback $','Chargeback Ratio','Net Sales $','Net Apps','Adv Count','CB Count'].map(h => (
                      <th key={h} style={{padding:'9px 12px',textAlign:'left',fontWeight:600,fontSize:11,color:'var(--text-muted)',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={12} style={{textAlign:'center',padding:32,color:'var(--text-muted)'}}>Loading...</td></tr>
                  ) : !(kpi?.agents?.length) ? (
                    <tr><td colSpan={12} style={{textAlign:'center',padding:32,color:'var(--text-muted)'}}>No data</td></tr>
                  ) : kpi.agents.map((a,i) => (
                    <tr key={i} onClick={()=>drillDown({agent:a.agent_name})}
                      style={{cursor:'pointer',borderBottom:'1px solid var(--border)'}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--gray-50)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'9px 12px',color:'var(--text-muted)',fontSize:12}}>{i+1}</td>
                      <td style={{padding:'9px 12px',fontWeight:600,color:'#185FA5'}}>{a.agent_name}</td>
                      <td style={{padding:'9px 12px',fontWeight:700,color:a.total_commission<0?'#E24B4A':'#1D9E75'}}>{fmt(a.total_commission)}</td>
                      <td style={{padding:'9px 12px'}}>{a.total_count.toLocaleString()}</td>
                      <td style={{padding:'9px 12px',color:'var(--text-muted)'}}>{fmtPct(a.distribution_pct)}</td>
                      <td style={{padding:'9px 12px',color:a.advance_amount>0?'#185FA5':'var(--text-muted)'}}>{fmt(a.advance_amount)}</td>
                      <td style={{padding:'9px 12px',color:a.chargeback_amount>0?'#E24B4A':'var(--text-muted)'}}>
                        {a.chargeback_amount>0?'- ':''}{fmt(a.chargeback_amount)}
                      </td>
                      <td style={{padding:'9px 12px'}}>
                        <span style={{
                          background:a.chargeback_ratio>10?'#FEE2E2':a.chargeback_ratio>5?'#FEF3C7':'var(--gray-100)',
                          color:a.chargeback_ratio>10?'#B91C1C':a.chargeback_ratio>5?'#92400E':'var(--text-muted)',
                          borderRadius:4,padding:'2px 7px',fontSize:11,fontWeight:600
                        }}>{fmtPct(a.chargeback_ratio)}</span>
                      </td>
                      <td style={{padding:'9px 12px',fontWeight:700,color:a.net_sales<0?'#E24B4A':'#1D9E75'}}>{fmt(a.net_sales)}</td>
                      <td style={{padding:'9px 12px'}}>{a.new_apps}</td>
                      <td style={{padding:'9px 12px'}}>{a.advance_count}</td>
                      <td style={{padding:'9px 12px',color:a.chargeback_count>0?'#E24B4A':'var(--text-muted)',fontWeight:a.chargeback_count>0?600:400}}>{a.chargeback_count}</td>
                    </tr>
                  ))}
                </tbody>
                {kpi?.totals && !loading && (
                  <tfoot>
                    <tr style={{background:'#185FA5',fontWeight:700}}>
                      <td colSpan={2} style={{padding:'10px 12px',color:'#fff',fontSize:13}}>Total ({kpi.agents.length} agents)</td>
                      <td style={{padding:'10px 12px',color:'#fff',fontSize:13}}>{fmt(kpi.totals.total_commission)}</td>
                      <td style={{padding:'10px 12px',color:'#fff',fontSize:13}}>{(kpi.totals.total_count||0).toLocaleString()}</td>
                      <td style={{padding:'10px 12px',color:'rgba(255,255,255,0.7)',fontSize:13}}>100%</td>
                      <td style={{padding:'10px 12px',color:'#fff',fontSize:13}}>{fmt(kpi.totals.advance_amount)}</td>
                      <td style={{padding:'10px 12px',color:'#fff',fontSize:13}}>- {fmt(kpi.totals.chargeback_amount)}</td>
                      <td style={{padding:'10px 12px',color:'rgba(255,255,255,0.8)',fontSize:13}}>
                        {kpi.totals.total_commission>0?fmtPct(kpi.totals.chargeback_amount/Math.abs(kpi.totals.total_commission)*100):'0.00%'}
                      </td>
                      <td style={{padding:'10px 12px',color:'#fff',fontSize:13}}>{fmt(kpi.totals.total_commission-(kpi.totals.chargeback_amount||0))}</td>
                      <td style={{padding:'10px 12px',color:'#fff',fontSize:13}}>{kpi.totals.new_apps}</td>
                      <td style={{padding:'10px 12px',color:'#fff',fontSize:13}}>{kpi.totals.advance_count}</td>
                      <td style={{padding:'10px 12px',color:'#fff',fontSize:13}}>{kpi.totals.chargeback_count}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

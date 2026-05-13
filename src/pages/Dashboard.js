import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) { return Number(n || 0).toFixed(2) + '%'; }
function fmtK(n) {
  const num = Number(n || 0);
  if (Math.abs(num) >= 1000) return '$' + (num / 1000).toFixed(1) + 'k';
  return '$' + num.toFixed(0);
}

const MY_AGENTS = [
  'Gina Berenguer','Jill Taylor','Katy Robles','Osmary Orozco',
  'Sabri Perez','The Health Experts Insurance','Yahoska Perez',
];
const CLASSIFICATION_TYPES = ['New Business','Renewal','Agent Commission','Agency Override','Chargeback','HRA/Bonus'];

const C = {
  accent: '#C9A96E',
  accentDark: '#A8854A',
  accentLight: '#F5EDD4',
  sidebar: '#3D2B1F',
  bg: '#ffffff',
  bgSubtle: '#FAFAF8',
  border: '#EDEAE4',
  text: '#3D2B1F',
  textMuted: '#6B4F35',
  textLight: '#9E856E',
  green: '#4A7260',
  red: '#A0522D',
  barActive: '#C9A96E',
  barMuted: '#D4C4A8',
};

function formatPeriod(p) {
  if (!p || p === 'Unknown') return null;
  const s = String(p).trim();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (s.match(/^\d{6}$/)) return months[parseInt(s.slice(4,6))-1] + ' ' + s.slice(0,4);
  if (s.match(/^\d{2}\/\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(6);
  if (s.match(/^\d{2}\/\d{4}$/)) return months[parseInt(s.slice(0,2))-1] + ' ' + s.slice(3);
  return null;
}

function VerticalBarChart({ data, loading, metric }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  if (loading) return <div style={{height:220,display:'flex',alignItems:'center',justifyContent:'center',color:C.textMuted,fontSize:12}}>Loading...</div>;
  if (!data||!data.length) return <div style={{height:220,display:'flex',alignItems:'center',justifyContent:'center',color:C.textMuted,fontSize:12}}>No data</div>;

  const getValue = (d) => {
    if (metric === 'chargebacks') return Math.abs(parseFloat(d.chargebacks)||0);
    if (metric === 'apps') return parseFloat(d.count)||0;
    return parseFloat(d.total)||0;
  };

  const isNegValue = (d) => metric === 'commission' && (parseFloat(d.total)||0) < 0;
  const max = Math.max(...data.map(d => getValue(d)), 1);

  const fmtVal = (d) => {
    const v = getValue(d);
    if (metric === 'apps') return v.toLocaleString();
    const raw = metric === 'commission' ? (parseFloat(d.total)||0) : v;
    return fmtK(raw);
  };

  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:4,height:220,paddingBottom:32,paddingTop:20,position:'relative',overflowX:'auto'}}>
      <div style={{position:'absolute',left:0,top:0,bottom:32,display:'flex',flexDirection:'column',justifyContent:'space-between',pointerEvents:'none',width:38}}>
        {[1,0.5,0].map(f => (
          <span key={f} style={{fontSize:11,color:C.textMuted,lineHeight:1}}>
            {metric==='apps' ? Math.round(max*f) : fmtK(max*f)}
          </span>
        ))}
      </div>
      <div style={{flex:1,display:'flex',alignItems:'flex-end',gap:4,paddingLeft:42,height:'100%'}}>
        {data.map((d,i) => {
          const val = getValue(d);
          const pct = max>0?(val/max)*100:0;
          const label = formatPeriod(d.period||d.payment_period)||d.period||'';
          const isNeg = isNegValue(d);
          const isRecent = i >= data.length-4;
          const barColor = metric==='chargebacks' ? C.red : isNeg ? C.red : isRecent ? C.barActive : C.barMuted;
          const isHovered = hoveredIndex === i;
          return (
            <div key={i} 
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{flex:1,minWidth:44,maxWidth:90,display:'flex',flexDirection:'column',alignItems:'center',height:'100%',justifyContent:'flex-end',position:'relative',cursor:'default'}}>
              {isHovered && (
                <div style={{position:'absolute',top:-50,left:'50%',transform:'translateX(-50%)',background:C.sidebar,color:'#fff',padding:'6px 10px',borderRadius:6,fontSize:11,fontWeight:500,whiteSpace:'nowrap',zIndex:10,boxShadow:'0 2px 8px rgba(0,0,0,0.15)',pointerEvents:'none'}}>
                  <div>{label}</div>
                  <div style={{marginTop:2}}>{metric==='apps'?`${val.toLocaleString()} apps`:fmt(parseFloat(d.total||d.chargebacks)||0)}</div>
                  <div style={{marginTop:1,fontSize:9,opacity:0.7}}>{d.count||0} records</div>
                </div>
              )}
              <span style={{fontSize:12,fontWeight:500,color:isNeg||metric==='chargebacks'?C.red:C.text,marginBottom:4,whiteSpace:'nowrap'}}>{fmtVal(d)}</span>
              <div style={{width:'60%',height:`${Math.max(pct,0)}%`,minHeight:3,background:barColor,borderRadius:'3px 3px 0 0',transition:'height 0.4s ease,opacity 0.2s',opacity:isHovered?1:0.9}}/>
              <span style={{fontSize:12,color:C.text,marginTop:8,textAlign:'center',whiteSpace:'nowrap'}}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HBar({ data, color, onClickItem, loading }) {
  if (loading) return <div style={{padding:20,color:C.textMuted,fontSize:12,textAlign:'center'}}>Loading...</div>;
  if (!data||!data.length) return <div style={{padding:20,color:C.textMuted,fontSize:12,textAlign:'center'}}>No data</div>;
  const max = Math.max(...data.map(d => Math.abs(parseFloat(d.total)||0)));
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {data.slice(0,8).map((d,i) => {
        const val = parseFloat(d.total)||0;
        const pct = max>0?(Math.abs(val)/max)*100:0;
        const name = d.agent_name||d.carrier||'';
        const isNeg = val<0;
        return (
          <div key={i} onClick={()=>onClickItem&&onClickItem(d)} style={{cursor:onClickItem?'pointer':'default'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:14,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'65%',fontWeight:500}} title={name}>{name}</span>
              <span style={{fontSize:14,fontWeight:500,color:isNeg?C.red:C.text}}>{fmt(val)}</span>
            </div>
            <div style={{background:C.accentLight,borderRadius:3,height:4,overflow:'hidden'}}>
              <div style={{width:`${pct}%`,background:isNeg?C.red:color,height:'100%',borderRadius:3,transition:'width 0.5s ease'}}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FilterGroup({ title, items, selected, onToggle, onSelectAll, onClearAll, format }) {
  const [open, setOpen] = useState(false);
  const allSel = items.length>0 && selected.length===items.length;
  const activeCount = selected.length;
  return (
    <div style={{marginBottom:4}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'7px 0',cursor:'pointer',userSelect:'none'}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:10,fontWeight:500,textTransform:'uppercase',letterSpacing:'0.7px',color:C.textMuted}}>{title}</span>
          {activeCount>0 && <span style={{background:C.accent,color:C.sidebar,borderRadius:10,fontSize:9,fontWeight:500,padding:'1px 6px',lineHeight:'14px'}}>{activeCount}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {open && <button onClick={e=>{e.stopPropagation();allSel?onClearAll():onSelectAll(items);}} style={{fontSize:10,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0,fontWeight:500}}>{allSel?'Clear':'All'}</button>}
          <span style={{fontSize:11,color:C.textLight,lineHeight:1,display:'inline-block',transition:'transform 0.15s',transform:open?'rotate(0deg)':'rotate(-90deg)'}}>▾</span>
        </div>
      </div>
      {open && (
        <div style={{display:'flex',flexDirection:'column',gap:1,marginBottom:8}}>
          {items.map(item => {
            const label = format?format(item):item;
            if (!label) return null;
            const isSel = selected.includes(item);
            return (
              <label key={item} style={{display:'flex',alignItems:'center',gap:7,padding:'4px 6px',borderRadius:5,cursor:'pointer',background:isSel?C.accentLight:'transparent',transition:'background 0.1s'}}>
                <input type="checkbox" checked={isSel} onChange={()=>onToggle(item)} style={{width:13,height:13,accentColor:C.accent,cursor:'pointer',flexShrink:0}}/>
                <span style={{fontSize:12,color:isSel?C.accentDark:C.text,fontWeight:isSel?500:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
              </label>
            );
          })}
        </div>
      )}
      <div style={{borderTop:`0.5px solid ${C.border}`,marginBottom:4}}/>
    </div>
  );
}

export default function Dashboard({ user, onNavigate }) {
  const agencyView = user.agency || '';
  const [summary, setSummary] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [periodData, setPeriodData] = useState([]);
  const [allFilters, setAllFilters] = useState({ agents:[], carriers:[], periods:[], planTypes:[] });
  const [loading, setLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState('commission');
  const [kpiSortCol, setKpiSortCol] = useState('total_commission');
  const [kpiSortDir, setKpiSortDir] = useState('desc');
  const [chartRange, setChartRange] = useState(12);
  const [selAgents, setSelAgents] = useState([]);
  const [selCarriers, setSelCarriers] = useState([]);
  const [selPeriods, setSelPeriods] = useState([]);
  const [selTypes, setSelTypes] = useState([]);
  const [selPlanTypes, setSelPlanTypes] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [prevPeriodData, setPrevPeriodData] = useState(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  function handleKpiSort(col) {
    if (kpiSortCol === col) setKpiSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setKpiSortCol(col); setKpiSortDir('desc'); }
  }

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (selAgents.length) p.set('agents', selAgents.join(','));
    if (selCarriers.length) p.set('carriers', selCarriers.join(','));
    if (selPeriods.length) p.set('periods', selPeriods.join(','));
    if (selTypes.length) p.set('classifications', selTypes.join(','));
    if (selPlanTypes.length) p.set('planTypes', selPlanTypes.join(','));
    return p;
  }, [selAgents, selCarriers, selPeriods, selTypes, selPlanTypes]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams();
      const [s, k] = await Promise.all([apiFetch(`/records/summary?${params}`), apiFetch(`/records/kpi?${params}`)]);
      setSummary(s); setKpi(k);
      if (s?.byPeriod) {
        const sorted = [...s.byPeriod].filter(p=>p.period&&p.period!=='Unknown'&&String(p.period).match(/^\d{6}$/)).sort((a,b)=>String(a.period).localeCompare(String(b.period)));
        setPeriodData(sorted.slice(-chartRange));
        // Calculate previous period comparison
        const currentPeriods = sorted.slice(-chartRange);
        const prevStart = Math.max(0, sorted.length - chartRange * 2);
        const prevPeriods = sorted.slice(prevStart, sorted.length - chartRange);
        if (prevPeriods.length > 0) {
          const currentTotal = currentPeriods.reduce((sum, p) => sum + (parseFloat(p.total) || 0), 0);
          const prevTotal = prevPeriods.reduce((sum, p) => sum + (parseFloat(p.total) || 0), 0);
          const currentCB = currentPeriods.reduce((sum, p) => sum + Math.abs(parseFloat(p.chargebacks) || 0), 0);
          const prevCB = prevPeriods.reduce((sum, p) => sum + Math.abs(parseFloat(p.chargebacks) || 0), 0);
          setPrevPeriodData({ total: prevTotal, chargebacks: prevCB, current: { total: currentTotal, chargebacks: currentCB } });
        } else {
          setPrevPeriodData(null);
        }
      }
    } catch(e){ console.error(e); }
    finally { setLoading(false); }
  }, [buildParams, agencyView, chartRange]);

  // On load/agency switch: default to current year periods
  useEffect(() => {
    setSelAgents([]); setSelCarriers([]); setSelTypes([]); setSelPlanTypes([]);
    apiFetch('/records/filters').then(d => {
      setAllFilters(d);
      // Auto-select all periods from current year
      const currentYear = new Date().getFullYear().toString();
      const currentYearPeriods = (d.periods || []).filter(p =>
        String(p).match(/^\d{6}$/) && String(p).startsWith(currentYear)
      );
      setSelPeriods(currentYearPeriods);
    }).catch(console.error);
  }, [agencyView]);

  useEffect(() => { loadData(); }, [loadData]);

  // Close quick actions menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (quickActionsOpen && !e.target.closest('[data-quick-actions]')) {
        setQuickActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [quickActionsOpen]);

  function toggle(list, setList, item) { setList(p=>p.includes(item)?p.filter(x=>x!==item):[...p,item]); }
  function clearAll() { setSelAgents([]); setSelCarriers([]); setSelPeriods([]); setSelTypes([]); setSelPlanTypes([]); }

  function drillDown(overrides={}) {
    if (!onNavigate) return;
    onNavigate('alldata', {
      agent: overrides.agent||(selAgents.length===1?selAgents[0]:''),
      carrier: overrides.carrier||(selCarriers.length===1?selCarriers[0]:''),
      period: overrides.period||(selPeriods.length===1?selPeriods[0]:''),
      classification: overrides.classification||(selTypes.length===1?selTypes[0]:''),
    });
  }

  function exportKPI() {
    if (!kpi) return;
    const headers = ['Agent Name','Total $','Total Count','Distribution %','Advance $','Chargeback $','Chargeback Ratio','Net Sales $','Net Apps','Advance Count','Chargeback Count'];
    const rows = kpi.agents.map(a=>[a.agent_name,fmt(a.total_commission),a.total_count,fmtPct(a.distribution_pct),fmt(a.advance_amount),fmt(a.chargeback_amount),fmtPct(a.chargeback_ratio),fmt(a.net_sales),a.new_apps,a.advance_count,a.chargeback_count]);
    const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`KPIs-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const cleanPeriods = [];
  const seenLabels = new Set();
  (allFilters.periods||[]).forEach(p => { const l=formatPeriod(p); if(l&&!seenLabels.has(l)){seenLabels.add(l);cleanPeriods.push(p);} });

  const agentList = user.role==='admin'?MY_AGENTS.filter(a=>allFilters.agents.includes(a)):[user.name];
  const hasFilters = selAgents.length||selCarriers.length||selPeriods.length||selTypes.length||selPlanTypes.length;
  const totalFiltersActive = [selAgents,selCarriers,selPeriods,selTypes,selPlanTypes].reduce((s,a)=>s+a.length,0);
  const netSales = kpi?.agents?.reduce((s,a)=>s+a.net_sales,0)||0;
  const totalCB = kpi?.totals?.chargeback_amount||0;
  const totalAdv = kpi?.totals?.advance_amount||0;
  const card = {background:C.bg,borderRadius:10,border:`0.5px solid ${C.border}`,padding:'16px 20px'};

  const currentYear = new Date().getFullYear().toString();

  return (
    <div style={{display:'flex',height:'100vh',overflow:'hidden',background:C.bgSubtle}}>

      {/* Filter sidebar */}
      <div style={{width:sidebarCollapsed?50:210,minWidth:sidebarCollapsed?50:210,background:C.bg,borderRight:`0.5px solid ${C.border}`,overflowY:'auto',padding:sidebarCollapsed?'16px 8px':'16px 12px',flexShrink:0,transition:'width 0.3s ease, min-width 0.3s ease'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
          <button 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{background:C.accent,color:C.sidebar,border:'none',borderRadius:6,padding:'6px 8px',cursor:'pointer',fontSize:16,lineHeight:1,fontWeight:500,display:'flex',alignItems:'center',justifyContent:'center',width:sidebarCollapsed?'100%':'auto'}}
            title={sidebarCollapsed ? 'Expand filters' : 'Collapse filters'}
          >
            {sidebarCollapsed ? '☰' : '‹'}
          </button>
          {!sidebarCollapsed && (
            <>
              {hasFilters
                ? <button onClick={clearAll} style={{fontSize:11,color:C.red,background:'none',border:'none',cursor:'pointer',fontWeight:500,padding:0}}>✕ Clear all</button>
                : <span style={{fontSize:11,color:C.textLight}}>None active</span>
              }
            </>
          )}
        </div>
        {!sidebarCollapsed && (
          <>
            {hasFilters && (
              <div style={{background:C.accentLight,borderRadius:6,padding:'5px 10px',marginBottom:12,fontSize:11,color:C.accentDark,fontWeight:500,border:`0.5px solid #E8D9B8`}}>
                {totalFiltersActive} filter{totalFiltersActive!==1?'s':''} active
              </div>
            )}
            <FilterGroup title="Agent" items={agentList} selected={selAgents} onToggle={item=>toggle(selAgents,setSelAgents,item)} onSelectAll={items=>setSelAgents([...items])} onClearAll={()=>setSelAgents([])}/>
            <FilterGroup title="Plan Type" items={allFilters.planTypes||[]} selected={selPlanTypes} onToggle={item=>toggle(selPlanTypes,setSelPlanTypes,item)} onSelectAll={items=>setSelPlanTypes([...items])} onClearAll={()=>setSelPlanTypes([])}/>
            <FilterGroup title="Carrier" items={allFilters.carriers||[]} selected={selCarriers} onToggle={item=>toggle(selCarriers,setSelCarriers,item)} onSelectAll={items=>setSelCarriers([...items])} onClearAll={()=>setSelCarriers([])}/>
            <FilterGroup title="Period" items={cleanPeriods} selected={selPeriods} onToggle={item=>toggle(selPeriods,setSelPeriods,item)} onSelectAll={items=>setSelPeriods([...items])} onClearAll={()=>setSelPeriods([])} format={formatPeriod}/>
            <FilterGroup title="Type" items={CLASSIFICATION_TYPES} selected={selTypes} onToggle={item=>toggle(selTypes,setSelTypes,item)} onSelectAll={items=>setSelTypes([...items])} onClearAll={()=>setSelTypes([])}/>
          </>
        )}
        {sidebarCollapsed && hasFilters && (
          <div style={{background:C.accent,color:C.sidebar,borderRadius:6,padding:'4px',marginTop:8,fontSize:10,fontWeight:600,textAlign:'center',lineHeight:1.2}}>
            {totalFiltersActive}
          </div>
        )}
      </div>

      {/* Main */}
      <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'18px 24px 0',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:16}}>
            <div>
              <div style={{fontSize:20,fontWeight:500,color:C.text}}>Dashboard</div>
              <div style={{fontSize:13,color:C.text,marginTop:2}}>Welcome back, {user.name.split(' ')[0]} — here's your {currentYear} commission overview</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              {hasFilters && (
                <div style={{display:'flex',flexWrap:'wrap',gap:4,justifyContent:'flex-end',maxWidth:400}}>
                  {[...selAgents,...selCarriers,...selPeriods.map(formatPeriod),...selTypes,...selPlanTypes].filter(Boolean).map(f=>(
                    <span key={f} style={{background:C.accent,color:C.sidebar,borderRadius:4,padding:'2px 8px',fontSize:11,fontWeight:500}}>{f}</span>
                  ))}
                </div>
              )}
              <div style={{position:'relative'}} data-quick-actions>
                <button 
                  onClick={() => setQuickActionsOpen(!quickActionsOpen)}
                  style={{background:C.accent,color:C.sidebar,border:'none',borderRadius:8,padding:'8px 14px',cursor:'pointer',fontSize:13,fontWeight:600,display:'flex',alignItems:'center',gap:6,boxShadow:'0 1px 3px rgba(0,0,0,0.1)',transition:'transform 0.1s'}}
                  onMouseEnter={e=>e.target.style.transform='scale(1.02)'}
                  onMouseLeave={e=>e.target.style.transform='scale(1)'}
                >
                  <span>⚡</span> Quick Actions
                </button>
                {quickActionsOpen && (
                  <div style={{position:'absolute',right:0,top:'100%',marginTop:6,background:C.bg,border:`0.5px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 12px rgba(0,0,0,0.15)',minWidth:180,zIndex:100}}>
                    <div style={{padding:6}}>
                      {user.role === 'admin' && (
                        <button onClick={() => { setQuickActionsOpen(false); onNavigate && onNavigate('upload'); }} style={{width:'100%',textAlign:'left',background:'none',border:'none',padding:'8px 12px',cursor:'pointer',fontSize:13,color:C.text,borderRadius:6,display:'flex',alignItems:'center',gap:8}} onMouseEnter={e=>e.target.style.background=C.bgSubtle} onMouseLeave={e=>e.target.style.background='none'}>
                          <span>↑</span> Upload Statement
                        </button>
                      )}
                      <button onClick={() => { setQuickActionsOpen(false); exportKPI(); }} style={{width:'100%',textAlign:'left',background:'none',border:'none',padding:'8px 12px',cursor:'pointer',fontSize:13,color:C.text,borderRadius:6,display:'flex',alignItems:'center',gap:8}} onMouseEnter={e=>e.target.style.background=C.bgSubtle} onMouseLeave={e=>e.target.style.background='none'}>
                        <span>↓</span> Export KPIs
                      </button>
                      <button onClick={() => { setQuickActionsOpen(false); onNavigate && onNavigate('alldata'); }} style={{width:'100%',textAlign:'left',background:'none',border:'none',padding:'8px 12px',cursor:'pointer',fontSize:13,color:C.text,borderRadius:6,display:'flex',alignItems:'center',gap:8}} onMouseEnter={e=>e.target.style.background=C.bgSubtle} onMouseLeave={e=>e.target.style.background='none'}>
                        <span>📊</span> View All Data
                      </button>
                      {user.role === 'admin' && (
                        <button onClick={() => { setQuickActionsOpen(false); onNavigate && onNavigate('reports'); }} style={{width:'100%',textAlign:'left',background:'none',border:'none',padding:'8px 12px',cursor:'pointer',fontSize:13,color:C.text,borderRadius:6,display:'flex',alignItems:'center',gap:8}} onMouseEnter={e=>e.target.style.background=C.bgSubtle} onMouseLeave={e=>e.target.style.background='none'}>
                          <span>📈</span> Reports
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
            {(() => {
              const calcChange = (current, prev) => {
                if (!prev || prev === 0) return null;
                const change = ((current - prev) / Math.abs(prev)) * 100;
                return change;
              };
              const currentTotal = summary?.totalCommission || 0;
              const currentCB = totalCB;
              const prevTotal = prevPeriodData?.total || 0;
              const prevCB = prevPeriodData?.chargebacks || 0;
              const totalChange = calcChange(currentTotal, prevTotal);
              const cbChange = calcChange(currentCB, prevCB);
              
              return [
                {label:'Total Commissions', value:fmt(summary?.totalCommission), color:C.green, sub:`${(summary?.totalRecords||0).toLocaleString()} records`, change: totalChange},
                {label:'Net Sales', value:fmt(netSales), color:C.accentDark, sub:'after chargebacks', change: null},
                {label:'Chargebacks', value:fmt(totalCB), color:totalCB>0?C.red:C.textMuted, sub:totalAdv>0?`${fmt(totalAdv)} advance`:'no advances', change: cbChange},
                {label:'Agents', value:kpi?.agents?.length||0, color:C.text, sub:'active this period', change: null},
              ].map((c,i)=>(
                <div key={i} style={{...card,padding:'16px 20px'}}>
                  <div style={{fontSize:10,color:C.textMuted,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:8}}>{c.label}</div>
                  <div style={{fontSize:28,fontWeight:600,color:c.color,lineHeight:1.1,marginBottom:6}}>{loading?'—':c.value}</div>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4}}>
                    <div style={{fontSize:11,color:C.textMuted}}>{c.sub}</div>
                    {c.change !== null && c.change !== undefined && !loading && (
                      <div style={{fontSize:11,fontWeight:600,color:c.change>0?C.green:c.change<0?C.red:C.textMuted,background:c.change>0?'rgba(74,114,96,0.1)':c.change<0?'rgba(160,82,45,0.1)':'transparent',padding:'2px 6px',borderRadius:4}}>
                        {c.change>0?'↑':'↓'} {Math.abs(c.change).toFixed(1)}%
                      </div>
                    )}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>

        <div style={{padding:'0 24px 24px',flex:1,display:'flex',flexDirection:'column',gap:14}}>
          <div style={card}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:8}}>
              <div style={{fontSize:13,fontWeight:500,color:C.text}}>Commission & Count</div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <div style={{display:'flex',borderRadius:6,border:`0.5px solid ${C.border}`,overflow:'hidden'}}>
                  {[['commission','Commission'],['chargebacks','Chargebacks'],['apps','App Count']].map(([m,l])=>(
                    <button key={m} onClick={()=>setChartMetric(m)} style={{
                      padding:'4px 10px',fontSize:11,border:'none',cursor:'pointer',fontWeight:chartMetric===m?500:400,
                      background:chartMetric===m?C.accent:'transparent',
                      color:chartMetric===m?C.sidebar:C.textMuted,transition:'all 0.15s'
                    }}>{l}</button>
                  ))}
                </div>
                <div style={{display:'flex',borderRadius:6,border:`0.5px solid ${C.border}`,overflow:'hidden'}}>
                  {[[6,'6mo'],[12,'12mo'],[24,'24mo']].map(([r,l])=>(
                    <button key={r} onClick={()=>setChartRange(r)} style={{
                      padding:'4px 10px',fontSize:11,border:'none',cursor:'pointer',fontWeight:chartRange===r?500:400,
                      background:chartRange===r?C.bgSubtle:'transparent',
                      color:chartRange===r?C.text:C.textMuted,transition:'all 0.15s'
                    }}>{l}</button>
                  ))}
                </div>
                <span style={{fontSize:11,color:C.textLight}}>
                  {periodData.length>0 ? `${formatPeriod(periodData[0]?.period)} – ${formatPeriod(periodData[periodData.length-1]?.period)}` : ''}
                </span>
              </div>
            </div>
            <VerticalBarChart data={periodData} loading={loading} metric={chartMetric}/>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div style={card}>
              <div style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:14}}>By Agent</div>
              <HBar data={summary?.byAgent||[]} color={C.accentDark} onClickItem={d=>drillDown({agent:d.agent_name})} loading={loading}/>
            </div>
            <div style={card}>
              <div style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:14}}>By Carrier</div>
              <HBar data={summary?.byCarrier||[]} color={C.green} onClickItem={d=>drillDown({carrier:d.carrier})} loading={loading}/>
            </div>
          </div>

          <div style={{...card,padding:0,overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:`0.5px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <span style={{fontSize:14,fontWeight:500,color:C.text}}>KPIs</span>
                <span style={{fontSize:12,color:C.textMuted,marginLeft:10}}>Total Agents: {kpi?.agents?.length||0}</span>
              </div>
              {kpi?.agents?.length>0&&<button onClick={exportKPI} style={{background:'none',border:`0.5px solid ${C.border}`,borderRadius:6,padding:'5px 12px',fontSize:12,cursor:'pointer',color:C.text}}>↓ Download</button>}
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{background:C.bgSubtle}}>
                    {[
                      ['#', null],
                      ['Agent Name','agent_name'],
                      ['Total','total_commission'],
                      ['Count','total_count'],
                      ['Distribution %','distribution_pct'],
                      ['Advance','advance_amount'],
                      ['Chargeback','chargeback_amount'],
                      ['CB Ratio', agencyView.toLowerCase().includes('broker') ? 'cb_count_ratio' : 'chargeback_ratio'],
                      ['Net Sales','net_sales'],
                      ['Net Apps','new_apps'],
                      ['Adv Count','advance_count'],
                      ['CB Count','chargeback_count']
                    ].map(([h, col]) => (
                      <th key={h} onClick={col ? ()=>handleKpiSort(col) : undefined}
                        style={{padding:'9px 12px',textAlign:'left',fontWeight:500,fontSize:11,color:C.textMuted,
                          borderBottom:`0.5px solid ${C.border}`,whiteSpace:'nowrap',
                          cursor:col?'pointer':'default',userSelect:'none'}}>
                        {h} {col && (kpiSortCol===col ? (kpiSortDir==='asc'?'↑':'↓') : <span style={{opacity:0.3}}>↕</span>)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading?<tr><td colSpan={12} style={{textAlign:'center',padding:32,color:C.textMuted}}>Loading...</td></tr>
                  :!(kpi?.agents?.length)?<tr><td colSpan={12} style={{textAlign:'center',padding:32,color:C.textMuted}}>No data</td></tr>
                  :[...(kpi.agents||[])].sort((a,b) => {
                      const av = a[kpiSortCol] ?? 0;
                      const bv = b[kpiSortCol] ?? 0;
                      if (typeof av === 'string') return kpiSortDir==='asc' ? av.localeCompare(bv) : bv.localeCompare(av);
                      return kpiSortDir==='asc' ? av - bv : bv - av;
                    }).map((a,i)=>(
                    <tr key={i} onClick={()=>drillDown({agent:a.agent_name})} style={{cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}}
                      onMouseEnter={e=>e.currentTarget.style.background=C.bgSubtle}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'9px 12px',color:C.textMuted,fontSize:11}}>{i+1}</td>
                      <td style={{padding:'9px 12px',fontWeight:500,color:C.text,fontSize:13}}>
                        {a.agent_name}
                        {agencyView.toLowerCase().includes('broker') && a.total_count > 0 && (
                          <span style={{marginLeft:6,background:'var(--accent-light)',color:'var(--accent-dark)',borderRadius:10,padding:'1px 7px',fontSize:10,fontWeight:500}}>{a.total_count} pol.</span>
                        )}
                      </td>
                      <td style={{padding:'9px 12px',fontWeight:500,color:a.total_commission<0?C.red:C.green,fontSize:13}}>{fmt(a.total_commission)}</td>
                      <td style={{padding:'9px 12px',color:C.text}}>{a.total_count.toLocaleString()}</td>
                      <td style={{padding:'9px 12px',color:C.text}}>{fmtPct(a.distribution_pct)}</td>
                      <td style={{padding:'9px 12px',color:a.advance_amount>0?C.accentDark:C.text}}>{fmt(a.advance_amount)}</td>
                      <td style={{padding:'9px 12px',color:a.chargeback_amount>0?C.red:C.text}}>{a.chargeback_amount>0?'- ':''}{fmt(a.chargeback_amount)}</td>
                      <td style={{padding:'9px 12px'}}>
                        {agencyView.toLowerCase().includes('broker') ? (
                          (() => {
                            const cbRatio = a.total_count > 0 ? (a.chargeback_count / a.total_count) * 100 : 0;
                            return <span style={{background:cbRatio>10?'#F5EAE4':cbRatio>5?'#F5EDD4':C.bgSubtle,color:cbRatio>10?'#7A3D1F':cbRatio>5?'#6B4E0A':C.textMuted,borderRadius:4,padding:'2px 7px',fontSize:11,fontWeight:500}}>{fmtPct(cbRatio)}</span>;
                          })()
                        ) : (
                          <span style={{background:a.chargeback_ratio>10?'#F5EAE4':a.chargeback_ratio>5?'#F5EDD4':C.bgSubtle,color:a.chargeback_ratio>10?'#7A3D1F':a.chargeback_ratio>5?'#6B4E0A':C.textMuted,borderRadius:4,padding:'2px 7px',fontSize:11,fontWeight:500}}>{fmtPct(a.chargeback_ratio)}</span>
                        )}
                      </td>
                      <td style={{padding:'9px 12px',fontWeight:500,color:a.net_sales<0?C.red:C.green}}>{fmt(a.net_sales)}</td>
                      <td style={{padding:'9px 12px',color:C.text}}>{a.new_apps}</td>
                      <td style={{padding:'9px 12px',color:C.text}}>{a.advance_count}</td>
                      <td style={{padding:'9px 12px',color:a.chargeback_count>0?C.red:C.text,fontWeight:a.chargeback_count>0?500:400}}>{a.chargeback_count}</td>
                    </tr>
                  ))
                  }
                </tbody>
                {kpi?.totals&&!loading&&(
                  <tfoot>
                    <tr style={{background:C.accentDark,fontWeight:500}}>
                      <td colSpan={2} style={{padding:'10px 12px',color:'#F5EDD4',fontSize:12}}>Total ({kpi.agents.length} agents)</td>
                      <td style={{padding:'10px 12px',color:'#F5EDD4',fontSize:12}}>{fmt(kpi.totals.total_commission)}</td>
                      <td style={{padding:'10px 12px',color:'#F5EDD4',fontSize:12}}>{(kpi.totals.total_count||0).toLocaleString()}</td>
                      <td style={{padding:'10px 12px',color:'rgba(245,237,212,0.6)',fontSize:12}}>100%</td>
                      <td style={{padding:'10px 12px',color:'#F5EDD4',fontSize:12}}>{fmt(kpi.totals.advance_amount)}</td>
                      <td style={{padding:'10px 12px',color:'#F5EDD4',fontSize:12}}>- {fmt(kpi.totals.chargeback_amount)}</td>
                      <td style={{padding:'10px 12px',color:'rgba(245,237,212,0.7)',fontSize:12}}>{kpi.totals.total_commission>0?fmtPct(kpi.totals.chargeback_amount/Math.abs(kpi.totals.total_commission)*100):'0.00%'}</td>
                      <td style={{padding:'10px 12px',color:'#F5EDD4',fontSize:12}}>{fmt(kpi.totals.total_commission-(kpi.totals.chargeback_amount||0))}</td>
                      <td style={{padding:'10px 12px',color:'#F5EDD4',fontSize:12}}>{kpi.totals.new_apps}</td>
                      <td style={{padding:'10px 12px',color:'#F5EDD4',fontSize:12}}>{kpi.totals.advance_count}</td>
                      <td style={{padding:'10px 12px',color:'#F5EDD4',fontSize:12}}>{kpi.totals.chargeback_count}</td>
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

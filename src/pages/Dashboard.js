import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import { formatCarrier } from '../utils/formatCarrier';
import {
  DASHBOARD_MY_AGENTS,
  DASHBOARD_PRINCIPAL_AGENTS,
  THEI_DIRECT_AGENTS,
} from '../theiPrincipalAgents';

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) { return Number(n || 0).toFixed(2) + '%'; }
function fmtK(n) {
  const num = Number(n || 0);
  if (Math.abs(num) >= 1000) return '$' + (num / 1000).toFixed(1) + 'k';
  return '$' + num.toFixed(0);
}

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
          return (
            <div key={i}
              style={{flex:1,minWidth:44,maxWidth:90,display:'flex',flexDirection:'column',alignItems:'center',height:'100%',justifyContent:'flex-end',position:'relative'}}>
              <span style={{fontSize:12,fontWeight:500,color:isNeg||metric==='chargebacks'?C.red:C.text,marginBottom:4,whiteSpace:'nowrap'}}>{fmtVal(d)}</span>
              <div style={{width:'60%',height:`${Math.max(pct,0)}%`,minHeight:3,background:barColor,borderRadius:'3px 3px 0 0',transition:'height 0.4s ease'}}/>
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
        const name = d.agent_name || (d.carrier ? formatCarrier(d.carrier) : '');
        const isNeg = val<0;
        return (
          <div key={i} onClick={()=>onClickItem&&onClickItem(d)} style={{cursor:onClickItem?'pointer':'default'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:14,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'65%',fontWeight:500}}>{name}</span>
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

function formatPeriodRange(periods) {
  if (!periods?.length) return 'All periods';
  const sorted = [...periods].filter((p) => String(p).match(/^\d{6}$/)).sort();
  if (!sorted.length) return 'All periods';
  if (sorted.length === 1) return formatPeriod(sorted[0]);
  return `${formatPeriod(sorted[0])} – ${formatPeriod(sorted[sorted.length - 1])}`;
}

function dashboardBookLabel(agencyView) {
  return (agencyView || '').toLowerCase().includes('broker') ? 'BSI' : 'THEI';
}

function dashboardLensLabel(viewMode) {
  return viewMode === 'agent' ? 'Principal production' : 'Agency';
}

function lobFilterLabel(code) {
  if (code === 'MA' || code === 'MedSupp') return 'Medicare';
  return code;
}

/** Trend: later half vs earlier half of the filtered period range. */
function periodHalfTrend(periodRows, valueKey = 'total') {
  const rows = (periodRows || []).filter((p) => p.period && String(p.period).match(/^\d{6}$/));
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const mid = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, mid);
  const second = sorted.slice(mid);
  const sum = (list) =>
    list.reduce((s, p) => {
      const v =
        valueKey === 'chargebacks'
          ? Math.abs(parseFloat(p.chargebacks) || 0)
          : parseFloat(p.total) || 0;
      return s + v;
    }, 0);
  const sumFirst = sum(first);
  const sumSecond = sum(second);
  if (!sumFirst) return null;
  return ((sumSecond - sumFirst) / Math.abs(sumFirst)) * 100;
}

function HouseSplitWidget({ data, loading, bookLabel }) {
  if (loading) {
    return (
      <div style={{ ...{ background: C.bg, borderRadius: 10, border: `0.5px solid ${C.border}`, padding: '16px 20px' }, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: C.textMuted }}>Loading house split…</div>
      </div>
    );
  }
  if (!data?.totals) return null;
  const t = data.totals;
  const items = [
    { label: 'Gross pot', value: t.gross, color: C.text },
    { label: 'THEI share', value: t.thei_share, color: C.green },
    { label: 'BSI share', value: t.bsi_share, color: C.accentDark },
    { label: 'Producer payable', value: t.producer_payable, color: C.textMuted },
  ];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        House split · {bookLabel} book · override 50/50 + agent pass-through
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {items.map((item) => (
          <div key={item.label} style={{ background: C.bg, borderRadius: 10, border: `0.5px solid ${C.border}`, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>
              {item.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: item.color, lineHeight: 1.1 }}>{fmt(item.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function lobCardMetrics(lobData, lobName, viewMode) {
  const isACA = lobName === 'ACA';
  if (isACA && viewMode === 'agency') {
    return {
      amount: parseFloat(lobData.thei_total || 0),
      count: parseInt(lobData.override_count ?? lobData.count ?? 0, 10),
    };
  }
  if (isACA && viewMode === 'agent') {
    return {
      amount: parseFloat(lobData.agent_payable || 0),
      count: parseInt(lobData.count || 0, 10),
    };
  }
  if (viewMode === 'agency') {
    return {
      amount: parseFloat(lobData.thei_total || lobData.total || 0),
      count: parseInt(lobData.count || 0, 10),
    };
  }
  return {
    amount: parseFloat(lobData.agent_payable || lobData.total || 0),
    count: parseInt(lobData.count || 0, 10),
  };
}

export default function Dashboard({ user, onNavigate }) {
  const agencyView = user.agency || '';
  const [summary, setSummary] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [agencySummary, setAgencySummary] = useState(null);
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
  const [selLOBs, setSelLOBs] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [viewMode, setViewMode] = useState(() => {
    const saved = localStorage.getItem('olicomm_dashboard_view_mode');
    return saved === 'agent' ? 'agent' : 'agency';
  });

  function setViewModePersisted(mode) {
    setViewMode(mode);
    localStorage.setItem('olicomm_dashboard_view_mode', mode);
  }

  function handleKpiSort(col) {
    if (kpiSortCol === col) setKpiSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setKpiSortCol(col); setKpiSortDir('desc'); }
  }

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    // In agent mode, force filter to principals only
    const agentsToUse = viewMode === 'agent'
      ? DASHBOARD_PRINCIPAL_AGENTS.filter(a => allFilters.agents.includes(a))
      : selAgents;
    if (agentsToUse.length) p.set('agents', agentsToUse.join(','));
    if (selCarriers.length) p.set('carriers', selCarriers.join(','));
    if (selPeriods.length) p.set('periods', selPeriods.join(','));
    if (selTypes.length) p.set('classifications', selTypes.join(','));
    if (selPlanTypes.length) p.set('planTypes', selPlanTypes.join(','));
    if (selLOBs.length) p.set('lobs', selLOBs.join(','));
    if (viewMode === 'agent') p.set('view', 'agent');
    return p;
  }, [selAgents, selCarriers, selPeriods, selTypes, selPlanTypes, selLOBs, viewMode, allFilters.agents]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams();
      const fetches = [
        apiFetch(`/records/summary?${params}`),
        apiFetch(`/records/kpi?${params}`),
      ];
      if (user.role === 'admin' && viewMode === 'agency') {
        const ap = new URLSearchParams();
        if (selPeriods.length) ap.set('periods', selPeriods.join(','));
        fetches.push(apiFetch(`/records/agency-summary?${ap}`));
      }
      const results = await Promise.all(fetches);
      const s = results[0];
      const k = results[1];
      setSummary(s);
      setKpi(k);
      setAgencySummary(user.role === 'admin' && viewMode === 'agency' ? results[2] : null);
      if (s?.byPeriod) {
        const sorted = [...s.byPeriod].filter(p=>p.period&&p.period!=='Unknown'&&String(p.period).match(/^\d{6}$/)).sort((a,b)=>String(a.period).localeCompare(String(b.period)));
        setPeriodData(sorted.slice(-chartRange));
      }
    } catch(e){ console.error(e); }
    finally { setLoading(false); }
  }, [buildParams, agencyView, chartRange, user.role, viewMode, selPeriods]);

  useEffect(() => {
    setSelAgents([]); setSelCarriers([]); setSelTypes([]); setSelPlanTypes([]); setSelLOBs([]);
    apiFetch('/records/filters').then(d => {
      setAllFilters(d);
      const currentYear = new Date().getFullYear().toString();
      const currentYearPeriods = (d.periods || []).filter(p =>
        String(p).match(/^\d{6}$/) && String(p).startsWith(currentYear)
      );
      setSelPeriods(currentYearPeriods);
    }).catch(console.error);
  }, [agencyView]);

  useEffect(() => { loadData(); }, [loadData]);

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
  function clearAll() { setSelAgents([]); setSelCarriers([]); setSelPeriods([]); setSelTypes([]); setSelPlanTypes([]); setSelLOBs([]); }

  function drillDown(overrides={}) {
    if (!onNavigate) return;
    const agentOverride = viewMode === 'agent'
      ? (overrides.agent || DASHBOARD_PRINCIPAL_AGENTS[0])
      : (overrides.agent||(selAgents.length===1?selAgents[0]:''));
    onNavigate('alldata', {
      agent: agentOverride,
      carrier: overrides.carrier||(selCarriers.length===1?selCarriers[0]:''),
      period: overrides.period||(selPeriods.length===1?selPeriods[0]:''),
      classification: overrides.classification||(selTypes.length===1?selTypes[0]:''),
      lob: overrides.lob || (selLOBs.length===1?selLOBs[0]:''),
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

  const agentList = user.role==='admin'?DASHBOARD_MY_AGENTS.filter(a=>allFilters.agents.includes(a)):[user.name];
  const hasFilters = selAgents.length||selCarriers.length||selPeriods.length||selTypes.length||selPlanTypes.length||selLOBs.length;
  const totalFiltersActive = [selAgents,selCarriers,selPeriods,selTypes,selPlanTypes,selLOBs].reduce((s,a)=>s+a.length,0);
  const netSales = kpi?.agents?.reduce((s,a)=>s+a.net_sales,0)||0;
  const totalCB = kpi?.totals?.chargeback_amount||0;
  const totalAdv = kpi?.totals?.advance_amount||0;
  const card = {background:C.bg,borderRadius:10,border:`0.5px solid ${C.border}`,padding:'16px 20px'};
  const bookLabel = dashboardBookLabel(agencyView);
  const contextLine = `${bookLabel} · ${dashboardLensLabel(viewMode)} · ${formatPeriodRange(selPeriods)}`;
  const totalTrend = periodHalfTrend(summary?.byPeriod, 'total');
  const cbTrend = periodHalfTrend(summary?.byPeriod, 'chargebacks');
  const lobFilterPills = [...new Set(selLOBs.map(lobFilterLabel))];
  const filterPills = [...selAgents,...selCarriers,...selPeriods.map(formatPeriod),...selTypes,...selPlanTypes,...lobFilterPills].filter(Boolean);

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
            {viewMode === 'agency' ? (
              <FilterGroup title="Agent" items={agentList} selected={selAgents} onToggle={item=>toggle(selAgents,setSelAgents,item)} onSelectAll={items=>setSelAgents([...items])} onClearAll={()=>setSelAgents([])}/>
            ) : (
              <div style={{ background: C.accentLight, borderRadius: 6, padding: '8px 10px', marginBottom: 12, fontSize: 11, color: C.accentDark, lineHeight: 1.45, border: '0.5px solid #E8D9B8' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Principal agents</div>
                {THEI_DIRECT_AGENTS.join(', ')}, THEI house — sidebar agent filter disabled in this view.
              </div>
            )}
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
              <div style={{fontSize:13,color:C.text,marginTop:2}}>
                Welcome back, {user.name.split(' ')[0]} — {contextLine}
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              {hasFilters && (
                <div style={{display:'flex',flexWrap:'wrap',gap:4,justifyContent:'flex-end',maxWidth:400}}>
                  {filterPills.map(f=>(
                    <span key={f} style={{background:C.accent,color:C.sidebar,borderRadius:4,padding:'2px 8px',fontSize:11,fontWeight:500}}>{f}</span>
                  ))}
                </div>
              )}

              {/* Agency / Agent toggle */}
              <div style={{display:'flex',borderRadius:8,border:`0.5px solid ${C.border}`,overflow:'hidden'}}>
                {[['agency','Agency'],['agent','Agent']].map(([mode, label]) => (
                  <button key={mode} onClick={() => setViewModePersisted(mode)} style={{
                    padding:'7px 14px', fontSize:12, border:'none', cursor:'pointer',
                    fontWeight: viewMode===mode ? 600 : 400,
                    background: viewMode===mode ? C.accentDark : 'transparent',
                    color: viewMode===mode ? '#F5EDD4' : C.textMuted,
                    transition:'all 0.15s'
                  }}>{label}</button>
                ))}
              </div>

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
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {user.role === 'admin' && viewMode === 'agency' && (
            <HouseSplitWidget data={agencySummary} loading={loading} bookLabel={bookLabel} />
          )}

          {/* LOB Breakdown Cards */}
          {summary?.byLOB && summary.byLOB.length > 0 && (() => {
            const combined = {};
            summary.byLOB.filter(lob => lob.lob && lob.lob !== 'null').forEach(lobData => {
              const lobName = lobData.lob;
              const displayName = (lobName === 'MA' || lobName === 'MedSupp') ? 'Medicare' : lobName;
              if (!combined[displayName]) {
                combined[displayName] = { displayName, lobCodes: [], total: 0, count: 0 };
              }
              combined[displayName].lobCodes.push(lobName);
              const { amount, count } = lobCardMetrics(lobData, lobName, viewMode);
              combined[displayName].total += amount;
              combined[displayName].count += count;
            });

            const cards = Object.values(combined).filter(cardData => {
              // Agency view: hide Dental and PDP (personal agent commissions, not agency income)
              if (viewMode === 'agency' && (cardData.displayName === 'Dental' || cardData.displayName === 'PDP')) return false;
              // Agent view: hide $0 cards only
              if (viewMode === 'agent' && cardData.total === 0) return false;
              return true;
            });
            return (
              <div style={{marginBottom:16}}>
                {selLOBs.length > 0 && (
                  <button onClick={() => setSelLOBs([])} style={{
                    background:'none', border:`0.5px solid ${C.border}`, borderRadius:6,
                    padding:'5px 12px', fontSize:12, cursor:'pointer', color:C.textMuted,
                    marginBottom:10, display:'inline-flex', alignItems:'center', gap:6
                  }}>← Back to all</button>
                )}
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))',gap:10}}>
                {cards.map((cardData, idx) => {
                  const isACA = cardData.displayName === 'ACA';
                  const isActive = selLOBs.length > 0 && cardData.lobCodes.some(code => selLOBs.includes(code));
                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        if (isActive) { setSelLOBs([]); }
                        else { setSelLOBs(cardData.lobCodes); }
                      }}
                      style={{
                        ...card,
                        padding:'16px 20px',
                        borderTop:`3px solid ${isActive ? '#A0522D' : (isACA ? '#C9A96E' : '#4A7260')}`,
                        cursor:'pointer',
                        transition:'all 0.2s',
                        opacity: selLOBs.length > 0 && !isActive ? 0.5 : 1,
                        transform: isActive ? 'scale(1.02)' : 'scale(1)',
                      }}
                    >
                      <div style={{fontSize:10,color:C.textMuted,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:8}}>
                        {cardData.displayName} {isACA ? (viewMode === 'agent' ? 'Agent Commissions' : 'Agency Override') : 'Commissions'}
                        {isActive && ' ✓'}
                      </div>
                      <div style={{fontSize:28,fontWeight:600,color:isACA ? C.accent : C.green,lineHeight:1.1,marginBottom:6}}>
                        {loading ? '—' : fmt(cardData.total)}
                      </div>
                      <div style={{fontSize:11,color:C.textMuted}}>
                        {cardData.count.toLocaleString()}{' '}
                        {isACA && viewMode === 'agency'
                          ? 'override lines'
                          : isACA
                            ? 'agent policies'
                            : 'policies'}
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
            );
          })()}

          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
            {(() => {
              const calcChange = (change) => (change === null || change === undefined ? null : change);

              return [
                {label:'Total Commissions', value:fmt(summary?.totalCommission), color:C.green, sub:`${(summary?.totalRecords||0).toLocaleString()} records`, change: calcChange(totalTrend), changeHint: totalTrend != null ? '2nd half vs 1st' : null},
                {label:'Net Sales', value:fmt(netSales), color:C.accentDark, sub:'after chargebacks', change: null},
                {label:'Chargebacks', value:fmt(totalCB), color:totalCB>0?C.red:C.textMuted, sub:totalAdv>0?`${fmt(totalAdv)} advance`:'no advances', change: calcChange(cbTrend), changeHint: cbTrend != null ? '2nd half vs 1st' : null},
                {label:'Agents', value:kpi?.agents?.length||0, color:C.text, sub:'active this period', change: null},
              ].map((c,i)=>(
                <div key={i} style={{...card,padding:'16px 20px'}}>
                  <div style={{fontSize:10,color:C.textMuted,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:8}}>{c.label}</div>
                  <div style={{fontSize:28,fontWeight:600,color:c.color,lineHeight:1.1,marginBottom:6}}>{loading?'—':c.value}</div>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4,flexWrap:'wrap'}}>
                    <div style={{fontSize:11,color:C.textMuted}}>{c.sub}</div>
                    {c.change !== null && c.change !== undefined && !loading && (
                      <div style={{fontSize:11,fontWeight:600,color:c.change>0?C.green:c.change<0?C.red:C.textMuted,background:c.change>0?'rgba(74,114,96,0.1)':c.change<0?'rgba(160,82,45,0.1)':'transparent',padding:'2px 6px',borderRadius:4}} title={c.changeHint || ''}>
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
                      <td onClick={e=>{e.stopPropagation();drillDown({agent:a.agent_name, lob: selLOBs.length===1?selLOBs[0]:''});}} style={{padding:'9px 12px',color:C.accent,fontWeight:600,cursor:'pointer',textDecoration:'underline'}}>{a.total_count.toLocaleString()}</td>
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

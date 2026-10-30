/* Tank Gauges v1 — reads data/gauges.json (updated by Kal), caches it for offline,
   shows one day in route order. Local add/fix entries live in localStorage. */
(() => {
"use strict";
const DATA_URL = localStorage.getItem("tg_data_url") || "data/gauges.json";
const POLL_MS = 60000;
const K_CACHE = "tg_cache_v1", K_LOCAL = "tg_local_v1", K_VIEW = "tg_view";
const $ = s => document.querySelector(s);
const WD = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

let db = null, fetchedAt = null, online = null;
let local = loadJSON(K_LOCAL) || {};          // key "date|lease|loc|tank" -> {ft,in,ts}
let view = localStorage.getItem(K_VIEW) || "tanks";
let cur = initialDate();

/* ---------- routes: each route = a list of leases (tank lists live in leases[id].route) ---------- */
const K_ROUTE="tg_route";
let route = localStorage.getItem(K_ROUTE) || "route-3";
const DEF_ROUTES={"route-3":{name:"Route 3",leases:["bringelson"],hauls:true},"route-2":{name:"Route 2",leases:["route-2"],hauls:false}};
function routes(){ return (db&&db.routes)||DEF_ROUTES; }
function routeCfg(){ return routes()[route] || routes()["route-3"] || Object.values(routes())[0]; }
function routeLeases(){ return routeCfg().leases||[]; }
function routeName(){ return routeCfg().name||route; }
function inRoute(lease){ return routeLeases().includes(lease); }
function routeHasTanks(){ return routeLeases().some(l=>routeOf(l).length); }
function setRoute(r){ route=r; localStorage.setItem(K_ROUTE,r); render(true); }
/* one-time migration (v1.9.3): back up old localStorage, move phone BB edits under Route 3 */
(function migrate(){
  if(localStorage.getItem("tg_migrated_routes")) return;
  const stamp=new Date().toISOString().slice(0,19);
  for(const k of ["tg_local_v1","tg_bb_v1","tg_cache_v1","tg_view"]){ const v=localStorage.getItem(k); if(v!=null) localStorage.setItem(`tg_backup_${stamp}_${k}`,v); }
  const oldBB=loadJSON("tg_bb_v1");
  if(oldBB && Object.keys(oldBB).length){ const nb=loadJSON("tg_bb_v2")||{}; nb["route-3"]=Object.assign({},oldBB,nb["route-3"]||{}); localStorage.setItem("tg_bb_v2",JSON.stringify(nb)); }
  // tank edits are keyed by lease ("date|bringelson|loc|tank"), and Bringelson is Route 3, so they stay as-is
  localStorage.setItem("tg_migrated_routes",stamp);
})();

function loadJSON(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } }
function ymd(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function parseYmd(s){ const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function todayStr(){ return ymd(new Date()); }
function addDays(s,n){ const d=parseYmd(s); d.setDate(d.getDate()+n); return ymd(d); }
function initialDate(){
  const q = new URLSearchParams(location.search).get("d") || location.hash.replace("#","");
  return /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayStr();
}
function longDate(s){ const d=parseYmd(s); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }
function shortDate(s){ const d=parseYmd(s); return `${WD[d.getDay()].slice(0,3)} ${MON[d.getMonth()]} ${d.getDate()}`; }
function fmt(v){ return v ? `${v.ft}' ${v.in}"` : "—"; }
function inches(v){ return v.ft*12+v.in; }
function fmtDelta(n){ const a=Math.abs(n), f=Math.floor(a/12), i=a%12; return (n>0?"+":n<0?"−":"±")+(f?`${f}' ${i}"`:`${i}"`); }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>t.hidden=true,2200); }
function maxFt(){ return (db && db.max_ft) || 20; }
function leaseName(id){ return (db && db.leases[id] && db.leases[id].name) || id; }

/* ---------- data loading ---------- */
async function refresh(manual){
  try{
    const r = await fetch(DATA_URL + (DATA_URL.includes("?")?"&":"?") + "t=" + Date.now(), {cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j = await r.json();
    if(!j.days || !j.leases) throw new Error("bad data file");
    db = j; fetchedAt = new Date().toISOString(); online = true;
    localStorage.setItem(K_CACHE, JSON.stringify({db, fetchedAt}));
    pruneLocal(); pruneBB();
  }catch(e){
    online = false;
    if(!db){ const c = loadJSON(K_CACHE); if(c){ db=c.db; fetchedAt=c.fetchedAt; } }
  }
  render(manual);
}
function statusText(){
  if(!db) return online===false ? "Offline — no saved data yet" : "Loading…";
  const t = fetchedAt ? new Date(fetchedAt) : null;
  const ts = t ? t.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"}) + (ymd(t)!==todayStr() ? " "+shortDate(ymd(t)) : "") : "";
  return online ? `✓ ${ts}` : `Offline ${ts}`;
}

/* ---------- merge shared + local ---------- */
function lkey(date,lease,loc,tank){ return [date,lease,loc,tank].join("|"); }
function sharedVal(date,lease,loc,tank){
  const g=(db.days[date]||[]).find(g=>g.lease===lease); if(!g) return null;
  const r=g.locations.find(r=>r.loc===loc); return r && r[tank] ? r[tank] : null;
}
function pruneLocal(){ // drop local edits that the shared file now matches
  let changed=false;
  for(const k of Object.keys(local)){
    const [d,l,loc,t]=k.split("|"); const s=sharedVal(d,l,loc,t);
    if(s && s.ft===local[k].ft && s.in===local[k].in){ delete local[k]; changed=true; }
  }
  if(changed) localStorage.setItem(K_LOCAL, JSON.stringify(local));
}
function routeOf(lease){ return (db.leases[lease] && db.leases[lease].route) || []; }
/* returns [{lease, rows:[{loc, oil:{v,local}, water:{v,local}}]}] in route order */
function dayGroups(date){
  const map = new Map();
  for(const g of (db.days[date]||[])){
    if(!inRoute(g.lease)) continue;
    const m = new Map(); map.set(g.lease, m);
    for(const r of g.locations) m.set(r.loc, {loc:r.loc, oil:r.oil?{v:r.oil}:null, water:r.water?{v:r.water}:null});
  }
  for(const [k,v] of Object.entries(local)){
    const [d,l,loc,t]=k.split("|"); if(d!==date || !inRoute(l)) continue;
    if(!map.has(l)) map.set(l,new Map());
    const m=map.get(l); if(!m.has(loc)) m.set(loc,{loc,oil:null,water:null});
    m.get(loc)[t] = {v:{ft:v.ft,in:v.in}, local:true};
  }
  const out=[];
  for(const [lease,m] of map){
    const route=routeOf(lease), idx=new Map(route.map((l,i)=>[l,i]));
    const rows=[...m.values()].sort((a,b)=>(idx.has(a.loc)?idx.get(a.loc):1e6)-(idx.has(b.loc)?idx.get(b.loc):1e6)||a.loc.localeCompare(b.loc,undefined,{numeric:true}));
    if(rows.length) out.push({lease, rows});
  }
  // lease order: as listed in the file
  const order=Object.keys(db.leases); out.sort((a,b)=>order.indexOf(a.lease)-order.indexOf(b.lease));
  return out;
}
function prevReading(date,lease,loc,tank){ // most recent earlier day with this tank (shared or local)
  const days=new Set(Object.keys(db.days));
  for(const k of Object.keys(local)) days.add(k.split("|")[0]);
  const sorted=[...days].filter(d=>d<date).sort().reverse();
  for(const d of sorted){
    const lv=local[lkey(d,lease,loc,tank)]; if(lv) return {d,v:lv};
    const s=sharedVal(d,lease,loc,tank); if(s) return {d,v:s};
  }
  return null;
}
function gaugedDays(){
  const s=new Set(Object.keys(db.days).filter(d=>(db.days[d]||[]).some(g=>inRoute(g.lease)&&g.locations.length)));
  for(const k of Object.keys(local)){ const [d,l]=k.split("|"); if(inRoute(l)) s.add(d); }
  return [...s].sort();
}

/* ---------- water hauled (semis) ---------- */
const DEF_HAULERS=[{id:"b-fed",name:"B-Fed"},{id:"timbro-01",name:"Timbro 1931"}];
function bbl(n){ return Math.round(n).toLocaleString("en-US"); }
function haulers(){ return (db && db.haulers && db.haulers.length) ? db.haulers : DEF_HAULERS; }
function haulsFor(date){ const o={}; for(const g of (db.days[date]||[])) if(g.hauls && inRoute(g.lease)) Object.assign(o,g.hauls); return o; }
const TK={x:60,y:12,w:192,h:28};
function semiSvg(id,pct,has){
  const c="h-"+id.replace(/[^a-z0-9]/gi,""), dy=(TK.h*(1-pct/100)).toFixed(2);
  const wheel=x=>`<circle cx="${x}" cy="52" r="6.2" class="tire"/><circle cx="${x}" cy="52" r="2.3" class="hub"/>`;
  const rings=[84,108,132,156,180,204,228].map(x=>`<line x1="${x}" y1="${TK.y+1}" x2="${x}" y2="${TK.y+TK.h-1}"/>`).join("");
  const posts=[96,124,152,180,208].map(x=>`<line x1="${x}" y1="5" x2="${x}" y2="12"/>`).join("");
  return `<svg class="semi${has?"":" empty"}" viewBox="0 0 260 62" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs><clipPath id="${c}"><rect x="${TK.x}" y="${TK.y}" width="${TK.w}" height="${TK.h}" rx="13"/></clipPath>
   <linearGradient id="${c}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fd8ff"/><stop offset="1" stop-color="#0e4fa0"/></linearGradient></defs>
  <line x1="2" y1="58.5" x2="258" y2="58.5" class="ground"/>
  <g class="truck">
   <path d="M4,45 L4,33 Q4,29.5 8,29.5 L22,29.5 L22,45 Z"/><path d="M22,45 L22,14 Q22,11 25,11 L39,11 Q42,11 42,14 L42,45 Z"/>
   <rect x="25.5" y="14.5" width="13" height="11" rx="1.5" class="glass"/><line x1="7" y1="33" x2="7" y2="42"/><line x1="10" y1="33" x2="10" y2="42"/>
   <line x1="45.5" y1="5" x2="45.5" y2="40"/><rect x="24" y="39" width="14" height="5" rx="2"/>
   <rect x="3" y="45" width="72" height="2.6" rx="1"/><rect x="51" y="41.4" width="18" height="3" rx="1" class="fw"/>
   <path d="M43,48 Q50,40.5 59,40.5 Q66,40.5 73,48"/><path d="M8.5,48 Q17,40.5 25.5,48"/>
  </g>
  <g class="trailer">
   <rect x="58" y="40" width="196" height="3" rx="1"/><rect x="70" y="43" width="122" height="3" rx="1" class="pan"/>
   <line x1="88" y1="43" x2="88" y2="54"/><rect x="85" y="54" width="6" height="2" rx=".8"/>
   <path d="M197,48 Q206,40.5 215,40.5 L231,40.5 Q240,40.5 246,48"/>
   <polyline points="92,5 212,5" class="rail"/>${posts}
   <rect x="252" y="33" width="5" height="4.5" rx="1" class="valve"/><line x1="254.5" y1="16" x2="254.5" y2="32" class="sight"/>
  </g>
  <g clip-path="url(#${c})"><g class="hfill" data-y="${dy}" style="transform:translateY(${TK.h}px)">
   <rect x="${TK.x}" y="${TK.y}" width="${TK.w}" height="${TK.h+2}" fill="url(#${c}g)"/>
   <rect x="${TK.x}" y="${TK.y}" width="${TK.w}" height="1.4" class="surf"/>
   <rect x="${TK.x}" y="${TK.y+4}" width="${TK.w}" height="2" class="shine"/></g></g>
  <g class="tankline"><rect x="${TK.x}" y="${TK.y}" width="${TK.w}" height="${TK.h}" rx="13" class="shell"/>${rings}
   <rect x="98" y="9" width="9" height="3" rx="1.2"/><rect x="138" y="9" width="9" height="3" rx="1.2"/><rect x="178" y="9" width="9" height="3" rx="1.2"/></g>
  <g class="wheels">${wheel(17)}${wheel(52)}${wheel(66)}${wheel(207)}${wheel(221)}${wheel(235)}</g>
 </svg>`;
}
/* ---------- buyback (BB): daily whole number, no carry-forward ---------- */
const K_BB="tg_bb_v2"; let bbAll=loadJSON(K_BB)||{};   // route -> date -> {v, ts} saved on this phone only
function bbL(r){ return bbAll[r||route] || (bbAll[r||route]={}); }
function saveBB(){ localStorage.setItem(K_BB,JSON.stringify(bbAll)); }
function bbShared(date,r){ const ls=(routes()[r||route]||{}).leases||[];
  for(const g of ((db&&db.days[date])||[])) if(ls.includes(g.lease) && typeof g.buyback==="number") return g.buyback; return null; }
function bbFor(date){ const l=bbL()[date]; if(l) return {v:l.v, local:true}; const s=bbShared(date); return {v:s==null?0:s, local:false}; }
function pruneBB(){ let ch=false; for(const r of Object.keys(bbAll)) for(const d of Object.keys(bbAll[r])){ if(bbShared(d,r)===bbAll[r][d].v){ delete bbAll[r][d]; ch=true; } } if(ch) saveBB(); }
function bbBadge(){ const el=$("#bbBtn"); if(!el) return; const b=db?bbFor(cur):{v:0,local:false};
  el.innerHTML=`BB ${b.v}${b.local?'<span class="lbadge">L</span>':""}`; el.classList.toggle("zero",!b.v); }
function haulHtml(){
  const hs=haulsFor(cur);
  return `<div class="hauls-h">WATER HAULED</div><div class="hauls">`+haulers().map(h=>{
    const v=hs[h.id], has=typeof v==="number", pct=has?100:0;
    return `<section class="card haul"><span class="accent"></span><div class="hh"><span class="hn">${esc(h.name.toUpperCase())}</span>
      <span class="hv${has?"":" none"}">${has?`${bbl(v)} bbl`:"— bbl"}</span></div>${semiSvg(h.id,pct,has)}</section>`;
  }).join("")+`</div>`;
}

/* ---------- render ---------- */
function render(animate=true){
  const d=parseYmd(cur);
  $("#weekday").textContent = WD[d.getDay()].toUpperCase() + (cur===todayStr() ? " · TODAY" : "");
  $("#datelong").textContent = longDate(cur);
  $("#picker").value = cur;
  $("#todayBtn").hidden = cur===todayStr();
  const st=$("#status"); st.textContent=statusText(); st.classList.toggle("off", online===false);
  $("#tabTanks").classList.toggle("on", view==="tanks"); $("#tabList").classList.toggle("on", view==="list");
  history.replaceState(null,"", cur===todayStr() ? location.pathname : "#"+cur);

  const nLocal=Object.keys(local).length;
  $("#copyLocal").textContent = "Copy"; bbBadge();
  document.querySelectorAll("#routeSeg button").forEach(b=>{ const on=b.dataset.route===route; b.classList.toggle("on",on); b.setAttribute("aria-selected",on); });

  const v=$("#view");
  if(!db){ $("#subtitle").textContent="—"; v.innerHTML=`<div class="empty-day">${online===false?"No connection and no saved data yet.<br>Open once with signal.":"Loading…"}</div>`; return; }
  const groups=dayGroups(cur);
  const leases=groups.map(g=>leaseName(g.lease).toUpperCase()), rl=routeLeases().filter(l=>routeOf(l).length).map(l=>leaseName(l).toUpperCase());
  const ln=leases.length?leases:rl;
  $("#subtitle").textContent = [routeName().toUpperCase(), ln.join(" / "), longDate(cur).toUpperCase()].filter(Boolean).join(" · ");
  document.title = `Tank Gauges · ${routeName()} · ${shortDate(cur)}`;

  if(!groups.length && !routeHasTanks()){
    v.innerHTML=`<div class="empty-day route-empty"><div class="re-big">🛢️</div><b>${esc(routeName())} tanks coming soon</b><br>
      Once the ${esc(routeName())} tank list is added, they'll show up here.<br>The BB # above still works for ${esc(routeName())}.</div>`;
    return;
  }
  if(!groups.length){
    const days=gaugedDays(), before=days.filter(x=>x<cur).pop(), after=days.find(x=>x>cur);
    v.innerHTML=`<div class="empty-day">No gauges logged for<br><b>${WD[d.getDay()]}, ${longDate(cur)}</b>.
      ${before?`<br><button class="chip" data-go="${before}">◀ Last gauged: ${shortDate(before)}</button>`:""}
      ${after?`<br><button class="chip" data-go="${after}">Next gauged: ${shortDate(after)} ▶</button>`:""}</div>`;
    return;
  }
  v.innerHTML = view==="list" ? renderList(groups) : renderTanks(groups);
  if(view==="tanks"){
    const fills=[...v.querySelectorAll(".fill")], hf=[...v.querySelectorAll(".hfill")];
    const set=()=>{ fills.forEach((f,i)=>{ f.style.transitionDelay=(i*0.06)+"s"; f.style.height=f.dataset.h; });
      hf.forEach((f,i)=>{ f.style.transitionDelay=((fills.length+i)*0.06)+"s"; f.style.transform=`translateY(${f.dataset.y}px)`; }); };
    if(animate) requestAnimationFrame(()=>requestAnimationFrame(set)); else { fills.forEach(f=>f.style.transition="none"); hf.forEach(f=>f.style.transition="none"); set(); }
  }
}
function tankHtml(lease,loc,tank,cell){
  const val=cell&&cell.v, pct=val?Math.max(0,Math.min(100,inches(val)/(maxFt()*12)*100)):0;
  const lb=cell&&cell.local?' <span class="lbadge">L</span>':"";
  const labels=[5,10,15,20].map(f=>`<b style="bottom:${f/maxFt()*100}%">${f}</b>`).join("");
  return `<div class="tk ${tank}" data-edit="${esc(lease)}|${esc(loc)}|${tank}">
    <div class="kind">${tank.toUpperCase()}</div>
    <div class="tw"><div class="tank"><div class="fill${val?"":" empty"}" data-h="${pct.toFixed(2)}%"></div></div>
      <div class="scale"><div class="minor"></div><div class="major"></div>${labels}</div></div>
    <div class="val${val?"":" none"}">${fmt(val)}${lb}</div></div>`;
}
function renderTanks(groups){
  let h="";
  for(const g of groups){
    if(groups.length>1) h+=`<div class="lease-h">${esc(leaseName(g.lease).toUpperCase())}</div>`;
    h+=`<div class="grid">`+g.rows.map(r=>`<section class="card"><span class="accent"></span>
      <div class="loc">${esc(r.loc)}</div><div class="pair">${tankHtml(g.lease,r.loc,"oil",r.oil)}${tankHtml(g.lease,r.loc,"water",r.water)}</div></section>`).join("")+`</div>`;
  }
  return h+(routeCfg().hauls?haulHtml():"");
}
function haulLines(){ const hs=haulsFor(cur); return haulers().map(h=>[h, hs[h.id]]); }
function renderList(groups){
  let h=`<table class="list"><thead><tr><th>LOCATION</th><th>OIL</th><th>WATER</th></tr></thead><tbody>`;
  for(const g of groups){
    if(groups.length>1) h+=`<tr><td class="lh" colspan="3">${esc(leaseName(g.lease).toUpperCase())}</td></tr>`;
    for(const r of g.rows){
      const c=(cell,cls,t)=>`<td class="${cls}" data-edit="${esc(g.lease)}|${esc(r.loc)}|${t}">${fmt(cell&&cell.v)}${cell&&cell.local?' <span class="lbadge">LOCAL</span>':""}</td>`;
      h+=`<tr class="r"><td class="l">${esc(r.loc)}</td>${c(r.oil,"o","oil")}${c(r.water,"w","water")}</tr>`;
    }
  }
  h+=`<tr><td class="lh" colspan="3">WATER HAULED</td></tr>`+haulLines().map(([hl,v])=>`<tr class="r"><td class="l">${esc(hl.name)}</td><td class="w" colspan="2">${typeof v==="number"?`${bbl(v)} bbl`:"—"}</td></tr>`).join("");
  return h+`</tbody></table><div class="listtools"><button class="chip" id="copyDay">Copy as text</button></div>`;
}
const cf=v=>fmt(v).replace(/' /g,"'");
function dayText(){
  const groups=dayGroups(cur), d=parseYmd(cur);
  let s=`Tank gauges — ${routeName()} — ${WD[d.getDay()]} ${longDate(cur)}\n`;
  for(const g of groups){ s+=`${leaseName(g.lease)}\n`; for(const r of g.rows) s+=`${r.loc} oil ${cf(r.oil&&r.oil.v)} water ${cf(r.water&&r.water.v)}\n`; }
  const hl=routeCfg().hauls?haulLines().filter(([,v])=>typeof v==="number"):[]; if(hl.length){ s+="Water hauled\n"; for(const [h,v] of hl) s+=`${h.name} ${bbl(v)} bbl\n`; }
  s+=`BB ${bbFor(cur).v}\n`;
  return s;
}
async function copy(text,msg){
  try{ await navigator.clipboard.writeText(text); toast(msg||"Copied"); }
  catch(e){ prompt("Copy this:", text); }
}

/* ---------- navigation ---------- */
function go(date){ cur=date; render(true); }
$("#prev").onclick=()=>go(addDays(cur,-1));
$("#next").onclick=()=>go(addDays(cur,1));
$("#todayBtn").onclick=()=>go(todayStr());
$("#picker").onchange=e=>{ if(e.target.value) go(e.target.value); };
$("#tabTanks").onclick=()=>{ view="tanks"; localStorage.setItem(K_VIEW,view); render(true); };
$("#tabList").onclick=()=>{ view="list"; localStorage.setItem(K_VIEW,view); render(false); };
let sx=null; // swipe left/right to change day
document.addEventListener("touchstart",e=>{ if(!e.target.closest(".sheet")) sx=[e.touches[0].clientX,e.touches[0].clientY]; },{passive:true});
document.addEventListener("touchend",e=>{ if(!sx) return; const dx=e.changedTouches[0].clientX-sx[0], dy=e.changedTouches[0].clientY-sx[1]; sx=null;
  if(Math.abs(dx)>70 && Math.abs(dx)>2*Math.abs(dy)) go(addDays(cur, dx<0?1:-1)); },{passive:true});
document.addEventListener("click",e=>{
  const g=e.target.closest("[data-go]"); if(g) return go(g.dataset.go);
  const ed=e.target.closest("[data-edit]"); if(ed){ const [l,loc,t]=ed.dataset.edit.split("|"); return openForm(l,loc,t); }
  if(e.target.id==="copyDay") copy(dayText(),"Day copied");
  if(e.target.closest("#bbBtn")) return openBB();
});
$("#copyLocal").onclick=()=>copy(dayText(),"Day copied");
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refresh(); });
window.addEventListener("online",()=>refresh());
window.addEventListener("offline",()=>{ online=false; render(false); });
setInterval(()=>{ if(document.visibilityState==="visible") refresh(); }, POLL_MS);

/* ---------- add / fix form ---------- */
let fTank="oil";
function fillSelect(sel,vals,cur){ sel.innerHTML=vals.map(v=>`<option value="${esc(v[0])}"${v[0]==cur?" selected":""}>${esc(v[1])}</option>`).join(""); }
function openForm(lease,loc,tank){
  if(!db) return toast("No data loaded yet");
  if(!routeHasTanks()) return toast(`${routeName()} tanks aren't set up yet`);
  const rls=routeLeases().filter(l=>db.leases[l]);
  lease=lease||(rls.includes(db.default_lease)?db.default_lease:rls[0]);
  $("#fDate").value=cur;
  fillSelect($("#fLease"), rls.map(k=>[k,db.leases[k].name]), lease);
  const locs=[...new Set([...routeOf(lease), ...(dayGroups(cur).find(g=>g.lease===lease)||{rows:[]}).rows.map(r=>r.loc)])];
  if(!loc){ // first location in route missing a reading today
    const g=dayGroups(cur).find(g=>g.lease===lease);
    loc = locs.find(l=>{ const r=g&&g.rows.find(r=>r.loc===l); return !r||!r.oil||!r.water; }) || locs[0];
    const r=g&&g.rows.find(r=>r.loc===loc); tank = r&&r.oil&&!r.water ? "water" : "oil";
  }
  fillSelect($("#fLoc"), [...locs.map(l=>[l,l]),["__new","Other…"]], loc);
  $("#fLocOtherRow").hidden=true;
  fillSelect($("#fFt"), Array.from({length:maxFt()+1},(_, i)=>[i,i]), 0);
  fillSelect($("#fIn"), Array.from({length:12},(_, i)=>[i,i]), 0);
  setTank(tank||"oil"); prefill();
  $("#sheet").hidden=false;
}
function setTank(t){ fTank=t; $("#fTank").querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.t===t)); prefill(); }
function formLoc(){ return $("#fLoc").value==="__new" ? $("#fLocOther").value.trim() : $("#fLoc").value; }
function prefill(){
  const d=$("#fDate").value, l=$("#fLease").value, loc=formLoc(); if(!d||!l||!loc) return;
  const k=lkey(d,l,loc,fTank), v=local[k]||sharedVal(d,l,loc,fTank);
  if(v){ $("#fFt").value=v.ft; $("#fIn").value=v.in; }
  $("#fDelete").hidden=!local[k];
}
$("#fTank").onclick=e=>{ const b=e.target.closest("button"); if(b) setTank(b.dataset.t); };
$("#fLoc").onchange=()=>{ $("#fLocOtherRow").hidden=$("#fLoc").value!=="__new"; prefill(); };
$("#fDate").onchange=prefill; $("#fLease").onchange=prefill;
$("#fCancel").onclick=()=>$("#sheet").hidden=true;
$("#sheet").onclick=e=>{ if(e.target.id==="sheet") $("#sheet").hidden=true; };
$("#fSave").onclick=()=>{
  const d=$("#fDate").value, l=$("#fLease").value, loc=formLoc(), ft=+$("#fFt").value, inch=+$("#fIn").value;
  if(!d||!loc) return toast("Pick a date and location");
  const s=sharedVal(d,l,loc,fTank), k=lkey(d,l,loc,fTank);
  if(s && s.ft===ft && s.in===inch) delete local[k]; else local[k]={ft,in:inch,ts:new Date().toISOString()};
  localStorage.setItem(K_LOCAL, JSON.stringify(local));
  $("#sheet").hidden=true; cur=d; render(true); toast(`${loc} ${fTank} ${ft}' ${inch}" saved on phone`);
};
$("#fDelete").onclick=()=>{ delete local[lkey($("#fDate").value,$("#fLease").value,formLoc(),fTank)]; localStorage.setItem(K_LOCAL, JSON.stringify(local)); $("#sheet").hidden=true; render(false); };
$("#addBtn").onclick=()=>openForm();
$("#routeSeg").onclick=e=>{ const b=e.target.closest("button[data-route]"); if(b && b.dataset.route!==route) setRoute(b.dataset.route); };
function openBB(){ const b=bbFor(cur); $("#bbDate").textContent=`${WD[parseYmd(cur).getDay()]}, ${longDate(cur)}`;
  $("#bbIn").value=b.v||""; $("#bbDel").hidden=!bbL()[cur]; $("#bbSheet").hidden=false; setTimeout(()=>$("#bbIn").focus(),50); }
$("#bbCancel").onclick=()=>$("#bbSheet").hidden=true;
$("#bbSheet").onclick=e=>{ if(e.target.id==="bbSheet") $("#bbSheet").hidden=true; };
$("#bbSave").onclick=()=>{ const t=$("#bbIn").value.trim(), n=t===""?0:Number(t);
  if(!Number.isInteger(n)||n<0) return toast("Whole number only");
  const s=bbShared(cur); if((s==null?0:s)===n) delete bbL()[cur]; else bbL()[cur]={v:n,ts:new Date().toISOString()};
  saveBB(); $("#bbSheet").hidden=true; render(false); toast(`BB ${n} saved on phone`); };
$("#bbDel").onclick=()=>{ delete bbL()[cur]; saveBB(); $("#bbSheet").hidden=true; render(false); toast("Local BB removed"); };

/* ---------- share PNG (canvas copy of the dashboard, 1080 wide) ---------- */
$("#shareBtn").onclick=async()=>{
  if(!db) return;
  const groups=dayGroups(cur); if(!groups.length) return toast("Nothing gauged this day");
  const blob=await drawPng(groups); const name=`tank-gauges-${cur}.png`;
  const file=new File([blob],name,{type:"image/png"});
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file], title:`Tank Gauges ${longDate(cur)}`}); return; }catch(e){ if(e.name==="AbortError") return; }
  }
  const url=URL.createObjectURL(blob); $("#shotImg").src=url; $("#shotDl").href=url; $("#shotDl").download=name; $("#shot").hidden=false;
};
$("#shotClose").onclick=()=>$("#shot").hidden=true;
async function drawPng(groups){
  await document.fonts.load('900 40px Orbitron'); await document.fonts.load('700 24px RC');
  const rows=[]; for(const g of groups){ for(const r of g.rows) rows.push({...r,lease:g.lease}); }
  const TW=128, TH=240, rowh=TH+186, haulTop=0, haulBlock=260;
  const W=1080, top=330, nrows=Math.ceil(rows.length/2), H=Math.max(1920, top+nrows*rowh+haulBlock+110);
  const c=document.createElement("canvas"); c.width=W; c.height=H; const x=c.getContext("2d");
  const OIL="#ffb828", WAT="#28c8ff", CY="#5adcff";
  const bg=x.createLinearGradient(0,0,0,H); bg.addColorStop(0,"#040a1c"); bg.addColorStop(.5,"#08122a"); bg.addColorStop(1,"#0a0c18");
  x.fillStyle=bg; x.fillRect(0,0,W,H);
  x.strokeStyle="rgba(10,26,40,1)"; x.lineWidth=1; x.beginPath();
  for(let i=0;i<W;i+=40){x.moveTo(i+.5,0);x.lineTo(i+.5,H);} for(let i=0;i<H;i+=40){x.moveTo(0,i+.5);x.lineTo(W,i+.5);} x.stroke();
  const glow=(col,b)=>{x.shadowColor=col;x.shadowBlur=b;}, noglow=()=>{x.shadowBlur=0;};
  x.textAlign="center"; x.textBaseline="alphabetic";
  glow(CY,10); x.fillStyle=CY; x.fillRect(60,69,W-120,2); x.beginPath(); x.moveTo(60,70);x.lineTo(90,70);x.lineTo(80,80);x.lineTo(60,80);x.fill();
  x.font="900 74px Orbitron"; glow("rgba(70,196,232,.6)",14); x.fillStyle="#46c4e8"; x.fillText("TANK GAUGES",W/2,180);
  x.font="700 30px Orbitron"; glow("rgba(90,220,255,.4)",8); x.fillStyle="#a0e6ff";
  x.fillText($("#subtitle").textContent.replace("·","•"),W/2,232); noglow();
  x.fillStyle="#2878aa"; x.fillRect(60,264,W-120,2);
  x.font="700 24px RC"; x.textAlign="left";
  [[OIL,"OIL",W/2-210],[WAT,"WATER",W/2+30]].forEach(([col,l,lx])=>{ glow(col,8); x.fillStyle=col; rr(x,lx,280,30,26,5); x.fill(); x.fillText(l,lx+42,302); });
  noglow();
  const cw=500,gap=(W-2*cw)/3,mf=maxFt();
  rows.forEach((r,i)=>{
    const cx=gap+(i%2)*(cw+gap), cy=top+Math.floor(i/2)*rowh, x2=cx+cw, y2=cy+rowh-30, k=22;
    x.strokeStyle="#288cc8"; x.lineWidth=2; glow("#288cc8",8); x.beginPath();
    x.moveTo(cx+k,cy);x.lineTo(x2,cy);x.lineTo(x2,y2-k);x.lineTo(x2-k,y2);x.lineTo(cx,y2);x.lineTo(cx,cy+k);x.closePath(); x.stroke();
    x.fillStyle=CY; glow(CY,8); x.fillRect(cx+k,cy-2,90,5); noglow();
    x.textAlign="center"; x.font="700 38px Orbitron"; x.fillStyle="#e1f5ff"; x.fillText(r.loc,cx+cw/2,cy+54);
    [["oil",cx+70,OIL],["water",cx+cw-70-TW,WAT]].forEach(([t,tx,col])=>{
      const ty=cy+100, cell=r[t], v=cell&&cell.v;
      x.font="700 24px RC"; x.fillStyle=col; x.fillText(t.toUpperCase(),tx+TW/2,ty-14);
      if(v){ const lv=Math.min(1,inches(v)/(mf*12)), fy=ty+TH-(TH-6)*lv;
        x.save(); rr(x,tx+3,ty+3,TW-6,TH-6,14); x.clip();
        const g=x.createLinearGradient(0,fy,0,ty+TH); g.addColorStop(0,col); g.addColorStop(1,t==="oil"?"#8a5208":"#0e5a9a");
        x.fillStyle=g; x.fillRect(tx,fy,TW,ty+TH-fy); x.fillStyle="rgba(255,255,255,.16)"; x.fillRect(tx+TW*.22,fy,TW*.08,ty+TH-fy);
        x.fillStyle="rgba(255,255,240,.9)"; x.fillRect(tx,fy-1.5,TW,3); x.restore(); }
      glow(col,12); x.strokeStyle=col; x.lineWidth=3; rr(x,tx-4,ty-4,TW+8,TH+8,18); x.stroke(); noglow();
      x.strokeStyle=col; x.globalAlpha=.7; x.lineWidth=2; x.textAlign="left"; x.font="400 22px RC";
      for(let f=0;f<=mf;f++){ const yy=ty+TH-TH*f/mf; x.beginPath(); x.moveTo(tx+TW+8,yy); x.lineTo(tx+TW+8+(f%5?6:14),yy); x.stroke();
        if(f%5===0&&f>0){ x.fillStyle=col; x.fillText(String(f),tx+TW+26,yy+8);} }
      x.globalAlpha=1; x.textAlign="center"; x.font="700 38px Orbitron"; x.fillStyle=v?col:"#4a6a80"; glow(col,v?10:0);
      x.fillText(fmt(v)+(cell&&cell.local?"*":""),tx+TW/2,ty+TH+52); noglow();
    });
  });
  // water hauled: two semis (same SVG as the app, rasterized)
  const hy=top+nrows*rowh, hs=haulsFor(cur), hl=haulers();
  x.textAlign="left"; x.font="700 26px Orbitron"; x.fillStyle="#a0e6ff"; glow("rgba(90,220,255,.4)",6); x.fillText("WATER HAULED",gap,hy+14); noglow();
  { const b=bbFor(cur); x.textAlign="right"; x.font="700 30px Orbitron"; x.fillStyle=b.v?CY:"#4a6a80"; glow(CY,b.v?8:0); x.fillText(`BB ${b.v}${b.local?"*":""}`,W-gap,hy+14); noglow(); x.textAlign="left"; }
  for(let i=0;i<hl.length&&i<2;i++){
    const h=hl[i], v=hs[h.id], has=typeof v==="number", cx=gap+i*(cw+gap), cy=hy+36, x2=cx+cw, y2=cy+196, k=22;
    x.strokeStyle="#288cc8"; x.lineWidth=2; glow("#288cc8",8); x.beginPath();
    x.moveTo(cx+k,cy);x.lineTo(x2,cy);x.lineTo(x2,y2-k);x.lineTo(x2-k,y2);x.lineTo(cx,y2);x.lineTo(cx,cy+k);x.closePath(); x.stroke();
    x.fillStyle=CY; glow(CY,8); x.fillRect(cx+k,cy-2,90,5); noglow();
    x.font="700 30px Orbitron"; x.textAlign="left"; x.fillStyle="#e1f5ff"; x.fillText(h.name.toUpperCase(),cx+26,cy+46);
    x.textAlign="right"; x.fillStyle=has?WAT:"#4a6a80"; glow(WAT,has?10:0); x.fillText(has?`${bbl(v)} bbl`:"— bbl",x2-22,cy+46); noglow();
    try{ const img=await semiImage(h.id,has?100:0,has,940,224); x.drawImage(img,cx+15,cy+66,470,112); }catch(e){}
  }
  x.fillStyle="#2878aa"; x.fillRect(60,H-76,W-120,2); x.font="400 22px RC"; x.fillStyle="#78b4d2"; x.textAlign="center";
  x.fillText("SCALE 0–"+mf+" FT  •  FILL HEIGHT = GAUGED LEVEL"+(rows.some(r=>(r.oil&&r.oil.local)||(r.water&&r.water.local))?"  •  * = LOCAL EDIT":""),W/2,H-38);
  return new Promise(res=>c.toBlob(res,"image/png"));
}
const SEMI_CSS=`.truck,.trailer{fill:rgba(90,220,255,.06);stroke:#5aa8d0;stroke-width:1.1;stroke-linejoin:round;stroke-linecap:round}
.truck .glass{fill:rgba(90,220,255,.16)}.trailer .rail{fill:none}.trailer .valve{stroke:#28c8ff}.trailer .sight{stroke:#28c8ff;stroke-width:1.4}
.ground{stroke:#1d4a6a;stroke-width:1;stroke-dasharray:3 3}.tankline{fill:none;stroke:#28c8ff;stroke-width:1}.tankline line{stroke-opacity:.35}
.tankline .shell{stroke-width:1.7;fill:rgba(0,0,0,.25)}.tankline rect:not(.shell){fill:rgba(40,200,255,.2)}
.wheels .tire{fill:#07101c;stroke:#5aa8d0;stroke-width:1.3}.wheels .hub{fill:#5aa8d0;stroke:none}
.surf{fill:#c8f2ff}.shine{fill:rgba(255,255,255,.18)}.empty .tankline .shell{stroke-dasharray:4 3;stroke-opacity:.6}`;
function semiImage(id,pct,has,w,h){
  const svg=semiSvg(id,pct,has).replace("<svg ",`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" `)
    .replace("<defs>",`<style>${SEMI_CSS}</style><defs>`).replace(/data-y="([\d.]+)" style="[^"]*"/,(m,y)=>`transform="translate(0 ${y})"`);
  return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej;
    im.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg); });
}
function rr(x,a,b,w,h,r){ x.beginPath(); x.moveTo(a+r,b); x.arcTo(a+w,b,a+w,b+h,r); x.arcTo(a+w,b+h,a,b+h,r); x.arcTo(a,b+h,a,b,r); x.arcTo(a,b,a+w,b,r); x.closePath(); }

/* ---------- boot ---------- */
const c=loadJSON(K_CACHE); if(c){ db=c.db; fetchedAt=c.fetchedAt; }
render(true);
refresh();
let swReg=null;
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(r=>{swReg=r;}).catch(()=>{});
async function manualRefresh(){
  const b=$("#refreshBtn"); b.disabled=true; b.classList.add("spin");
  try{ if(swReg) swReg.update().catch(()=>{}); }catch(e){}
  await refresh(true);
  b.disabled=false; b.classList.remove("spin");
  toast(online ? "Up to date" : "Offline — showing saved data");
}
$("#refreshBtn").onclick=manualRefresh;
if("serviceWorker" in navigator){ let hadCtl=!!navigator.serviceWorker.controller, reloaded=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(hadCtl && !reloaded){ reloaded=true; location.reload(); } }); }
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refresh(); });
window.addEventListener("pageshow",()=>refresh());
window.addEventListener("online",()=>refresh());
setInterval(()=>{ if(document.visibilityState==="visible") refresh(); },60000);
if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
window.TG={ get db(){return db;}, get route(){return route;}, setRoute, go, dayText, png:()=>drawPng(dayGroups(cur)) }; // for testing
})();

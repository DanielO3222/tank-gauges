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
    pruneLocal();
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
  return online ? `Synced ${ts}` : `Offline — saved data from ${ts}`;
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
    const m = new Map(); map.set(g.lease, m);
    for(const r of g.locations) m.set(r.loc, {loc:r.loc, oil:r.oil?{v:r.oil}:null, water:r.water?{v:r.water}:null});
  }
  for(const [k,v] of Object.entries(local)){
    const [d,l,loc,t]=k.split("|"); if(d!==date) continue;
    if(!map.has(l)) map.set(l,new Map());
    const m=map.get(l); if(!m.has(loc)) m.set(loc,{loc,oil:null,water:null});
    m.get(loc)[t] = {v:{ft:v.ft,in:v.in}, local:true};
  }
  const out=[];
  for(const [lease,m] of map){
    const route=routeOf(lease), idx=new Map(route.map((l,i)=>[l,i]));
    const rows=[...m.values()].sort((a,b)=>(idx.has(a.loc)?idx.get(a.loc):1e6)-(idx.has(b.loc)?idx.get(b.loc):1e6)||a.loc.localeCompare(b.loc,undefined,{numeric:true}));
    out.push({lease, rows});
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
  const s=new Set(Object.keys(db.days)); for(const k of Object.keys(local)) s.add(k.split("|")[0]);
  return [...s].sort();
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
  $("#localBar").hidden = !nLocal;
  $("#localText").textContent = `${nLocal} local edit${nLocal>1?"s":""} not in the shared file yet`;

  const v=$("#view");
  if(!db){ $("#subtitle").textContent="—"; v.innerHTML=`<div class="empty-day">${online===false?"No connection and no saved data yet.<br>Open once with signal.":"Loading…"}</div>`; return; }
  const groups=dayGroups(cur);
  const leases=groups.map(g=>leaseName(g.lease).toUpperCase());
  $("#subtitle").textContent = `${leases.length?leases.join(" / "):leaseName(db.default_lease).toUpperCase()} · ${longDate(cur).toUpperCase()}`;
  document.title = `Tank Gauges · ${shortDate(cur)}`;

  if(!groups.length){
    const days=gaugedDays(), before=days.filter(x=>x<cur).pop(), after=days.find(x=>x>cur);
    v.innerHTML=`<div class="empty-day">No gauges logged for<br><b>${WD[d.getDay()]}, ${longDate(cur)}</b>.
      ${before?`<br><button class="chip" data-go="${before}">◀ Last gauged: ${shortDate(before)}</button>`:""}
      ${after?`<br><button class="chip" data-go="${after}">Next gauged: ${shortDate(after)} ▶</button>`:""}</div>`;
    return;
  }
  v.innerHTML = view==="list" ? renderList(groups) : renderTanks(groups);
  if(view==="tanks"){
    const fills=[...v.querySelectorAll(".fill")];
    const set=()=>fills.forEach((f,i)=>{ f.style.transitionDelay=(i*0.06)+"s"; f.style.height=f.dataset.h; });
    if(animate) requestAnimationFrame(()=>requestAnimationFrame(set)); else { fills.forEach(f=>f.style.transition="none"); set(); }
  }
}
function tankHtml(lease,loc,tank,cell){
  const val=cell&&cell.v, pct=val?Math.max(0,Math.min(100,inches(val)/(maxFt()*12)*100)):0;
  const p=val?prevReading(cur,lease,loc,tank):null;
  const lb=cell&&cell.local?'<span class="lbadge">LOCAL</span> ':"";
  let dl="";
  if(p){ const n=inches(val)-inches(p.v); dl=`<div class="delta ${n>0?"up":n<0?"dn":""}" title="since ${p.d}">${lb}${fmtDelta(n)} <span>since ${shortDate(p.d).slice(4)}</span></div>`; }
  else dl=`<div class="delta">${lb}</div>`;
  const labels=[5,10,15,20].map(f=>`<b style="bottom:${f/maxFt()*100}%">${f}</b>`).join("");
  return `<div class="tk ${tank}" data-edit="${esc(lease)}|${esc(loc)}|${tank}">
    <div class="kind">${tank.toUpperCase()}</div>
    <div class="tw"><div class="tank"><div class="fill${val?"":" empty"}" data-h="${pct.toFixed(2)}%"></div></div>
      <div class="scale"><div class="minor"></div><div class="major"></div>${labels}</div></div>
    <div class="val${val?"":" none"}">${fmt(val)}</div>${dl}</div>`;
}
function renderTanks(groups){
  let h="";
  for(const g of groups){
    if(groups.length>1) h+=`<div class="lease-h">${esc(leaseName(g.lease).toUpperCase())}</div>`;
    h+=`<div class="grid">`+g.rows.map(r=>`<section class="card"><span class="accent"></span>
      <div class="loc">${esc(r.loc)}</div><div class="pair">${tankHtml(g.lease,r.loc,"oil",r.oil)}${tankHtml(g.lease,r.loc,"water",r.water)}</div></section>`).join("")+`</div>`;
  }
  return h;
}
function renderList(groups){
  let h=`<table class="list"><thead><tr><th>LOCATION</th><th>OIL</th><th>WATER</th></tr></thead><tbody>`;
  for(const g of groups){
    if(groups.length>1) h+=`<tr><td class="lh" colspan="3">${esc(leaseName(g.lease).toUpperCase())}</td></tr>`;
    for(const r of g.rows){
      const c=(cell,cls,t)=>`<td class="${cls}" data-edit="${esc(g.lease)}|${esc(r.loc)}|${t}">${fmt(cell&&cell.v)}${cell&&cell.local?' <span class="lbadge">LOCAL</span>':""}</td>`;
      h+=`<tr class="r"><td class="l">${esc(r.loc)}</td>${c(r.oil,"o","oil")}${c(r.water,"w","water")}</tr>`;
    }
  }
  return h+`</tbody></table><div class="listtools"><button class="chip" id="copyDay">Copy as text</button></div>`;
}
function dayText(){
  const groups=dayGroups(cur), d=parseYmd(cur);
  let s=`Tank gauges — ${WD[d.getDay()]} ${longDate(cur)}\n`;
  for(const g of groups){ s+=`${leaseName(g.lease)}\n`; for(const r of g.rows) s+=`${r.loc.padEnd(7)} oil ${fmt(r.oil&&r.oil.v).padEnd(7)} water ${fmt(r.water&&r.water.v)}\n`; }
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
});
$("#copyLocal").onclick=()=>{
  const lines=Object.entries(local).sort().map(([k,v])=>{ const [d,l,loc,t]=k.split("|"); return `${d} ${leaseName(l)} ${loc} ${t} ${v.ft}' ${v.in}"`; });
  copy("Add these gauges to the shared file:\n"+lines.join("\n"),"Local edits copied");
};
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refresh(); });
window.addEventListener("online",()=>refresh());
window.addEventListener("offline",()=>{ online=false; render(false); });
setInterval(()=>{ if(document.visibilityState==="visible") refresh(); }, POLL_MS);

/* ---------- add / fix form ---------- */
let fTank="oil";
function fillSelect(sel,vals,cur){ sel.innerHTML=vals.map(v=>`<option value="${esc(v[0])}"${v[0]==cur?" selected":""}>${esc(v[1])}</option>`).join(""); }
function openForm(lease,loc,tank){
  if(!db) return toast("No data loaded yet");
  lease=lease||db.default_lease;
  $("#fDate").value=cur;
  fillSelect($("#fLease"), Object.keys(db.leases).map(k=>[k,db.leases[k].name]), lease);
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
  const W=1080, top=330, rowh=370, nrows=Math.ceil(rows.length/2), H=Math.max(1920, top+nrows*rowh+110);
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
  const cw=500,gap=(W-2*cw)/3,TW=128,TH=176,mf=maxFt();
  rows.forEach((r,i)=>{
    const cx=gap+(i%2)*(cw+gap), cy=top+Math.floor(i/2)*rowh, x2=cx+cw, y2=cy+rowh-30, k=22;
    x.strokeStyle="#288cc8"; x.lineWidth=2; glow("#288cc8",8); x.beginPath();
    x.moveTo(cx+k,cy);x.lineTo(x2,cy);x.lineTo(x2,y2-k);x.lineTo(x2-k,y2);x.lineTo(cx,y2);x.lineTo(cx,cy+k);x.closePath(); x.stroke();
    x.fillStyle=CY; glow(CY,8); x.fillRect(cx+k,cy-2,90,5); noglow();
    x.textAlign="center"; x.font="700 38px Orbitron"; x.fillStyle="#e1f5ff"; x.fillText(r.loc,cx+cw/2,cy+54);
    [["oil",cx+70,OIL],["water",cx+cw-70-TW,WAT]].forEach(([t,tx,col])=>{
      const ty=cy+104, cell=r[t], v=cell&&cell.v;
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
  x.fillStyle="#2878aa"; x.fillRect(60,H-76,W-120,2); x.font="400 22px RC"; x.fillStyle="#78b4d2"; x.textAlign="center";
  x.fillText("SCALE 0–"+mf+" FT  •  FILL HEIGHT = GAUGED LEVEL"+(rows.some(r=>(r.oil&&r.oil.local)||(r.water&&r.water.local))?"  •  * = LOCAL EDIT":""),W/2,H-38);
  return new Promise(res=>c.toBlob(res,"image/png"));
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
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refresh(); });
window.addEventListener("pageshow",()=>refresh());
window.addEventListener("online",()=>refresh());
setInterval(()=>{ if(document.visibilityState==="visible") refresh(); },60000);
if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
window.TG={ get db(){return db;}, go, dayText }; // for testing
})();

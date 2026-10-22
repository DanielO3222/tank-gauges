/* Compressor Log v1 — reads data/compressors.json, one day at a time, fixed display order. */
(() => {
"use strict";
const DATA_URL = "data/compressors.json", K_CACHE = "cp_cache_v1";
const $ = s => document.querySelector(s);
const WD = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DEF_FIELDS = {suction:{label:"Suction",unit:"psi",max:100}, rpm:{label:"RPM",unit:"rpm",max:1800}};
let db = null, fetchedAt = null, online = null, cur = initialDate();

function loadJSON(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } }
function ymd(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function parseYmd(s){ const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function todayStr(){ return ymd(new Date()); }
function addDays(s,n){ const d=parseYmd(s); d.setDate(d.getDate()+n); return ymd(d); }
function initialDate(){ const q=new URLSearchParams(location.search).get("d")||location.hash.replace("#",""); return /^\d{4}-\d{2}-\d{2}$/.test(q)?q:todayStr(); }
function longDate(s){ const d=parseYmd(s); return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }
function shortDate(s){ const d=parseYmd(s); return `${WD[d.getDay()].slice(0,3)} ${MON[d.getMonth()]} ${d.getDate()}`; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function num(n){ return Number(n).toLocaleString("en-US"); }
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>t.hidden=true,2200); }
function fields(){ return Object.assign({}, DEF_FIELDS, (db&&db.fields)||{}); }

async function refresh(){
  try{
    const r=await fetch(DATA_URL+"?t="+Date.now(),{cache:"no-store"}); if(!r.ok) throw new Error("HTTP "+r.status);
    const j=await r.json(); if(!j.days||!j.compressors) throw new Error("bad data");
    db=j; fetchedAt=new Date().toISOString(); online=true; localStorage.setItem(K_CACHE, JSON.stringify({db,fetchedAt}));
  }catch(e){ online=false; if(!db){ const c=loadJSON(K_CACHE); if(c){ db=c.db; fetchedAt=c.fetchedAt; } } }
  render();
}
function statusText(){
  if(!db) return online===false?"Offline":"Loading…";
  const t=fetchedAt?new Date(fetchedAt):null, ts=t?t.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):"";
  return online?`Synced ${ts}`:`Offline · ${ts}`;
}

/* ---------- drawing ---------- */
const ARC_L = Math.PI*18;
function gauge(cls,key,v){
  const f=fields()[key]||{label:key,unit:"",max:100}, has=typeof v==="number", p=has?Math.max(0,Math.min(1,v/(f.max||100))):0;
  return `<div class="g ${cls}"><svg viewBox="0 0 44 27" aria-hidden="true">
    <path class="trk" d="M4,24 A18,18 0 0 1 40,24"/>
    <path class="arc" d="M4,24 A18,18 0 0 1 40,24" stroke-dasharray="${ARC_L.toFixed(2)}" style="stroke-dashoffset:${ARC_L.toFixed(2)}" data-o="${(ARC_L*(1-p)).toFixed(2)}"/>
    <line class="ndl" x1="22" y1="24" x2="22" y2="10" style="transform:rotate(-90deg)" data-r="${(-90+180*p).toFixed(1)}"/>
    <circle class="pin" cx="22" cy="24" r="2.4"/></svg>
    <div class="num"><span class="v${has?"":" none"}">${has?num(v):"—"}</span><span class="u">${esc((f.label||key).toUpperCase())}${f.unit&&f.unit!==key?" · "+esc(f.unit.toUpperCase()):""}</span></div></div>`;
}
function pkg(rpm){
  const on=typeof rpm==="number"&&rpm>0, dur=on?Math.max(0.6,Math.min(6,2400/rpm)).toFixed(2):0;
  const blades=[0,60,120,180,240,300].map(a=>`<path transform="rotate(${a} 66 50)" d="M66,50 C63,44 63,36 66,33 C69,36 69,44 66,50Z"/>`).join("");
  const spokes=[0,45,90,135].map(a=>`<line transform="rotate(${a} 66 50)" x1="47" y1="50" x2="85" y2="50"/>`).join("");
  const grill=[-14,-7,0,7,14].map(o=>`<line x1="${66+o}" y1="${50-Math.sqrt(361-o*o)}" x2="${66+o}" y2="${50+Math.sqrt(361-o*o)}"/><line y1="${50+o}" x1="${66-Math.sqrt(361-o*o)}" y2="${50+o}" x2="${66+Math.sqrt(361-o*o)}"/>`).join("");
  return `<svg class="pkg ${on?"on":"off"}" viewBox="0 0 100 86" aria-hidden="true">
   <line class="ground" x1="0" y1="83.5" x2="100" y2="83.5"/>
   <g class="bld"><path d="M1,80 L1,30 L17,23 L33,27 L33,80 Z"/><rect class="door" x="9" y="48" width="12" height="32"/>
    <path d="M5,32 V80 M13,30 V48 M25,28 V48 M29,28 V80" stroke-opacity=".4"/></g>
   <path class="stack" d="M71,20 H80 Q83,20 83,17 V5"/><path class="stack" d="M37,22 V6"/>
   <rect class="muf" x="40" y="15" width="34" height="8" rx="4"/>
   <rect class="box" x="33" y="24" width="64" height="52" rx="2"/>
   <rect class="plate" x="37" y="27" width="9" height="3.5" rx=".6"/><rect class="plate" x="86" y="27" width="8" height="3.5" rx=".6"/>
   <g class="lad"><path d="M34.5,22 V80 M38.5,22 V80"/><path d="M34.5,30 H38.5 M34.5,38 H38.5 M34.5,46 H38.5 M34.5,54 H38.5 M34.5,62 H38.5 M34.5,70 H38.5"/></g>
   <circle class="shroud" cx="66" cy="50" r="22"/>
   <g class="fan" style="${on?`animation-duration:${dur}s`:""}">${blades}<circle class="hub" cx="66" cy="50" r="4.5"/></g>
   <g class="grill">${grill}</g><g class="spokes">${spokes}</g>
   <rect class="skid" x="31" y="76" width="68" height="4" rx="1"/>
   <path class="pipe" d="M36,79.5 H98"/><path class="pipe" d="M44,79.5 V84 M58,79.5 V84" style="stroke-width:1.6"/>
  </svg>`;
}
function render(){
  const d=parseYmd(cur);
  $("#weekday").textContent=WD[d.getDay()].toUpperCase()+(cur===todayStr()?" · TODAY":"");
  $("#datelong").textContent=longDate(cur); $("#picker").value=cur; $("#todayBtn").hidden=cur===todayStr();
  const st=$("#status"); st.textContent=statusText(); st.classList.toggle("off",online===false);
  history.replaceState(null,"",cur===todayStr()?location.pathname:"#"+cur);
  $("#subtitle").textContent=`DAILY LOG · ${longDate(cur).toUpperCase()}`;
  document.title=`Compressors · ${shortDate(cur)}`;
  const v=$("#view"); if(!db){ v.innerHTML=""; return; }
  const day=(db.days[cur])||{};
  v.innerHTML=db.compressors.map((c,i)=>{ const r=day[c.id]||{};
    return `<section class="card"><span class="accent"></span>${pkg(r.rpm)}<div class="info">
      <div class="name"><b>${i+1}</b>${esc(c.name.toUpperCase())}</div>
      <div class="gauges">${gauge("suc","suction",r.suction)}${gauge("rpm","rpm",r.rpm)}</div></div></section>`; }).join("");
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    v.querySelectorAll(".arc").forEach(a=>a.style.strokeDashoffset=a.dataset.o);
    v.querySelectorAll(".ndl").forEach(n=>n.style.transform=`rotate(${n.dataset.r}deg)`);
  }));
}
function dayLines(){
  const day=(db&&db.days[cur])||{};
  return db.compressors.map(c=>{ const r=day[c.id]; if(!r) return `${c.name} —`;
    return c.name+Object.keys(fields()).filter(k=>typeof r[k]==="number").map(k=>` ${k} ${r[k]}`).join(""); }).join("\n");
}
async function copyDay(){
  if(!db) return toast("No data loaded yet");
  const text=dayLines();
  try{ await navigator.clipboard.writeText(text); toast("Copied"); }catch(e){ prompt("Copy this:",text); }
}

/* ---------- nav + refresh ---------- */
function go(date){ cur=date; render(); }
$("#prev").onclick=()=>go(addDays(cur,-1)); $("#next").onclick=()=>go(addDays(cur,1));
$("#todayBtn").onclick=()=>go(todayStr()); $("#picker").onchange=e=>{ if(e.target.value) go(e.target.value); };
$("#copyBtn").onclick=copyDay;
let sx=null;
document.addEventListener("touchstart",e=>{ sx=[e.touches[0].clientX,e.touches[0].clientY]; },{passive:true});
document.addEventListener("touchend",e=>{ if(!sx) return; const dx=e.changedTouches[0].clientX-sx[0], dy=e.changedTouches[0].clientY-sx[1]; sx=null;
  if(Math.abs(dx)>70&&Math.abs(dx)>2*Math.abs(dy)) go(addDays(cur,dx<0?1:-1)); },{passive:true});
const c=loadJSON(K_CACHE); if(c){ db=c.db; fetchedAt=c.fetchedAt; }
render(); refresh();
let swReg=null;
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(r=>{swReg=r;}).catch(()=>{});
$("#refreshBtn").onclick=async()=>{ const b=$("#refreshBtn"); b.disabled=true; b.classList.add("spin");
  try{ if(swReg) swReg.update().catch(()=>{}); }catch(e){} await refresh();
  b.disabled=false; b.classList.remove("spin"); toast(online?"Up to date":"Offline — showing saved data"); };
if("serviceWorker" in navigator){ let hadCtl=!!navigator.serviceWorker.controller, reloaded=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(hadCtl&&!reloaded){ reloaded=true; location.reload(); } }); }
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refresh(); });
window.addEventListener("pageshow",()=>refresh()); window.addEventListener("online",()=>refresh());
setInterval(()=>{ if(document.visibilityState==="visible") refresh(); },60000);
window.CP={ get db(){return db;}, go, dayLines };
})();

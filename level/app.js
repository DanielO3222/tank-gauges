/* Bubble Level v1 — DeviceOrientation (devicemotion fallback), flat bullseye + edge vial, zero/hold. */
(() => {
"use strict";
const $ = s => document.querySelector(s), D = 180/Math.PI, K_CAL = "lv_cal_v1";
const ALPHA = 0.15, LEVEL_TOL = 0.2, FLAT_MAX = 10, EDGE_MAX = 10;   // smoothing, ±° for green, ° at bubble edge
let g = null, mode = "flat", hold = false, wasLevel = false, gotEvent = false, last = {};
let cal = (()=>{ try{ return JSON.parse(localStorage.getItem(K_CAL))||{}; }catch(e){ return {}; } })();
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
function toast(m){ const t=$("#toast"); t.textContent=m; t.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>t.hidden=true,1800); }

/* gravity unit vector in device coords (x right, y up the screen, z out of screen) */
function fromOrientation(b,gm){ b/=D; gm/=D; return [Math.sin(gm)*Math.cos(b), -Math.sin(b), -Math.cos(gm)*Math.cos(b)]; }
function feed(v){
  const n=Math.hypot(v[0],v[1],v[2]); if(!n||!isFinite(n)) return; v=v.map(c=>c/n);
  g = g ? g.map((c,i)=>c+ALPHA*(v[i]-c)) : v; gotEvent=true; if(!hold) update();
}
function screenAngle(){
  const a = (screen.orientation && typeof screen.orientation.angle==="number") ? screen.orientation.angle : (window.orientation||0);
  return (a*Math.PI/180);
}
function readings(){
  const a=screenAngle(), sx=g[0]*Math.cos(a)+g[1]*Math.sin(a), sy=-g[0]*Math.sin(a)+g[1]*Math.cos(a), az=Math.abs(g[2]);
  // hysteresis between flat and edge
  if(mode==="flat" && az<0.75) mode="edge"; else if(mode==="edge" && az>0.85) mode="flat";
  if(mode==="flat") return {x:Math.atan2(-sx,az)*D-(cal.fx||0), y:Math.atan2(-sy,az)*D-(cal.fy||0)};
  let e=Math.atan2(-sx,-sy)*D; e-=90*Math.round(e/90);              // fold: whichever edge is down
  return {e:e-(cal.e||0)};
}
const f1 = v => (Math.abs(v)<0.05?0:v).toFixed(1);
function update(){
  if(!g) return;
  const r=readings(); last=r;
  $("#flat").hidden = mode!=="flat"; $("#edge").hidden = mode!=="edge"; $("#xy").hidden = mode!=="flat";
  let lvl;
  if(mode==="flat"){
    const tot=Math.hypot(r.x,r.y); lvl=Math.abs(r.x)<=LEVEL_TOL && Math.abs(r.y)<=LEVEL_TOL;
    $("#vMain").textContent=f1(tot); $("#vX").textContent=f1(r.x)+"°"; $("#vY").textContent=f1(r.y)+"°";
    let bx=r.x/FLAT_MAX*90, by=-r.y/FLAT_MAX*90; const m=Math.hypot(bx,by); if(m>90){ bx*=90/m; by*=90/m; }
    $("#bubbleF").setAttribute("transform",`translate(${bx.toFixed(2)} ${by.toFixed(2)})`);
    $("#mode").textContent="FLAT · BULLSEYE";
  }else{
    lvl=Math.abs(r.e)<=LEVEL_TOL; $("#vMain").textContent=f1(r.e);
    const bx=Math.max(-138,Math.min(138,r.e/EDGE_MAX*138));
    $("#bubbleE").setAttribute("transform",`translate(${bx.toFixed(2)} 0)`);
    const portrait = Math.abs(Math.cos(screenAngle()))>0.5;
    $("#mode").textContent=`EDGE · ${portrait?"PORTRAIT":"LANDSCAPE"} VIAL`;
  }
  document.body.classList.toggle("level",lvl);
  if(lvl && !wasLevel && navigator.vibrate) try{ navigator.vibrate(40); }catch(e){}
  wasLevel=lvl;
}

/* sensors */
function onOrient(e){ if(e.beta==null||e.gamma==null) return; usingOrient=true; feed(fromOrientation(e.beta,e.gamma)); }
let usingOrient=false;
function onMotion(e){ if(usingOrient) return; const a=e.accelerationIncludingGravity; if(!a||a.x==null) return;
  const s=IOS?1:-1; feed([s*a.x, s*a.y, s*a.z]); }   // Android reports the upward reaction, iOS reports gravity
async function start(){
  window.addEventListener("deviceorientation",onOrient);   // listen first; harmless if permission is still pending
  window.addEventListener("devicemotion",onMotion);
  try{
    if(typeof DeviceOrientationEvent!=="undefined" && typeof DeviceOrientationEvent.requestPermission==="function"){
      const p=await DeviceOrientationEvent.requestPermission(); if(p!=="granted") throw new Error("Motion access was denied. Allow it in Settings › Safari › Motion & Orientation Access, then reopen.");
    }
    if(typeof DeviceMotionEvent!=="undefined" && typeof DeviceMotionEvent.requestPermission==="function"){ try{ await DeviceMotionEvent.requestPermission(); }catch(e){} }
  }catch(err){ $("#startMsg").textContent=err.message||String(err); return; }
  $("#startSheet").hidden=true; localStorage.setItem("lv_started","1");
  try{ if(navigator.wakeLock) navigator.wakeLock.request("screen").catch(()=>{}); }catch(e){}
  setTimeout(()=>{ if(!gotEvent) toast("No motion sensor detected"); },2500);
}
$("#startBtn").onclick=start;
// Android/desktop need no permission prompt: start right away if we've started before
if(!(typeof DeviceOrientationEvent!=="undefined" && typeof DeviceOrientationEvent.requestPermission==="function") && localStorage.getItem("lv_started")) start();

/* buttons */
$("#zeroBtn").onclick=()=>{ if(!g) return toast("No reading yet");
  const saveHold=hold; hold=false; const c0={...cal};
  if(mode==="flat"){ cal.fx=0; cal.fy=0; const r=readings(); cal.fx=r.x; cal.fy=r.y; }
  else { cal.e=0; const r=readings(); cal.e=r.e; }
  void c0; localStorage.setItem(K_CAL,JSON.stringify(cal)); hold=saveHold; update(); toast(mode==="flat"?"Flat zeroed":"Edge zeroed"); };
$("#resetBtn").onclick=()=>{ cal={}; localStorage.removeItem(K_CAL); update(); toast("Calibration reset"); };
$("#holdBtn").onclick=()=>{ hold=!hold; $("#holdBtn").classList.toggle("on",hold); $("#holdBtn").textContent=hold?"Held":"Hold"; if(!hold) update(); };
window.addEventListener("orientationchange",()=>setTimeout(update,200));
if(screen.orientation) screen.orientation.addEventListener("change",update);

/* PWA: service worker + auto-reload on update */
if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{});
  let hadCtl=!!navigator.serviceWorker.controller, reloaded=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(hadCtl&&!reloaded){ reloaded=true; location.reload(); } }); }
window.LV={ feed, fromOrientation, get mode(){return mode;}, get last(){return last;} };
})();

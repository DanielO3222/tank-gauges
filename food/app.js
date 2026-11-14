/* Fuel — food & weight tracker. Photos/notes/manual entries live on the phone (IndexedDB + localStorage).
   Pulse (health bot) reviews submitted days and writes its numbers to data/log.json, which this app merges in. */
"use strict";
const APP_VERSION = "fd-v1.2";
const TZ = "America/Denver";
const K_SET = "fd-settings", K_LOG = "fd-log";
const $ = s => document.querySelector(s);
const DEF = { webhookUrl:"", senderKey:"", authHeader:"Authorization", authScheme:"Bearer ", sendMode:"share", shortcutName:"Send to Pulse",
  heightIn:null, startWeight:231.4, startDate:"2026-11-10", goalWeight:165,
  cal:[2200,2400], protein:[160,180], fat:[65,80], carbs:[200,260] };
let S = Object.assign({}, DEF, loadJSON(K_SET) || {});
if (S.sendMode === "direct" && !S.webhookUrl) S.sendMode = "share";   // v1.0 default -> v1.1 default
const K_ACT = "fd-act-range";
let LOG = (loadJSON(K_LOG) || {}).log || { days:{}, weights:[] }, logAt = (loadJSON(K_LOG) || {}).at || null, online = null;
let DAYS = {}, PHOTOS = [];           // phone data: DAYS[date] = {date, notes, manual:{}, submittedAt, submittedVia, submittedIds}
let curDay = null;                     // date open in day view
const urlCache = new Map();

function loadJSON(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } }
function saveSettings(){ localStorage.setItem(K_SET, JSON.stringify(S)); }
const isNum = v => v !== null && v !== undefined && v !== "" && isFinite(+v);
const fmt = (n, d=0) => isNum(n) ? (+n).toLocaleString("en-US", {maximumFractionDigits:d, minimumFractionDigits:d}) : "—";
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* ---------- dates (America/Denver) ---------- */
function today(){ return new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
function addDays(d, n){ const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0,10); }
function dObj(d){ return new Date(d + "T12:00:00Z"); }
const fmtD = (d, o) => dObj(d).toLocaleDateString("en-US", Object.assign({timeZone:"UTC"}, o));
function nowLocalISO(){ // ISO with Denver offset
  const d = new Date(), p = Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:TZ,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"longOffset"}).formatToParts(d).map(x=>[x.type,x.value]));
  const off = (p.timeZoneName||"GMT-07:00").replace("GMT","") || "+00:00";
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`;
}
function timeOf(iso){ try{ return new Date(iso).toLocaleTimeString("en-US",{timeZone:TZ,hour:"numeric",minute:"2-digit"}); }catch(e){ return ""; } }

/* ---------- IndexedDB ---------- */
let dbp = null;
function idb(){ return dbp || (dbp = new Promise((res, rej) => {
  const r = indexedDB.open("fuel-db", 1);
  r.onupgradeneeded = () => { const db = r.result;
    const p = db.createObjectStore("photos", {keyPath:"id"}); p.createIndex("date", "date");
    db.createObjectStore("days", {keyPath:"date"}); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
})); }
async function tx(store, mode, fn){ const db = await idb(); return new Promise((res, rej) => {
  const t = db.transaction(store, mode), s = t.objectStore(store); const out = fn(s);
  t.oncomplete = () => res(out && "result" in out ? out.result : out); t.onerror = () => rej(t.error); }); }
const idbAll = store => tx(store, "readonly", s => s.getAll());
const idbPut = (store, v) => tx(store, "readwrite", s => s.put(v));
const idbDel = (store, k) => tx(store, "readwrite", s => s.delete(k));
const idbGet = (store, k) => tx(store, "readonly", s => s.get(k));

async function loadPhone(){
  const days = await idbAll("days"); DAYS = {}; days.forEach(d => DAYS[d.date] = d);
  const ph = await idbAll("photos"); PHOTOS = ph.map(p => ({id:p.id, date:p.date, takenAt:p.takenAt}));
  PHOTOS.sort((a,b) => (a.takenAt||"").localeCompare(b.takenAt||""));
}
function phoneDay(date){ return DAYS[date] || (DAYS[date] = {date, notes:"", manual:{}}); }
async function savePhoneDay(date){ await idbPut("days", phoneDay(date)); }
const photosOn = date => PHOTOS.filter(p => p.date === date);
async function photoURL(id, which="small"){
  const key = id + ":" + which; if (urlCache.has(key)) return urlCache.get(key);
  const p = await idbGet("photos", id); if (!p) return "";
  const u = URL.createObjectURL(p[which] || p.full); urlCache.set(key, u); return u;
}

/* ---------- image processing ---------- */
function loadImg(file){ return new Promise((res, rej) => { const u = URL.createObjectURL(file), im = new Image();
  im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(u), 1000); }; im.onerror = () => rej(new Error("Could not read that image")); im.src = u; }); }
function toJpeg(src, maxEdge, q){ const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  const k = Math.min(1, maxEdge / Math.max(w, h)), c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b), "image/jpeg", q)); }
async function addFiles(files, date){
  let n = 0;
  for (const f of files){
    try{
      const im = await loadImg(f);
      const full = await toJpeg(im, 1024, 0.82), small = await toJpeg(im, 640, 0.72);
      const takenAt = nowLocalISO();
      const id = date + "-" + takenAt.slice(11,19).replace(/:/g,"") + "-" + Math.random().toString(36).slice(2,6);
      await idbPut("photos", {id, date, takenAt, full, small});
      PHOTOS.push({id, date, takenAt}); n++;
    }catch(e){ toast(e.message || "Couldn't add that photo"); }
  }
  if (n){ toast(n === 1 ? "Photo saved to " + dayLabel(date) : n + " photos saved to " + dayLabel(date)); render(); }
}
function dayLabel(d){ return d === today() ? "today" : fmtD(d, {weekday:"short", month:"short", day:"numeric"}); }

/* ---------- merge phone + Pulse ---------- */
const FIELDS = ["weight","bmi","bodyFat","muscle","steps","activeCal","exerciseMin","distanceMi","standHrs"];
function sumEntries(es){ const t = {calories:0, protein:0, fat:0, carbs:0}; let any = false;
  (es||[]).forEach(e => ["calories","protein","fat","carbs"].forEach(k => { if (isNum(e[k])){ t[k] += +e[k]; any = true; } }));
  return any ? t : null; }
function calcBMI(lb){ return (isNum(lb) && isNum(S.heightIn) && S.heightIn > 0) ? 703 * lb / (S.heightIn * S.heightIn) : null; }
function merged(date){
  const p = DAYS[date] || {}, man = p.manual || {}, L = (LOG.days || {})[date] || {};
  const m = {}, src = {};
  FIELDS.forEach(f => { if (isNum(man[f])){ m[f] = +man[f]; src[f] = "you"; } else if (isNum(L[f])){ m[f] = +L[f]; src[f] = "pulse"; } else m[f] = null; });
  if (!isNum(m.bmi) && isNum(m.weight)){ const b = calcBMI(m.weight); if (b){ m.bmi = b; src.bmi = "auto"; } }
  const entries = L.entries || [];
  const totals = L.totals && Object.values(L.totals).some(isNum) ? L.totals : sumEntries(entries);
  const photos = photosOn(date);
  let status = "none";
  if (L.status === "reviewed") status = "reviewed";
  else if (L.status === "needs-info" || L.status === "question") status = "question";
  else if (p.submittedAt || L.status === "submitted" || L.status === "in-review") status = "submitted";
  const newSince = p.submittedIds ? photos.filter(x => !p.submittedIds.includes(x.id)).length : 0;
  return {date, m, src, entries, totals, photos, notes:p.notes || "", status, newSince, pulseNote:L.pulseNote || "", L, p};
}
const STATUS_TXT = {none:"Not sent", submitted:"Submitted", reviewed:"Reviewed", question:"Pulse has a question"};
function weightSeries(){
  const w = {}; if (isNum(S.startWeight) && S.startDate) w[S.startDate] = +S.startWeight;
  (LOG.weights || []).forEach(x => { if (isNum(x.lb)) w[x.date] = +x.lb; });
  Object.entries(LOG.days || {}).forEach(([d, x]) => { if (isNum(x.weight)) w[d] = +x.weight; });
  Object.values(DAYS).forEach(x => { if (x.manual && isNum(x.manual.weight)) w[x.date] = +x.manual.weight; });
  return Object.entries(w).sort((a,b) => a[0].localeCompare(b[0])).map(([date, lb]) => ({date, lb}));
}
function latest(field){
  const ds = new Set([...Object.keys(DAYS), ...Object.keys(LOG.days || {})]);
  for (const d of [...ds].sort().reverse()){ const x = merged(d); if (isNum(x.m[field])) return {v:x.m[field], date:d, src:x.src[field]}; }
  return null;
}

/* ---------- drawing ---------- */
function ring(val, max, color, size, stroke, inner){
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = isNum(val) && max > 0 ? Math.min(1, val / max) : 0;
  return `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%"><g transform="rotate(-90 ${size/2} ${size/2})">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-opacity=".24" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${(c*f).toFixed(1)} ${c.toFixed(1)}" ${f ? "" : 'stroke-opacity="0"'}/></g>${inner || ""}</svg>`;
}
function rangeTxt(a){ return a[0] === a[1] ? fmt(a[0]) : fmt(a[0]) + "–" + fmt(a[1]); }

function renderWeek(){
  const t = today(), days = []; for (let i = 6; i >= 0; i--) days.push(addDays(t, -i));
  const top = S.cal[1] * 1.15; let sum = 0, n = 0;
  $("#week").innerHTML = days.map(d => {
    const x = merged(d), kc = x.totals && isNum(x.totals.calories) ? +x.totals.calories : null;
    if (kc !== null){ sum += kc; n++; }
    const cls = kc === null ? "" : kc > S.cal[1] ? "over" : kc < S.cal[0] ? "low" : "";
    const hasAny = x.photos.length || x.notes || kc !== null;
    return `<button class="wd ${d === t ? "today" : ""}" data-day="${d}" aria-label="${fmtD(d,{weekday:"long",month:"short",day:"numeric"})}">
      <span class="dn">${fmtD(d,{weekday:"narrow"})}</span>
      <span class="bar"><span class="band" style="bottom:${S.cal[0]/top*100}%;height:${(S.cal[1]-S.cal[0])/top*100}%"></span>
        ${kc !== null ? `<span class="fill ${cls}" style="height:${Math.min(100, kc/top*100)}%"></span>` : ""}</span>
      <span class="kc">${kc !== null ? (kc/1000).toFixed(1) + "k" : ""}</span>
      <span class="dd">${+d.slice(8)}</span>
      <span class="dot ${hasAny ? x.status : ""}"></span></button>`;
  }).join("");
  $("#weekAvg").textContent = n ? "avg " + fmt(sum / n) + " kcal" : "";
}

function renderHero(){
  const x = merged(today()), kc = x.totals && isNum(x.totals.calories) ? +x.totals.calories : null;
  $("#calEaten").textContent = kc === null ? "—" : fmt(kc);
  if (kc === null) $("#calLeft").textContent = "Target " + rangeTxt(S.cal) + (x.photos.length ? " · waiting for Pulse" : "");
  else if (kc > S.cal[1]) $("#calLeft").textContent = fmt(kc - S.cal[1]) + " over · target " + rangeTxt(S.cal);
  else $("#calLeft").textContent = (kc >= S.cal[0] ? "In range · " : fmt(S.cal[0]-kc) + "–" + fmt(S.cal[1]-kc) + " left · ") + "target " + rangeTxt(S.cal);
  const b = $("#todayBadge"); b.className = "badge " + x.status;
  b.textContent = STATUS_TXT[x.status] + (x.newSince ? ` · ${x.newSince} new` : "");
  const pct = kc === null ? "" : Math.round(kc / S.cal[1] * 100) + "%";
  $("#calRing").innerHTML = ring(kc, S.cal[1], kc !== null && kc > S.cal[1] ? "var(--bad)" : "var(--cal)", 132, 13,
    `<text x="66" y="64" text-anchor="middle" class="ringTxt" font-size="26">${kc === null ? "🍽" : pct}</text>
     <text x="66" y="88" text-anchor="middle" fill="#8a8a8e" font-size="15">${kc === null ? "no data" : "of " + fmt(S.cal[1])}</text>`);
  const M = [["Protein","protein","var(--pro)"],["Fat","fat","var(--fat)"],["Carbs","carbs","var(--carb)"]];
  $("#macros").innerHTML = M.map(([lbl, k, col]) => {
    const v = x.totals && isNum(x.totals[k]) ? +x.totals[k] : null, tg = S[k];
    return `<div class="macro" data-open-today><div class="label">${lbl}</div><div class="ringWrap">${ring(v, tg[1], col, 74, 8,
      `<text x="37" y="44" text-anchor="middle" fill="#8a8a8e" font-size="18">${v === null ? "" : Math.round(v / tg[1] * 100) + "%"}</text>`)}</div>
      <div class="v">${v === null ? "—" : Math.round(v) + "g"}</div><div class="t">of ${rangeTxt(tg)}g</div></div>`;
  }).join("");
}

function renderWeight(){
  const ws = weightSeries(), cur = ws.length ? ws[ws.length-1] : null, start = +S.startWeight, goal = +S.goalWeight;
  $("#wNow").textContent = cur ? fmt(cur.lb, 1) : "—";
  $("#wAsOf").textContent = cur ? (cur.date === today() ? "today" : fmtD(cur.date, {month:"short", day:"numeric"})) : "";
  const lost = cur ? start - cur.lb : 0, togo = cur ? cur.lb - goal : start - goal;
  $("#wLost").textContent = cur ? (lost >= 0 ? "" : "+") + fmt(Math.abs(lost), 1) : "—";
  $("#wToGo").textContent = fmt(Math.max(0, togo), 1);
  const pct = Math.max(0, Math.min(1, lost / (start - goal)));
  $("#wProg").style.width = (pct * 100).toFixed(1) + "%";
  $("#wPct").textContent = Math.round(pct * 100) + "% there";
  $("#wStart").textContent = "Start " + fmt(start, 1) + " · " + fmtD(S.startDate, {month:"short", day:"numeric"});
  $("#wGoal").textContent = "Goal " + fmt(goal, 0);
  // chart: scale weight dots + smoothed trend (EMA), last 60 days
  const W = 340, H = 92, P = {l:30, r:8, t:6, b:16};
  const pts = ws.filter(x => x.date >= addDays(today(), -60));
  if (!pts.length){ $("#wChart").innerHTML = ""; return; }
  const d0 = dObj(pts[0].date).getTime(), d1 = Math.max(dObj(today()).getTime(), d0 + 864e5);
  let lo = Math.min(...pts.map(p => p.lb)), hi = Math.max(...pts.map(p => p.lb));
  if (hi - lo < 6){ const m = (hi + lo) / 2; lo = m - 3; hi = m + 3; } lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
  const X = d => P.l + (dObj(d).getTime() - d0) / (d1 - d0) * (W - P.l - P.r), Y = v => P.t + (hi - v) / (hi - lo) * (H - P.t - P.b);
  let ema = null; const tr = pts.map(p => (ema = ema === null ? p.lb : ema + 0.25 * (p.lb - ema), [X(p.date), Y(ema)]));
  const grid = [hi, (hi+lo)/2, lo].map(v => `<line x1="${P.l}" x2="${W-P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2c2c2e"/><text x="${P.l-6}" y="${Y(v)+4}" text-anchor="end" fill="#8a8a8e" font-size="10">${Math.round(v)}</text>`).join("");
  const line = tr.length > 1 ? `<polyline points="${tr.map(p => p.map(n => n.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="var(--wt)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : "";
  const dots = pts.map(p => `<circle cx="${X(p.date).toFixed(1)}" cy="${Y(p.lb).toFixed(1)}" r="3.5" fill="#000" stroke="#d9a6ff" stroke-width="1.6"/>`).join("");
  const ax = `<text x="${P.l}" y="${H-6}" fill="#8a8a8e" font-size="10">${fmtD(pts[0].date,{month:"short",day:"numeric"})}</text><text x="${W-P.r}" y="${H-6}" text-anchor="end" fill="#8a8a8e" font-size="10">Today</text>`;
  const hint = pts.length < 2 ? `<text x="${(W+P.l)/2}" y="${H/2}" text-anchor="middle" fill="#8a8a8e" font-size="11">Log weigh-ins to see your trend</text>` : "";
  $("#wChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}">${grid}${line}${dots}${ax}${hint}</svg>`;
}

function renderStats(){
  const asOf = l => l ? (l.date === today() ? "today" : fmtD(l.date, {month:"short", day:"numeric"})) + (l.src === "auto" ? " · from height" : "") : "enter in day view";
  const b = latest("bmi"); $("#bmi").textContent = b ? fmt(b.v, 1) : "—"; $("#bmiSub").textContent = b ? asOf(b) : (isNum(S.heightIn) ? "log a weight" : "add height in Settings");
  const f = latest("bodyFat"); $("#bf").textContent = f ? fmt(f.v, 1) + "%" : "—"; $("#bfSub").textContent = asOf(f);
  const m = latest("muscle"); $("#mu").textContent = m ? fmt(m.v, 1) + "%" : "—"; $("#muSub").textContent = asOf(m);
}
/* slim activity strip: 7-day average by default, tap for 30-day; averages only over days that have a value */
const ACT = [["steps","Steps","steps",0,""],["activeCal","Move","move",0,"cal"],["exerciseMin","Exercise","ex",0,"min"],["distanceMi","Distance","dist",2,"mi"]];
function actAvg(field, n){ let s = 0, k = 0; const t = today();
  for (let i = 0; i < n; i++){ const v = merged(addDays(t, -i)).m[field]; if (isNum(v)){ s += +v; k++; } }
  return {avg: k ? s / k : null, n: k}; }
function renderActivity(){
  const n = localStorage.getItem(K_ACT) === "30" ? 30 : 7, td = merged(today()).m;
  let days = 0; const t = today();
  for (let i = 0; i < n; i++){ const m = merged(addDays(t, -i)).m; if (["steps","activeCal","exerciseMin","distanceMi","standHrs"].some(f => isNum(m[f]))) days++; }
  $("#actLbl").textContent = "Activity · " + (n === 30 ? "30-day avg" : "7-day avg");
  const st = actAvg("standHrs", n);
  $("#actN").textContent = (days ? days + (days === 1 ? " day" : " days") : "no data yet") + (st.avg !== null ? " · stand " + fmt(st.avg, 0) + "h" : "");
  $("#seg7").className = n === 7 ? "on" : ""; $("#seg30").className = n === 30 ? "on" : "";
  $("#actRow").innerHTML = ACT.map(([f, lbl, cls, dp, unit]) => { const a = actAvg(f, n);
    const tv = isNum(td[f]) ? fmt(td[f], dp) : "—";
    return `<div class="aCell ${cls}"><div class="v">${a.avg === null ? "—" : fmt(a.avg, dp)}${unit && a.avg !== null ? `<small>${unit}</small>` : ""}</div><div class="k">${lbl}</div><div class="td">today ${tv}</div></div>`; }).join("");
}
$("#actStrip").addEventListener("click", () => { localStorage.setItem(K_ACT, localStorage.getItem(K_ACT) === "30" ? "7" : "30"); renderActivity(); });

async function foodRows(x, includePhotos = true){
  const byPhoto = {}; x.entries.forEach(e => { if (e.photoId) (byPhoto[e.photoId] = byPhoto[e.photoId] || []).push(e); });
  const rows = [];
  if (includePhotos) for (const p of x.photos){
    const es = byPhoto[p.id] || [], u = await photoURL(p.id);
    const name = es.length ? es.map(e => esc(e.food)).join(", ") : '<span class="muted">Waiting for Pulse</span>';
    const kc = es.length ? es.reduce((s, e) => s + (+e.calories || 0), 0) : null;
    const mac = es.length ? `P ${fmt(es.reduce((s,e)=>s+(+e.protein||0),0))} · F ${fmt(es.reduce((s,e)=>s+(+e.fat||0),0))} · C ${fmt(es.reduce((s,e)=>s+(+e.carbs||0),0))}` : timeOf(p.takenAt);
    rows.push(`<div class="food"><img src="${u}" alt=""><div><div class="fn">${name}</div><div class="fm">${mac}</div></div><div class="kc">${kc === null ? "" : fmt(kc)}</div></div>`);
  }
  const ids = new Set(x.photos.map(p => p.id));
  x.entries.filter(e => !e.photoId || !ids.has(e.photoId)).forEach(e => {
    rows.push(`<div class="food"><div class="ph">🍽️</div><div><div class="fn">${esc(e.food || "Food")}</div><div class="fm">P ${fmt(e.protein)} · F ${fmt(e.fat)} · C ${fmt(e.carbs)}${e.note ? " · " + esc(e.note) : ""}</div></div><div class="kc">${fmt(e.calories)}</div></div>`);
  });
  return rows;
}
async function renderToday(){
  const x = merged(today()), rows = await foodRows(x, true);
  $("#todayList").innerHTML = rows.length ? rows.join("") : '<div class="empty">No food yet today. Tap <b>+</b> to snap your meal.</div>';
}

function render(){
  $("#hdrDate").textContent = fmtD(today(), {weekday:"long", month:"short", day:"numeric"});
  renderWeek(); renderHero(); renderActivity(); renderWeight(); renderStats(); renderToday();
  $("#syncDot").className = "syncdot " + (online === true ? "ok" : online === false ? "off" : "");
  $("#foot").textContent = APP_VERSION + (logAt ? " · Pulse data " + new Date(logAt).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}) : "");
  if (curDay) renderDay();
}

/* ---------- day view ---------- */
function openDay(date){ curDay = date; $("#day").hidden = false; $("#day").scrollTop = 0; fillDayInputs(); renderDay(); prepShare(date); }
function closeDay(){ curDay = null; $("#day").hidden = true; render(); }
function fillDayInputs(){
  const p = phoneDay(curDay), x = merged(curDay);
  $("#notes").value = p.notes || ""; $("#noteSaved").textContent = "";
  FIELDS.forEach(f => { const el = $("#m_" + f); el.value = isNum(p.manual[f]) ? p.manual[f] : "";
    el.placeholder = x.src[f] === "pulse" ? "Pulse: " + x.m[f] : (f === "bmi" && x.src.bmi === "auto" ? "auto " + fmt(x.m.bmi, 1) : ""); });
  $("#bmiHint").textContent = isNum(S.heightIn) ? "auto" : "";
}
async function renderDay(){
  const d = curDay, x = merged(d), t = today();
  $("#dayName").textContent = d === t ? "Today" : d === addDays(t, -1) ? "Yesterday" : fmtD(d, {weekday:"long"});
  $("#dayDate").textContent = fmtD(d, {weekday:"short", month:"short", day:"numeric", year:"numeric"});
  $("#dayNext").disabled = d >= t; $("#dayNext").style.opacity = d >= t ? .3 : 1;
  const b = $("#dayBadge"); b.className = "badge " + x.status; b.textContent = STATUS_TXT[x.status];
  const T = x.totals, kc = T && isNum(T.calories) ? +T.calories : null;
  const bar = (lbl, k, col) => { const v = T && isNum(T[k]) ? +T[k] : null, tg = S[k];
    return `<div class="mbar"><span>${lbl}</span><span class="tr"><i style="width:${v === null ? 0 : Math.min(100, v/tg[1]*100)}%;background:${col}"></i></span><span class="vv">${v === null ? "—" : Math.round(v)} / ${rangeTxt(tg)}g</span></div>`; };
  $("#dayTotals").innerHTML = `<div class="totRow"><div><div class="label">Calories</div><div class="bignum">${kc === null ? "—" : fmt(kc)}<small> / ${rangeTxt(S.cal)}</small></div></div></div>
    <div class="mbars">${bar("Protein","protein","var(--pro)")}${bar("Fat","fat","var(--fat)")}${bar("Carbs","carbs","var(--carb)")}</div>`;
  const pn = $("#pulseNote"); pn.hidden = !x.pulseNote; pn.innerHTML = x.pulseNote ? "<b>Pulse:</b> " + esc(x.pulseNote) : "";
  const byPhoto = {}; x.entries.forEach(e => { if (e.photoId) (byPhoto[e.photoId] = byPhoto[e.photoId] || []).push(e); });
  const cards = [];
  for (const p of x.photos){
    const es = byPhoto[p.id] || [], u = await photoURL(p.id);
    const info = es.length ? es.map(e => `<div class="fn">${esc(e.food)}</div><div class="fm">${fmt(e.calories)} kcal · P ${fmt(e.protein)} · F ${fmt(e.fat)} · C ${fmt(e.carbs)}${e.note ? "<br>" + esc(e.note) : ""}</div>`).join("")
      : `<div class="fm">${x.status === "none" ? "Not sent yet" : "Waiting for Pulse"}</div>`;
    cards.push(`<div class="pcard"><img src="${u}" alt="" data-view="${p.id}"><span class="tm">${timeOf(p.takenAt)}</span><button class="del" data-del="${p.id}" aria-label="Delete photo">✕</button><div class="pi">${info}</div></div>`);
  }
  if (curDay !== d) return;
  $("#photoGrid").innerHTML = cards.length ? cards.join("") : '<div class="empty" style="grid-column:1/-1">No photos for this day yet.</div>';
  const ids = new Set(x.photos.map(p => p.id));
  const extra = x.entries.filter(e => !e.photoId || !ids.has(e.photoId));
  $("#otherEntries").innerHTML = extra.length ? '<div class="label">Other items</div>' + extra.map(e => `<div class="food"><div class="ph">🍽️</div><div><div class="fn">${esc(e.food || "Food")}</div><div class="fm">P ${fmt(e.protein)} · F ${fmt(e.fat)} · C ${fmt(e.carbs)}${e.note ? " · " + esc(e.note) : ""}</div></div><div class="kc">${fmt(e.calories)}</div></div>`).join("") : "";
  const p = DAYS[d] || {};
  $("#submitBtn").textContent = p.submittedAt ? (x.newSince ? `Send to Pulse again (${x.newSince} new)` : "Send to Pulse again") : "Send to Pulse";
  const mode = sendMode();
  $("#sendHow").textContent = mode === "shortcut" ? `Runs your “${S.shortcutName || "Send to Pulse"}” Shortcut, which posts the day to Pulse.`
    : mode === "direct" ? "Posts the day to Pulse's webhook." : "Opens the share sheet. Pick Pulse's chat to send the photos and notes.";
  $("#shareBtn").hidden = mode === "share";
  $("#sendStatus").textContent = p.submittedAt ? `Sent ${new Date(p.submittedAt).toLocaleString("en-US",{timeZone:TZ,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} via ${({direct:"webhook ✓",shortcut:"Shortcut",share:"share sheet"})[p.submittedVia] || p.submittedVia}` : "";
}

let noteT = null, manT = null;
$("#notes").addEventListener("input", () => { const d = curDay; phoneDay(d).notes = $("#notes").value; clearTimeout(noteT);
  $("#noteSaved").textContent = "…"; noteT = setTimeout(async () => { await savePhoneDay(d); $("#noteSaved").textContent = "Saved"; prepShare(d); }, 400); });
FIELDS.forEach(f => $("#m_" + f).addEventListener("input", e => { const d = curDay, v = e.target.value.trim().replace(/,/g, "");
  const man = phoneDay(d).manual; if (v === "" ) delete man[f]; else if (isNum(v)) man[f] = +v; else return;
  clearTimeout(manT); $("#manSaved").textContent = "…";
  manT = setTimeout(async () => { await savePhoneDay(d); $("#manSaved").textContent = "Saved"; renderDay(); prepShare(d); if (f === "weight") fillBMIPlaceholder(); }, 400); }));
function fillBMIPlaceholder(){ const x = merged(curDay); const el = $("#m_bmi"); if (!el.value) el.placeholder = x.src.bmi === "auto" ? "auto " + fmt(x.m.bmi, 1) : (x.src.bmi === "pulse" ? "Pulse: " + x.m.bmi : ""); }
$("#dayBack").onclick = closeDay;
$("#dayPrev").onclick = () => openDay(addDays(curDay, -1));
$("#dayNext").onclick = () => { if (curDay < today()) openDay(addDays(curDay, 1)); };
$("#dayAdd").onclick = () => openAdd();
$("#photoGrid").addEventListener("click", async e => {
  const del = e.target.closest("[data-del]"), v = e.target.closest("[data-view]");
  if (del){ if (!confirm("Delete this photo?")) return; await idbDel("photos", del.dataset.del); PHOTOS = PHOTOS.filter(p => p.id !== del.dataset.del); renderDay(); prepShare(curDay); return; }
  if (v){ $("#viewImg").src = await photoURL(v.dataset.view, "full"); $("#viewer").hidden = false; }
});
$("#viewClose").onclick = () => $("#viewer").hidden = true; $("#viewer").onclick = e => { if (e.target.id === "viewer") $("#viewer").hidden = true; };

/* ---------- add photo ---------- */
function openAdd(){ const d = curDay || today(); $("#addTitle").textContent = "Add to " + dayLabel(d); $("#addSheet").hidden = false; }
$("#fab").onclick = openAdd;
$("#addCancel").onclick = () => $("#addSheet").hidden = true;
$("#addSheet").onclick = e => { if (e.target.id === "addSheet") $("#addSheet").hidden = true; };
$("#takePhoto").onclick = () => { $("#addSheet").hidden = true; $("#camIn").click(); };
$("#pickPhoto").onclick = () => { $("#addSheet").hidden = true; $("#libIn").click(); };
["#camIn", "#libIn"].forEach(s => $(s).addEventListener("change", async e => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) await addFiles(fs, curDay || today()); if (curDay) prepShare(curDay); }));

/* ---------- submit to Pulse ---------- */
function b64(blob){ return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(blob); }); }
async function buildPayload(date){
  const x = merged(date), p = phoneDay(date), photos = [];
  let edge = 640, q = 0.72;
  for (let pass = 0; pass < 3; pass++){
    photos.length = 0; let size = 0;
    for (const ph of x.photos){
      const rec = await idbGet("photos", ph.id); if (!rec) continue;
      let blob = rec.small;
      if (pass > 0 || !blob){ const im = await createImageBitmap(rec.full); blob = await toJpeg(im, edge, q); }
      const data = await b64(blob); size += data.length;
      photos.push({id:ph.id, takenAt:ph.takenAt, mime:"image/jpeg", base64:data});
    }
    if (size < 1.3e6) break; edge = pass ? 420 : 512; q = pass ? 0.55 : 0.62;   // shrink until under ~1.3 MB
  }
  const manual = {}; FIELDS.forEach(f => manual[f] = isNum(p.manual[f]) ? +p.manual[f] : null);
  return {app:"food-tracker", version:APP_VERSION, date, tz:TZ, sentAt:nowLocalISO(), notes:p.notes || "", manual,
    heightIn: isNum(S.heightIn) ? +S.heightIn : null, photos};
}
async function markSent(date, via, ids){ const p = phoneDay(date); p.submittedAt = new Date().toISOString(); p.submittedVia = via; p.submittedIds = ids; await savePhoneDay(date); render(); }
let sending = false;
function sendMode(){ return S.sendMode === "shortcut" ? "shortcut" : (S.sendMode === "direct" && S.webhookUrl && S.senderKey) ? "direct" : "share"; }
$("#submitBtn").onclick = () => {
  const d = curDay; if (sending) return;
  if (S.sendMode === "shortcut") return viaShortcut(d);
  if (S.sendMode === "direct" && S.webhookUrl && S.senderKey) return viaWebhook(d);
  return shareDay(d);                                   // default: iOS share sheet
};
async function viaWebhook(d){
  if (!S.webhookUrl || !S.senderKey){ toast("Paste Pulse's webhook URL and sender key in Settings first"); openSettings(); return; }
  sending = true; const btn = $("#submitBtn"); btn.disabled = true; btn.textContent = "Sending…";
  try{
    const pl = await buildPayload(d), body = JSON.stringify(pl);
    const h = {"Content-Type":"application/json"}; h[S.authHeader || "Authorization"] = (S.authScheme || "") + S.senderKey;
    let r;
    try{ r = await fetch(S.webhookUrl, {method:"POST", headers:h, body}); }
    catch(e){ // network down or browser blocked it (CORS)
      $("#failMsg").textContent = navigator.onLine === false ? "You're offline. Try again with signal, or share the day instead."
        : "The browser blocked the direct send (the webhook server doesn't allow web pages to call it, CORS). Nothing was sent. Share the day into Pulse's chat, or use the iOS Shortcut.";
      $("#failSheet").hidden = false; return; }
    if (r.ok){ await markSent(d, "direct", pl.photos.map(p => p.id)); toast("Sent to Pulse ✓"); }
    else { let m = ""; try{ m = (await r.json()).message || ""; }catch(e){}
      $("#failMsg").textContent = `Pulse's webhook answered ${r.status}${m ? " (" + m + ")" : ""}. ` + (r.status === 401 || r.status === 403 ? "Check the sender key in Settings." : r.status === 413 ? "Too much data; try fewer photos." : "Check the URL in Settings, or that Pulse's routine isn't paused.");
      $("#failSheet").hidden = false; }
  } finally { sending = false; btn.disabled = false; renderDay(); }
}
function viaShortcut(d){
  const name = S.shortcutName || "Send to Pulse";
  const pr = buildPayload(d);
  const go = async () => { const pl = await pr; await markSent(d, "shortcut", pl.photos.map(p => p.id));
    location.href = "shortcuts://run-shortcut?name=" + encodeURIComponent(name); };
  try{
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write){ // must start inside the tap (iOS)
      navigator.clipboard.write([new ClipboardItem({"text/plain": pr.then(pl => new Blob([JSON.stringify(pl)], {type:"text/plain"}))})])
        .then(go, e => toast("Couldn't copy the day: " + e.message));
    } else pr.then(pl => navigator.clipboard.writeText(JSON.stringify(pl))).then(go, e => toast("Couldn't copy the day: " + e.message));
  }catch(e){ toast("Couldn't copy the day: " + e.message); }
}

/* ---------- share sheet fallback ---------- */
const shareCache = {};
async function shareParts(d){
  const x = merged(d), p = phoneDay(d), files = [];
  for (const ph of x.photos){ const rec = await idbGet("photos", ph.id); if (rec) files.push(new File([rec.small || rec.full], ph.id + ".jpg", {type:"image/jpeg"})); }
  const man = FIELDS.filter(f => isNum(p.manual[f])).map(f => ({weight:"Weight lb",bmi:"BMI",bodyFat:"Body fat %",muscle:"Muscle %",steps:"Steps",activeCal:"Move cal",exerciseMin:"Exercise min",distanceMi:"Distance mi",standHrs:"Stand hrs"})[f] + ": " + p.manual[f]);
  const text = `Food log for ${fmtD(d,{weekday:"short",month:"short",day:"numeric",year:"numeric"})} (${d}), ${files.length} photo${files.length === 1 ? "" : "s"}.\n` +
    (p.notes ? "Notes: " + p.notes + "\n" : "") + (man.length ? man.join(" · ") + "\n" : "") + (files.length ? "Photo ids: " + x.photos.map(x => x.id).join(", ") : "");
  return {files, text, title:"Food log " + d};
}
async function prepShare(d){ try{ shareCache[d] = await shareParts(d); }catch(e){} }
async function shareDay(d){
  $("#failSheet").hidden = true;
  let parts = shareCache[d]; if (!parts) parts = await shareParts(d);
  if (!navigator.share){ try{ await navigator.clipboard.writeText(parts.text); toast("Sharing isn't available here; day summary copied"); }catch(e){ toast("Sharing isn't available in this browser"); } return; }
  const data = {title:parts.title, text:parts.text};
  if (parts.files.length && navigator.canShare && navigator.canShare({files:parts.files})) data.files = parts.files;
  try{ await navigator.share(data); await markSent(d, "share", phoneDay(d) && photosOn(d).map(p => p.id)); toast("Shared. If you picked Pulse's chat, hit send there."); }
  catch(e){ if (e.name === "NotAllowedError") toast("Tap Share again"); else if (e.name !== "AbortError") toast("Share failed: " + e.message); }
}
$("#shareBtn").onclick = () => shareDay(curDay);
$("#failShare").onclick = () => shareDay(curDay);
$("#failShortcut").onclick = () => { $("#failSheet").hidden = true; viaShortcut(curDay); };
$("#failClose").onclick = () => $("#failSheet").hidden = true;

/* ---------- Pulse data (data/log.json) ---------- */
async function refresh(){
  try{
    const r = await fetch("data/log.json?t=" + Date.now(), {cache:"no-store"});
    if (!r.ok) throw new Error(r.status);
    LOG = await r.json(); LOG.days = LOG.days || {}; logAt = Date.now(); online = true;
    localStorage.setItem(K_LOG, JSON.stringify({log:LOG, at:logAt}));
  }catch(e){ online = false; }
  render(); if (curDay) fillDayInputsKeepFocus();
}
function fillDayInputsKeepFocus(){ const a = document.activeElement; if (a && (a.id === "notes" || (a.id || "").startsWith("m_"))) return; fillDayInputs(); }

/* ---------- settings ---------- */
const SF = ["webhookUrl","senderKey","authHeader","authScheme","sendMode","shortcutName","startWeight","startDate","goalWeight"];
function openSettings(){
  SF.forEach(k => $("#s_" + k).value = S[k] ?? "");
  $("#s_heightFt").value = isNum(S.heightIn) ? Math.floor(S.heightIn / 12) : ""; $("#s_heightIn").value = isNum(S.heightIn) ? +(S.heightIn % 12).toFixed(1) : "";
  ["cal","protein","fat","carbs"].forEach(k => { $("#s_" + k + "0").value = S[k][0]; $("#s_" + k + "1").value = S[k][1]; });
  $("#setVer").textContent = "Fuel · " + APP_VERSION; setStatus(); $("#setSheet").hidden = false;
}
function setStatus(){ $("#setStatus").textContent = (online ? "Pulse data synced " : online === false ? "Offline · Pulse data from " : "Pulse data ") + (logAt ? new Date(logAt).toLocaleString("en-US",{timeZone:TZ,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "not loaded yet"); }
function readSettings(){
  SF.forEach(k => { let v = $("#s_" + k).value.trim(); if (["startWeight","goalWeight"].includes(k)) v = isNum(v) ? +v : DEF[k]; if (k === "authHeader" && !v) v = "Authorization"; if (k === "authScheme") v = v ? v + " " : ""; S[k] = v; });
  const ft = $("#s_heightFt").value.trim(), inch = $("#s_heightIn").value.trim();
  S.heightIn = (isNum(ft) || isNum(inch)) ? (+ft || 0) * 12 + (+inch || 0) : null; if (S.heightIn === 0) S.heightIn = null;
  ["cal","protein","fat","carbs"].forEach(k => { const a = $("#s_" + k + "0").value, b = $("#s_" + k + "1").value;
    if (isNum(a) && isNum(b)) S[k] = [Math.min(+a, +b), Math.max(+a, +b)]; });
  saveSettings(); render();
}
$("#setSheet").addEventListener("change", readSettings);
$("#setSheet").addEventListener("input", e => { if (e.target.id === "s_senderKey" || e.target.id === "s_webhookUrl") readSettings(); });
$("#showKey").onclick = e => { e.preventDefault(); const k = $("#s_senderKey"); k.type = k.type === "password" ? "text" : "password"; $("#showKey").textContent = k.type === "password" ? "Show" : "Hide"; };
$("#settingsBtn").onclick = openSettings;
$("#setClose").onclick = () => { readSettings(); $("#setSheet").hidden = true; };
let swReg = null;
$("#setRefresh").onclick = async () => { const b = $("#setRefresh"); b.disabled = true; b.textContent = "Refreshing…";
  try{ if (swReg) await swReg.update(); }catch(e){}
  await refresh(); setStatus(); b.disabled = false; b.textContent = "Refresh"; toast(online ? "Up to date" : "Offline — showing saved data"); };

/* ---------- misc ---------- */
let toastT = null;
function toast(m){ const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
document.addEventListener("click", e => {
  const w = e.target.closest("[data-day]"); if (w){ openDay(w.dataset.day); return; }
  if (e.target.closest("[data-open-today]") || e.target.closest("#openToday") || e.target.closest("#calCard") || e.target.closest("#todayList")) openDay(today());
});

(async function init(){
  try{ await loadPhone(); }catch(e){ toast("Storage unavailable: " + e.message); }
  render(); refresh();
  try{ if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").then(r => swReg = r).catch(() => {});
    let hadCtl = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadCtl && !reloaded){ reloaded = true; location.reload(); } });
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  window.addEventListener("online", () => refresh());
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 120000);
})();

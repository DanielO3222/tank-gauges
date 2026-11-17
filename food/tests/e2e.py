"""Fuel headless test at iPhone size (390x844): dashboard, add photo, notes, manual entry, week view, settings,
Submit via a local mock webhook (CORS ok + CORS blocked), save_submission.py, pulse_update.py (--no-git), merge.
Screenshots -> /workspace/food-tracker/screenshots (not committed). Leaves food/data/log.json as the seed."""
import json, os, subprocess, sys, threading, time, http.server, socketserver
from playwright.sync_api import sync_playwright
APP = "/workspace/tank-gauges/app"; FOOD = APP + "/food"; OUT = "/workspace/food-tracker"; SS = OUT + "/screenshots"
LOG = FOOD + "/data/log.json"; SEED = open(LOG).read()
os.environ["FUEL_LOG"] = LOG   # tools write the local test copy, not the private repo
open(LOG, "w").write(json.dumps({"schema": 1, "start": {"date": "2026-11-10", "lb": 231.4}, "goal": {"lb": 165}, "weights": [{"date": "2026-11-10", "lb": 231.4}], "days": {}}))
PORT, MOCK = 8771, 8772
ok, bad = [], []
def check(c, m): (ok if c else bad).append(m); print(("PASS " if c else "FAIL ") + m, flush=True)

got = {}
class Mock(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        if self.path.startswith("/ok"):
            self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "authorization,content-type")
            self.send_header("Access-Control-Allow-Methods", "POST")
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n)
        got[self.path] = {"auth": self.headers.get("Authorization"), "ctype": self.headers.get("Content-Type"), "body": body}
        self.send_response(200); self.cors(); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b'{"success":true}')
socketserver.TCPServer.allow_reuse_address = True
ms = socketserver.ThreadingTCPServer(("127.0.0.1", MOCK), Mock); threading.Thread(target=ms.serve_forever, daemon=True).start()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=APP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = f"http://127.0.0.1:{PORT}/food/"
today = subprocess.run(["bash", "-c", "TZ=America/Denver date +%F"], capture_output=True, text=True).stdout.strip()
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width":390,"height":844}, device_scale_factor=3, is_mobile=True, has_touch=True,
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1")
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=f"http://127.0.0.1:{PORT}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto(URL); pg.wait_for_selector(".wd"); pg.wait_for_timeout(600)
    check(pg.inner_text("#wNow") == "231.4", "dashboard weight shows start 231.4: " + pg.inner_text("#wNow"))
    check(pg.inner_text("#wToGo") == "66.4", "to go 66.4: " + pg.inner_text("#wToGo"))
    check(len(pg.query_selector_all(".wd")) == 7, "week view has 7 days")
    check(pg.get_attribute(".wd.today", "data-day") == today, f"week strip ends today {today}")
    check("2,200–2,400" in pg.inner_text("#calLeft"), "calorie target band shown")
    check(len(pg.query_selector_all(".macro")) == 3 and "160–180" in pg.inner_text("#macros"), "3 macro rings, protein 160–180")
    # add photo via + -> Take photo (camera input)
    # header Send to Pulse pill (fd-v1.3)
    hb = pg.evaluate("""()=>{const h=document.querySelector('.hdr').getBoundingClientRect(),p=document.querySelector('#hdrSend').getBoundingClientRect(),d=document.querySelector('#hdrDate').getBoundingClientRect();
      return {hdrH:h.height,pillH:p.height,pillW:p.width,pillLeft:p.left,dateRight:d.right,pillTop:p.top,dateTop:d.top}}""")
    check(hb["hdrH"] < 60 and hb["pillH"] >= 44 and hb["pillLeft"] > hb["dateRight"], f"header stays one line, pill after the date, >=44px tap target {hb}")
    check("Nothing yet" in pg.inner_text("#hdrSendSt"), "pill says Nothing yet on an empty day")
    pg.click("#hdrSend"); check("Nothing to send" in pg.inner_text("#toast"), "empty day: pill explains there's nothing to send")
    pg.click("#openToday"); pg.wait_for_selector("#day:not([hidden])"); pg.fill("#notes", "ate half the rice, 2 rolls"); pg.wait_for_timeout(700); pg.click("#dayBack")
    check("Not sent" in pg.inner_text("#hdrSendSt"), "notes only -> pill shows Not sent")
    pg.evaluate("window.__shared=null; navigator.share=d=>{window.__shared={n:(d.files||[]).length,text:d.text};return Promise.resolve()}; navigator.canShare=()=>true")
    pg.wait_for_timeout(300); pg.click("#hdrSend"); pg.wait_for_function("window.__shared", timeout=5000)
    sh0 = pg.evaluate("window.__shared"); check(sh0["n"] == 0 and "Notes: ate half" in sh0["text"], "one tap on header pill shares TODAY with no photos (notes only)")
    pg.wait_for_timeout(300); check(pg.inner_text("#hdrSendSt").startswith("Sent"), "pill status after send: " + pg.inner_text("#hdrSendSt"))
    pg.click("#fab"); check(pg.is_visible("#addSheet"), "+ opens add sheet")
    check(pg.get_attribute("#camIn", "capture") == "environment" and pg.get_attribute("#camIn", "accept") == "image/*", "camera input accept=image/* capture")
    check(pg.get_attribute("#libIn", "multiple") is not None, "library input allows multiple")
    with pg.expect_file_chooser() as fc: pg.click("#takePhoto")
    fc.value.set_files(OUT + "/test-meal.jpg"); pg.wait_for_selector("#todayList .food img"); pg.wait_for_timeout(400)
    check(len(pg.query_selector_all("#todayList .food")) == 1, "photo saved under today")
    dims = pg.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('fuel-db');q.onsuccess=()=>r(q.result)});
      const all=await new Promise(r=>{const q=db.transaction('photos').objectStore('photos').getAll();q.onsuccess=()=>r(q.result)});
      const dim=async b=>{const i=await createImageBitmap(b);return [i.width,i.height,b.size]};
      return Promise.all(all.map(async p=>({id:p.id,date:p.date,full:await dim(p.full),small:await dim(p.small)})))}""")
    d0 = dims[0]; check(d0["date"] == today and max(d0["full"][:2]) == 1024 and max(d0["small"][:2]) == 640, f"stored 1024 + 640 JPEGs {d0}")
    pid1 = d0["id"]
    # day view
    pg.click("#openToday"); pg.wait_for_selector("#day:not([hidden])")
    with pg.expect_file_chooser() as fc: pg.click("#dayAdd"); pg.click("#pickPhoto")
    fc.value.set_files(OUT + "/test-meal2.jpg"); pg.wait_for_function("document.querySelectorAll('#photoGrid .pcard').length==2")
    check(True, "second photo via library into the open day (2 photos)")
    pg.fill("#notes", "ate half the rice, 2 rolls"); pg.fill("#m_weight", "229.8"); pg.fill("#m_bodyFat", "31.2")
    pg.fill("#m_muscle", "33.5"); pg.fill("#m_steps", "8535"); pg.fill("#m_activeCal", "679")
    pg.fill("#m_exerciseMin", "18"); pg.fill("#m_distanceMi", "3.39"); pg.fill("#m_standHrs", "15"); pg.wait_for_timeout(900)
    check(pg.inner_text("#submitBtn").startswith("Send to Pulse") and "share sheet" in pg.inner_text("#sendHow"), "one 'Send to Pulse' button, defaults to share sheet: " + pg.inner_text("#sendHow"))
    check(pg.inner_text("#noteSaved") == "Saved" and pg.inner_text("#manSaved") == "Saved", "notes + manual autosave")
    pg.click("#dayBack"); pg.wait_for_timeout(300)
    check(pg.inner_text("#wNow") == "229.8" and pg.inner_text("#wLost") == "1.6", "dashboard weight 229.8, lost 1.6")
    a7 = pg.inner_text("#actRow"); check("8,535" in a7 and "679" in a7 and "18" in a7 and "3.39" in a7 and "7-day" in pg.text_content("#actLbl"), "activity strip 7-day avg shows today's Fitness numbers: " + a7.replace("\n", " | "))
    sh = pg.eval_on_selector("#actStrip", "e=>e.getBoundingClientRect().height"); check(sh < 120, f"activity strip is slim ({sh:.0f}px tall)")
    check(pg.query_selector("#steps") is None and pg.inner_text("#actRow").count("Steps") == 1, "one place for steps on the dashboard")
    check(pg.inner_text("#bf") == "31.2%" and pg.inner_text("#mu") == "33.5%", "body fat / muscle on dashboard")
    # settings
    pg.click("#settingsBtn"); pg.wait_for_selector("#setSheet:not([hidden])")
    check(pg.input_value("#s_authHeader") == "Authorization" and pg.input_value("#s_authScheme") == "Bearer ", "auth header defaults")
    check(pg.input_value("#s_fat0") == "65" and pg.input_value("#s_carbs1") == "260", "editable fat/carb targets")
    pg.fill("#s_heightFt", "5"); pg.fill("#s_heightIn", "10"); pg.dispatch_event("#s_heightIn", "change")
    pg.fill("#s_webhookUrl", f"http://127.0.0.1:{MOCK}/ok/hook"); pg.fill("#s_senderKey", "test-key-123"); pg.select_option("#s_sendMode", "direct"); pg.dispatch_event("#s_senderKey", "change")
    pg.wait_for_timeout(2800); pg.screenshot(path=SS + "/settings.png")
    pg.click("#setClose"); pg.wait_for_timeout(300)
    check(pg.inner_text("#bmi") == "33.0", "BMI auto from 5'10\" + 229.8 = 33.0: " + pg.inner_text("#bmi"))
    # persistence after reload
    pg.reload(); pg.wait_for_selector("#todayList .food img")
    check(pg.inner_text("#wNow") == "229.8" and len(pg.query_selector_all("#todayList .food")) == 2, "data persists after reload")
    # submit OK path
    pg.click("#openToday"); pg.wait_for_selector("#day:not([hidden])")
    check(pg.input_value("#notes") == "ate half the rice, 2 rolls", "notes reload")
    pg.click("#submitBtn")
    for _ in range(80):
        if got.get("/ok/hook"): break
        pg.wait_for_timeout(100)
    r = got.get("/ok/hook"); check(r and r["auth"] == "Bearer test-key-123" and r["ctype"] == "application/json", f"POST with Authorization: Bearer + JSON ({r and r['auth']})")
    pl = json.loads(r["body"]); check(pl["app"] == "food-tracker" and pl["date"] == today and len(pl["photos"]) == 2 and pl["notes"].startswith("ate half")
        and pl["manual"]["weight"] == 229.8 and pl["photos"][0]["mime"] == "image/jpeg", "payload shape ok")
    check(len(r["body"]) < 1_300_000, f"payload size {len(r['body'])//1024} KB")
    open(OUT + "/fake-payload.json", "wb").write(r["body"])
    # CORS-blocked path
    pg.click("#dayBack"); pg.click("#settingsBtn"); pg.fill("#s_webhookUrl", f"http://127.0.0.1:{MOCK}/blocked/hook"); pg.dispatch_event("#s_webhookUrl", "change"); pg.click("#setClose"); pg.click("#openToday")
    pg.click("#submitBtn"); pg.wait_for_selector("#failSheet:not([hidden])", timeout=8000)
    check("blocked" in pg.inner_text("#failMsg"), "CORS-blocked send shows 'nothing was sent' + Share/Shortcut options")
    pg.click("#failClose")
    # Send to Pulse in share mode -> one tap opens the share sheet with the photos
    pg.click("#dayBack"); pg.click("#settingsBtn"); pg.select_option("#s_sendMode", "share"); pg.click("#setClose"); pg.click("#openToday")
    pg.evaluate("window.__shared=null; navigator.share=d=>{window.__shared={n:(d.files||[]).length,text:d.text};return Promise.resolve()}; navigator.canShare=()=>true")
    pg.wait_for_timeout(500); pg.click("#submitBtn"); pg.wait_for_function("window.__shared", timeout=5000)
    sh = pg.evaluate("window.__shared"); check(sh["n"] == 2 and "Move cal: 679" in sh["text"] and "Exercise min: 18" in sh["text"], f"Send to Pulse (share mode) opens share sheet with 2 photos + Fitness numbers")
    # save_submission + pulse_update (no git) -> app merge
    s = subprocess.run([sys.executable, FOOD + "/tools/save_submission.py", OUT + "/fake-payload.json"], capture_output=True, text=True); print(s.stdout, s.stderr)
    sd = f"{OUT}/submissions/{today}"; check(os.path.exists(f"{sd}/{pid1}.jpg") and json.load(open(sd + "/submission.json"))["notes"].startswith("ate half"), "save_submission wrote jpgs + submission.json")
    wrapped = json.dumps({"webhook_event": {"body": r["body"].decode()}})
    s = subprocess.run([sys.executable, FOOD + "/tools/save_submission.py", "-", "--out", "/tmp/fuel-sub-test"], input=wrapped, capture_output=True, text=True)
    check("Saved 2 photo" in s.stdout, "save_submission unwraps a nested/stringified payload from stdin")
    pid2 = pl["photos"][1]["id"]
    day = {"entries": [{"photoId": pid1, "food": "Chicken rice plate", "calories": 780, "protein": 52, "fat": 22, "carbs": 90, "note": "half the rice"},
                       {"photoId": pid2, "food": "Tomato soup", "calories": 260, "protein": 8, "fat": 9, "carbs": 34},
                       {"food": "2 dinner rolls", "calories": 240, "protein": 7, "fat": 4, "carbs": 44}],
           "steps": 9000, "weight": 230.1, "pulseNote": "Good protein at lunch; add a shake tonight."}
    u = subprocess.run([sys.executable, FOOD + "/tools/pulse_update.py", "--date", today, "--json", json.dumps(day), "--no-git"], capture_output=True, text=True)
    lj = json.load(open(LOG)); dd = lj["days"][today]
    check(u.returncode == 0 and dd["totals"] == {"calories": 1280, "protein": 67, "fat": 35, "carbs": 168} and dd["status"] == "reviewed", f"pulse_update totals {dd.get('totals')}")
    check({"date": today, "lb": 230.1} in lj["weights"], "pulse_update adds weight to weights[]")
    u = subprocess.run([sys.executable, FOOD + "/tools/pulse_update.py", "--date", today, "--set", "activeCal=600", "--no-git"], capture_output=True, text=True)
    check(json.load(open(LOG))["days"][today]["activeCal"] == 600, "pulse_update --set")
    # yesterday reviewed, for week bars
    import datetime
    y = (datetime.date.fromisoformat(today) - datetime.timedelta(days=1)).isoformat(); y2 = (datetime.date.fromisoformat(today) - datetime.timedelta(days=2)).isoformat()
    subprocess.run([sys.executable, FOOD + "/tools/pulse_update.py", "--date", y, "--json", json.dumps({"totals": {"calories": 2310, "protein": 171, "fat": 72, "carbs": 215}, "weight": 230.6}), "--no-git"], check=True, capture_output=True)
    subprocess.run([sys.executable, FOOD + "/tools/pulse_update.py", "--date", y2, "--json", json.dumps({"totals": {"calories": 2650, "protein": 140, "fat": 95, "carbs": 290}}), "--no-git"], check=True, capture_output=True)
    act = [(1, 10200, 820, 42, 4.6, 12), (2, 6100, 410, 12, 2.4, 9), (10, 12500, 950, 60, 5.8, 13), (20, 14100, 1010, 71, 6.4, 14)]
    for k, st, mv, ex, di, sd in act:
        dk = (datetime.date.fromisoformat(today) - datetime.timedelta(days=k)).isoformat()
        subprocess.run([sys.executable, FOOD + "/tools/pulse_update.py", "--date", dk, "--set", f"steps={st}", f"activeCal={mv}", f"exerciseMin={ex}", f"distanceMi={di}", f"standHrs={sd}", "--no-git"], check=True, capture_output=True)
    check(json.load(open(LOG))["days"][y]["exerciseMin"] == 42, "pulse_update --set exerciseMin/distanceMi/standHrs")
    pg.click("#dayBack"); pg.click("#settingsBtn"); pg.click("#setRefresh"); pg.wait_for_timeout(900); pg.click("#setClose"); pg.click("#openToday")
    pg.wait_for_function("document.querySelector('#dayBadge').textContent.includes('Reviewed')", timeout=5000)
    t = pg.inner_text("#photoGrid"); check("Chicken rice plate" in t and "Tomato soup" in t, "day view shows Pulse entries under photos")
    check("2 dinner rolls" in pg.inner_text("#otherEntries"), "entry without photo under Other items")
    check(pg.input_value("#m_steps") == "8535", "phone steps (8535) win over Pulse's 9000")
    check(pg.input_value("#m_activeCal") == "679", "phone Move cal wins over Pulse's 600")
    check("Pulse:" in pg.inner_text("#pulseNote"), "Pulse note shown")
    pg.wait_for_timeout(2800); pg.screenshot(path=SS + "/day.png", full_page=False)
    pg.add_style_tag(content=".dayHdr{position:static!important}")
    pg.evaluate("document.querySelector('#day').style.position='static'; document.querySelector('#dash').style.display='none'; document.querySelector('.hdr').style.display='none'; document.querySelector('#fab').style.display='none'")
    pg.screenshot(path=SS + "/day-full.png", full_page=True); pg.screenshot(path=SS + "/day-compact.png", full_page=True)
    pg.reload(); pg.wait_for_selector("#todayList .food img"); pg.wait_for_timeout(800)
    check(pg.inner_text("#calEaten") == "1,280", "dashboard calories 1,280 from Pulse: " + pg.inner_text("#calEaten"))
    check("Reviewed" in pg.inner_text("#todayBadge"), "dashboard badge Reviewed")
    check(pg.inner_text("#wNow") == "229.8", "phone weight 229.8 wins over Pulse 230.1 for today")
    check(len(pg.query_selector_all(".wd .fill")) == 3 and len(pg.query_selector_all(".wd .fill.over")) == 1, "week bars: 3 days, 1 over target")
    pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(200); pg.screenshot(path=SS + "/dashboard-screen.png")
    a7 = pg.inner_text("#actRow"); check("8,278" in a7 and "3 days" in pg.inner_text("#actN"), "7-day avg steps (8535+10200+6100)/3 = 8,278: " + a7.replace("\n", " | ") + " / " + pg.inner_text("#actN"))
    pg.screenshot(path=SS + "/activity-7d.png", clip={"x": 0, "y": 0, "width": 390, "height": 844})
    pg.click("#actStrip"); pg.wait_for_timeout(200)
    a30 = pg.inner_text("#actRow"); check("30-day" in pg.text_content("#actLbl") and "10,287" in a30 and "5 days" in pg.inner_text("#actN"), "tap -> 30-day avg steps 10,287 over 5 days: " + a30.replace("\n", " | "))
    pg.screenshot(path=SS + "/activity-month.png", clip={"x": 0, "y": 0, "width": 390, "height": 844})
    pg.click("#actStrip"); check("7-day" in pg.text_content("#actLbl"), "tap again -> back to 7-day")
    fit = pg.evaluate("""()=>{const r=s=>document.querySelector(s).getBoundingClientRect();
      return {week:r('#weekCard').top, weightSummary:r('.progLbl').bottom, chart:r('#wChart').bottom, act:r('#actStrip').height, hero:r('#calCard').height}}""")
    check(fit["weightSummary"] <= 844, f"week, calories, activity, macros + weight summary fit one 390x844 screen {fit}")
    pg.screenshot(path=SS + "/dashboard-compact.png")
    check("Reviewed" in pg.inner_text("#hdrSendSt") or "new" in pg.inner_text("#hdrSendSt") or "Sent" in pg.inner_text("#hdrSendSt"), "pill status with sample data: " + pg.inner_text("#hdrSendSt"))
    pg.screenshot(path=SS + "/header-send.png", clip={"x": 0, "y": 0, "width": 390, "height": 64})
    pg.screenshot(path=SS + "/header-send-context.png")
    # fd-v1.4 header date arrows
    yd = datetime.date.fromisoformat(y); ys = f"{yd.strftime('%a')} {yd.month}/{yd.day}"
    td_ = datetime.date.fromisoformat(today); ts = f"{td_.strftime('%a')} {td_.month}/{td_.day}"
    check(pg.inner_text("#hdrDate") == ts and pg.is_disabled("#hdrNext"), f"header shows {ts}, ▶ disabled on today")
    hw = pg.evaluate("()=>({h:document.querySelector('.hdr').getBoundingClientRect().height, sw:document.documentElement.scrollWidth, gear:document.querySelector('#settingsBtn').getBoundingClientRect().right})")
    check(hw["h"] < 60 and hw["sw"] <= 390 and hw["gear"] <= 390, f"header fits 390px on one line {hw}")
    pg.screenshot(path=SS + "/header-arrows-today.png", clip={"x": 0, "y": 0, "width": 390, "height": 64})
    pg.click("#hdrPrev"); pg.wait_for_timeout(300)
    check(pg.inner_text("#hdrDate") == ys and not pg.is_disabled("#hdrNext"), f"◀ -> {ys}, ▶ enabled")
    check(pg.inner_text("#calEaten") == "2,310" and ys in pg.inner_text("#calLbl"), "calories follow selected day: " + pg.inner_text("#calEaten"))
    check(pg.inner_text("#wNow") == "230.6", "weight as of selected day 230.6: " + pg.inner_text("#wNow"))
    check(pg.eval_on_selector("#actStrip", "e=>e.getBoundingClientRect().height") < 110 and "to " in pg.inner_text("#actN"), "activity strip stays slim on a past day: " + pg.inner_text("#actN"))
    check(f"{ys} 10,200" in pg.inner_text("#actRow"), "activity shows selected day's value: " + pg.inner_text("#actRow").replace("\n"," | "))
    check(pg.get_attribute(".wd.sel", "data-day") == y and pg.eval_on_selector_all(".wd", "e=>e[e.length-1].dataset.day") == y, "week strip shifts to end on and highlight selected day")
    check(ys in pg.inner_text("#foodLbl"), "food card follows selected day")
    check("Reviewed" in pg.inner_text("#hdrSendSt"), "Send pill status is for selected day: " + pg.inner_text("#hdrSendSt"))
    pg.screenshot(path=SS + "/header-arrows.png", clip={"x": 0, "y": 0, "width": 390, "height": 64})
    pg.screenshot(path=SS + "/dashboard-prev-day.png")
    pg.evaluate("window.__shared=null"); pg.click("#hdrSend"); pg.wait_for_timeout(400)
    sh = pg.evaluate("window.__shared"); check(sh is None or y in sh["text"] or "Nothing to send" in pg.inner_text("#toast"), "Send pill acts on selected day")
    pg.click("#fab"); check(yd.strftime("%b") in pg.inner_text("#addTitle") and str(yd.day) in pg.inner_text("#addTitle"), "+ adds to selected day: " + pg.inner_text("#addTitle")); pg.click("#addCancel")
    pg.click("#hdrPrev"); pg.click("#hdrNext"); check(pg.inner_text("#hdrDate") == ys, "▶ steps forward")
    pg.click("#hdrDate"); pg.wait_for_timeout(300)
    check(pg.inner_text("#hdrDate") == ts and pg.inner_text("#calEaten") == "1,280", "tap date jumps back to today")
    # fd-v1.6 sync button + pull to refresh (no key: public/test log)
    hw = pg.evaluate("()=>({sw:document.documentElement.scrollWidth, right:document.querySelector('#settingsBtn').getBoundingClientRect().right, sync:document.querySelector('#syncBtn').getBoundingClientRect().width, h:document.querySelector('.hdr').getBoundingClientRect().height, pillL:document.querySelector('#hdrSend').getBoundingClientRect().left, dateR:document.querySelector('#hdrNext').getBoundingClientRect().right})")
    check(hw["sw"] <= 390 and hw["right"] <= 390 and hw["h"] < 60 and hw["pillL"] > hw["dateR"], f"header with ↻ fits 390px on one line {hw}")
    pg.click("#syncBtn"); pg.wait_for_function("!document.querySelector('#toast').hidden && !document.querySelector('#syncBtn').classList.contains('spin')", timeout=8000)
    check("Up to date" in pg.inner_text("#toast"), "↻ with nothing new -> " + pg.inner_text("#toast"))
    pg.wait_for_timeout(2700)
    y10 = (datetime.date.fromisoformat(today) - datetime.timedelta(days=10)).isoformat(); yd = datetime.date.fromisoformat(y10)
    subprocess.run([sys.executable, FOOD + "/tools/pulse_update.py", "--date", y10, "--add-entry", json.dumps({"food": "Late snack", "calories": 150, "protein": 10, "fat": 5, "carbs": 15}), "--no-git"], check=True, capture_output=True)
    pg.click("#syncBtn"); pg.wait_for_function("!document.querySelector('#toast').hidden && document.querySelector('#toast').innerText.includes('Updated')", timeout=8000)
    md = f"{yd.month}/{yd.day}"
    check(f"Pulse reviewed {md}" in pg.inner_text("#toast") and pg.eval_on_selector("#syncBtn", "e=>e.classList.contains('done')"), "↻ pulls Pulse's change -> " + pg.inner_text("#toast"))
    pg.screenshot(path=SS + "/sync-button.png", clip={"x": 0, "y": 0, "width": 390, "height": 64})
    pg.wait_for_timeout(2700)
    def pull(sel):
        pg.evaluate("""(sel)=>{const el=document.querySelector(sel);const mk=(y)=>new Touch({identifier:1,target:el,clientX:200,clientY:y});
          el.dispatchEvent(new TouchEvent('touchstart',{touches:[mk(100)],bubbles:true}));
          for(const y of [130,170,210,240]) el.dispatchEvent(new TouchEvent('touchmove',{touches:[mk(y)],bubbles:true}));
          el.dispatchEvent(new TouchEvent('touchend',{touches:[],bubbles:true}));}""", sel)
    pg.evaluate("window.scrollTo(0,0)"); pull("#dash")
    pg.wait_for_function("!document.querySelector('#toast').hidden", timeout=8000)
    check("Up to date" in pg.inner_text("#toast") or "Updated" in pg.inner_text("#toast"), "pull-to-refresh on dashboard -> " + pg.inner_text("#toast"))
    pg.wait_for_timeout(2700)
    pg.evaluate(f"openDay('{y10}')"); pg.wait_for_timeout(300); pull("#day")
    pg.wait_for_function("!document.querySelector('#toast').hidden", timeout=8000)
    check("Up to date" in pg.inner_text("#toast"), "pull-to-refresh on day view -> " + pg.inner_text("#toast"))
    check("Late snack" in pg.inner_text("#otherEntries"), "day view shows the pulled entry")
    pg.click("#dayBack"); pg.click("#hdrDate"); yd = datetime.date.fromisoformat(y)
    pg.add_style_tag(content=".fab{display:none!important}")
    pg.screenshot(path=SS + "/dashboard.png", full_page=True)
    pg.click(f".wd[data-day='{y}']"); pg.wait_for_selector("#day:not([hidden])")
    check(pg.inner_text("#dayName") == "Yesterday" and "2,310" in pg.inner_text("#dayTotals"), "tap week day opens that day")
    sw = pg.evaluate("navigator.serviceWorker.getRegistration().then(r=>r&&r.scope)")
    check(sw and sw.endswith("/food/"), f"service worker scope {sw}")
    errs = [e for e in errs if "/blocked/hook" not in e and "Failed to load resource" not in e]; check(not errs, "no console errors (besides the intended CORS block) " + str(errs[:3]))
    b.close()
finally:
    open(LOG, "w").write(SEED); srv.terminate(); ms.shutdown()
print(f"\n{len(ok)} passed, {len(bad)} failed"); sys.exit(1 if bad else 0)

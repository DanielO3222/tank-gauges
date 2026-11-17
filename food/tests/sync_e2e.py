"""Live two-way sync test against the PRIVATE repo (DanielO3222/fuel-data) using a token from env FUEL_TEST_TOKEN
(never printed). Uses test date 2000-01-03 and removes everything it created at the end."""
import base64, json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
APP = "/workspace/tank-gauges/app"; FOOD = APP + "/food"; OUT = "/workspace/food-tracker"; SS = OUT + "/screenshots"
REPO = "DanielO3222/fuel-data"; TD = "2000-01-03"; PORT = 8781
TOK = os.environ.get("FUEL_TEST_TOKEN") or sys.exit("set FUEL_TEST_TOKEN")
os.environ.pop("FUEL_LOG", None)
ok, bad = [], []
def check(c, m): (ok if c else bad).append(m); print(("PASS " if c else "FAIL ") + m, flush=True)
def gh(path, method="GET", **kw):
    args = ["gh", "api", "-X", method, f"repos/{REPO}/contents/{path}"] + sum([["-f", f"{k}={v}"] for k, v in kw.items()], [])
    r = subprocess.run(args, capture_output=True, text=True); return r.returncode, (json.loads(r.stdout) if r.stdout.strip().startswith("{") else None)
def gh_file(path):
    rc, j = gh(path); return json.loads(base64.b64decode(j["content"])) if rc == 0 and j and path.endswith(".json") else (j if rc == 0 else None)
def wait_sync(pg, t=90):
    for _ in range(t * 2):
        s = pg.evaluate("window.__fuel.state()")
        if s["q"] == 0 and s["syncState"] == "ok": return True
        if s["syncState"] == "error": print("sync error:", s["msg"]); return False
        pg.wait_for_timeout(500)
    return False
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=APP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
pid = None
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width":390,"height":844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    ctx.add_init_script("if(!localStorage.getItem('fd-settings')) localStorage.setItem('fd-settings', JSON.stringify({syncKey:%s, syncRepo:%s}))" % (json.dumps(TOK), json.dumps(REPO)))
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("dialog", lambda d: d.accept())
    pg.goto(f"http://127.0.0.1:{PORT}/food/"); pg.wait_for_selector(".wd")
    pg.wait_for_function("window.__fuel && window.__fuel.state().logSrc", timeout=20000)
    st = pg.evaluate("window.__fuel.state()"); check(st["logSrc"] == "private", f"app reads Pulse's log.json from the private repo ({st['logSrc']})")
    check(pg.evaluate("startW()") == 231.4 and pg.evaluate("goalW()") == 165, "start/goal come from private log.json (not public code)")
    check(pg.inner_text("#hdrSend b") == "Ping Pulse", "header pill becomes 'Ping Pulse' with sync on")
    pg.evaluate(f"selDay='{TD}'; render()")
    pg.click("#fab")
    with pg.expect_file_chooser() as fc: pg.click("#pickPhoto")
    fc.value.set_files(OUT + "/test-meal.jpg"); pg.wait_for_selector("#todayList .food img")
    pid = pg.evaluate(f"photosOn('{TD}')[0].id")
    check(wait_sync(pg), "photo add synced")
    pg.evaluate(f"openDay('{TD}')"); pg.fill("#notes", "sync test note"); pg.fill("#m_steps", "1234"); pg.wait_for_timeout(600)
    check(wait_sync(pg), "notes + steps synced")
    d = gh_file(f"days/{TD}.json")
    check(d and d["notes"] == "sync test note" and d["manual"]["steps"] == 1234 and d["photos"][0]["id"] == pid, "days/<date>.json in private repo has notes, steps, photo list")
    ph = gh_file(f"photos/{TD}/{pid}.jpg"); check(ph and ph.get("size", 0) > 5000, f"photos/<date>/<id>.jpg in private repo ({ph and ph.get('size')} bytes)")
    pg.fill("#notes", "second edit"); pg.wait_for_timeout(600); check(wait_sync(pg), "edit synced (sha update)")
    check(gh_file(f"days/{TD}.json")["notes"] == "second edit", "private repo has the edited note")
    # Pulse side: fuel_day.py sees it, pulse_update.py writes the review, app shows it
    fd = subprocess.run([sys.executable, FOOD + "/tools/fuel_day.py", TD], capture_output=True, text=True).stdout
    check("second edit" in fd and pid in fd and os.path.exists(f"/workspace/fuel-data/photos/{TD}/{pid}.jpg"), "fuel_day.py pulls and shows notes + local photo path")
    u = subprocess.run([sys.executable, FOOD + "/tools/pulse_update.py", "--date", TD, "--json", json.dumps({"entries": [{"photoId": pid, "food": "Sync test plate", "calories": 500, "protein": 40, "fat": 20, "carbs": 40}], "pulseNote": "sync test"})], capture_output=True, text=True)
    check(u.returncode == 0 and "Pushed" in u.stdout, "pulse_update.py pushed review to private log.json " + u.stderr[-200:])
    pg.evaluate("refresh()"); pg.wait_for_function("document.querySelector('#photoGrid').innerText.includes('Sync test plate')", timeout=20000)
    check(True, "app shows Pulse's review read back from the private repo")
    pg.fill("#notes", "third edit"); pg.click("#dayBack"); pg.click("#syncBtn")
    pg.wait_for_function("!document.querySelector('#toast').hidden && !document.querySelector('#syncBtn').classList.contains('spin')", timeout=30000)
    tt = pg.inner_text("#toast"); check(("Up to date" in tt or "Updated" in tt) and pg.evaluate("window.__fuel.state().q") == 0, "↻ with key pushes pending edit + pulls private log.json -> " + tt)
    check(gh_file(f"days/{TD}.json")["notes"] == "third edit", "↻ pushed the pending edit immediately")
    pg.click("#settingsBtn"); pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#s_syncKey').value='github_pat_EXAMPLE_not_real_0000000000'")   # never screenshot the real key
    pg.screenshot(path=SS + "/sync-settings.png")
    pg.evaluate("document.querySelector('#setSheet').hidden=true")
    pg.evaluate(f"openDay('{TD}')"); pg.click(f"[data-del='{pid}']"); pg.wait_for_timeout(600)
    check(wait_sync(pg), "photo delete synced")
    check(gh(f"photos/{TD}/{pid}.jpg")[0] != 0, "deleted photo removed from private repo")
    check(not errs, "no page errors " + str(errs[:2]))
    b.close()
finally:
    srv.terminate()
    subprocess.run([sys.executable, FOOD + "/tools/pulse_update.py", "--clear-day", TD, "-m", "Fuel: remove sync test day"], capture_output=True)
    rc, j = gh(f"days/{TD}.json")
    if rc == 0: gh(f"days/{TD}.json", "DELETE", message="Fuel: remove sync test day", sha=j["sha"])
    if pid:
        rc, j = gh(f"photos/{TD}/{pid}.jpg")
        if rc == 0: gh(f"photos/{TD}/{pid}.jpg", "DELETE", message="Fuel: remove sync test photo", sha=j["sha"])
    subprocess.run(["git", "-C", "/workspace/fuel-data", "pull", "-q", "--rebase"], capture_output=True)
    left = [p for p in subprocess.run(["git", "-C", "/workspace/fuel-data", "ls-files"], capture_output=True, text=True).stdout.split() if TD in p]
    lj = json.load(open("/workspace/fuel-data/log.json"))
    check(not left and TD not in lj["days"], f"test data cleaned up (left: {left})")
print(f"\n{len(ok)} passed, {len(bad)} failed"); sys.exit(1 if bad else 0)

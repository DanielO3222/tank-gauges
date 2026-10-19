"""Headless iPhone-size test: today view, date nav, CSV match, list, share PNG, local edit, offline."""
import csv, json, subprocess, time, base64, sys, os
from playwright.sync_api import sync_playwright
APP = "/workspace/tank-gauges/app"; SS = APP + "/screenshots"; URL = "http://127.0.0.1:8765/"
csvrows = list(csv.DictReader(open("/workspace/tank-gauges/gauge-log.csv")))
want = {(r["location"], r["tank"]): f"{r['feet']}' {r['inches']}\"" for r in csvrows}
ROUTE = ["1-20","14-20","16-20","17-20","9-20","11-20","6-20","7-20"]
ok = []; bad = []
def check(cond, msg): (ok if cond else bad).append(msg); print(("PASS " if cond else "FAIL ") + msg)
def full(pg, path):  # full-page shot with the fixed bottom bar moved to the end of the page
    pg.add_style_tag(content=".bottombar{position:static!important} body{padding-bottom:0!important}")
    pg.screenshot(path=path, full_page=True)
    pg.evaluate("document.querySelector('style:last-of-type').remove()")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width":390,"height":844}, device_scale_factor=3, is_mobile=True, has_touch=True,
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type=="error" and errs.append(m.text))
    pg.goto(URL); pg.wait_for_selector("#status:has-text('Synced')")
    today = time.strftime("%Y-%m-%d")
    check(pg.input_value("#picker") == today, f"opens to today ({today})")
    check("TODAY" in pg.inner_text("#weekday"), "weekday shows TODAY: " + pg.inner_text("#weekday"))
    pg.screenshot(path=SS + "/today-empty.png")
    pg.click("[data-go='2026-10-15']"); pg.wait_for_timeout(2600)
    check(pg.inner_text("#weekday").startswith("THURSDAY"), "jump to last gauged day -> " + pg.inner_text("#weekday") + " " + pg.inner_text("#datelong"))
    check(pg.inner_text("#subtitle") == "BRINGELSON · OCT 15, 2026", "subtitle: " + pg.inner_text("#subtitle"))
    locs = pg.eval_on_selector_all(".card .loc", "e=>e.map(x=>x.textContent)")
    check(locs == ROUTE, f"dashboard route order {locs}")
    got = {}
    for c in pg.query_selector_all(".tk"):
        l, _, t = c.get_attribute("data-edit").split("|")[1:] and c.get_attribute("data-edit").split("|")[1], None, c.get_attribute("data-edit").split("|")[2]
        got[(l, t)] = c.query_selector(".val").inner_text().strip()
    check(got == want, "dashboard numbers match CSV (16 readings)")
    h = pg.eval_on_selector(".tk.oil .fill", "e=>e.getBoundingClientRect().height/e.parentElement.clientHeight")
    check(abs(h - (5*12+11)/240) < 0.02, f"1-20 oil fill height {h:.3f} of tank (expect {(71/240):.3f})")
    pg.screenshot(path=SS + "/dashboard-phone-screen.png")
    fit = pg.evaluate("""()=>{const c=[...document.querySelectorAll('.card')];const bar=document.querySelector('.bottombar').getBoundingClientRect().top;
      return {n:c.length, lastBottom:Math.max(...c.map(x=>x.getBoundingClientRect().bottom)), bar, tankH:document.querySelector('.tank').offsetHeight}}""")
    check(fit["n"]==8 and fit["lastBottom"] <= fit["bar"], f"all 8 cards above bottom bar at 390x844 {fit}")
    p2 = ctx.new_page(); p2.set_viewport_size({"width":375,"height":667}); p2.goto(URL + "#2026-10-15"); p2.wait_for_timeout(2600)
    f2 = p2.evaluate("""()=>{const c=[...document.querySelectorAll('.card')];return {lastBottom:Math.max(...c.map(x=>x.getBoundingClientRect().bottom)),
      bar:document.querySelector('.bottombar').getBoundingClientRect().top, tankH:document.querySelector('.tank').offsetHeight}}""")
    check(f2["lastBottom"] - f2["bar"] < 200, f"375x667 overflow {f2['lastBottom']-f2['bar']:.0f}px (minimal scroll) {f2}")
    p2.screenshot(path=SS + "/dashboard-375x667.png"); p2.close()
    full(pg, SS + "/dashboard.png")
    # date nav
    pg.click("#next"); check(pg.input_value("#picker") == "2026-10-16", "next arrow -> Oct 16")
    pg.click("#prev"); pg.click("#prev"); check(pg.input_value("#picker") == "2026-10-14", "prev arrow x2 -> Oct 14")
    pg.fill("#picker", "2026-10-15"); pg.dispatch_event("#picker", "change")
    check(pg.input_value("#picker") == "2026-10-15" and pg.inner_text("#weekday").startswith("THURSDAY"), "date picker -> Oct 15")
    # list view
    pg.click("#tabList"); pg.wait_for_timeout(300)
    rows = pg.eval_on_selector_all(".list tr.r", "e=>e.map(r=>[...r.cells].map(c=>c.textContent.trim()))")
    check([r[0] for r in rows] == ROUTE, "list route order")
    check(all(want[(r[0],"oil")] == r[1] and want[(r[0],"water")] == r[2] for r in rows), "list numbers match CSV")
    pg.screenshot(path=SS + "/list.png")
    # share PNG (no Web Share in headless -> preview sheet)
    pg.click("#shareBtn"); pg.wait_for_selector("#shot:not([hidden])")
    data = pg.evaluate("""async()=>{const r=await fetch(document.querySelector('#shotImg').src);const b=await r.blob();
      return await new Promise(res=>{const f=new FileReader();f.onload=()=>res(f.result);f.readAsDataURL(b);});}""")
    open(SS + "/share-2026-10-15.png","wb").write(base64.b64decode(data.split(",")[1])); check(len(data) > 50000, "share PNG generated")
    pg.click("#shotClose")
    # service worker ready, then offline (server killed) reload
    pg.evaluate("navigator.serviceWorker.ready"); pg.reload(); pg.wait_for_timeout(800)
    check(pg.evaluate("!!navigator.serviceWorker.controller"), "service worker controls page")
    srv = subprocess.run(["pkill","-f","http.server 8765"]); time.sleep(0.5)
    ctx.set_offline(True)
    pg.goto(URL + "#2026-10-15"); pg.wait_for_timeout(1500)
    st = pg.inner_text("#status"); check("Offline" in st, "offline status: " + st)
    rows = pg.eval_on_selector_all(".list tr.r", "e=>e.map(r=>[...r.cells].map(c=>c.textContent.trim()))")
    check(len(rows) == 8 and all(want[(r[0],"oil")] == r[1] for r in rows), "offline reload (server down) still shows Oct 15 numbers")
    pg.screenshot(path=SS + "/offline-list.png")
    # local edit (offline) on Oct 16
    pg.click("#tabTanks"); pg.click("#next"); pg.click("#addBtn")
    pg.select_option("#fFt", "6"); pg.select_option("#fIn", "2"); pg.click("#fSave"); pg.wait_for_timeout(2200)
    check(pg.is_visible(".lbadge") and "1-20" in pg.inner_text(".card .loc"), "local add on Oct 16 shows LOCAL badge")
    d = pg.inner_text(".tk.oil .delta"); check("+3\"" in d, "change since last gauge: " + d)
    check(pg.is_visible("#localBar"), "local edits bar visible")
    pg.screenshot(path=SS + "/local-edit.png")
    check(not errs, "no JS errors " + str(errs))
    b.close()
print(f"\n{len(ok)} passed, {len(bad)} failed"); sys.exit(1 if bad else 0)

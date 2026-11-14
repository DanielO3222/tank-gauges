#!/usr/bin/env python3
"""Pulse -> Fuel app: write a day's reviewed numbers into food/data/log.json, then commit + push.

Examples (run from anywhere):
  # whole day from a JSON file or inline JSON (keys as in food/data/README.md)
  python3 pulse_update.py --date 2026-11-14 --json day.json
  python3 pulse_update.py --date 2026-11-14 --json '{"entries":[{"photoId":"2026-11-14-121503-ab12","food":"Chicken burrito bowl","calories":720,"protein":48,"fat":24,"carbs":78}],"pulseNote":"Solid protein."}'
  # add one entry (keeps existing ones), set metrics, ask a question
  python3 pulse_update.py --date 2026-11-14 --add-entry '{"food":"2 dinner rolls","calories":240,"protein":7,"fat":4,"carbs":44}'
  python3 pulse_update.py --date 2026-11-14 --set steps=8421 activeCal=512 weight=229.8 bodyFat=31.2 muscle=33.5 bmi=33.1
  python3 pulse_update.py --date 2026-11-14 --status needs-info --note "Was the shake made with milk or water?"
  python3 pulse_update.py --weight 2026-11-15 229.6        # weigh-in only
  python3 pulse_update.py --show 2026-11-14                # print a day, no changes
  python3 pulse_update.py --clear-day 2026-11-14           # remove Pulse's data for a day
Flags: --no-push (write + commit only), --no-git (write file only), --status reviewed|in-review|needs-info|submitted.
Totals are recomputed from entries unless you pass "totals" yourself. Writing entries/totals sets status "reviewed"
unless --status is given. Standard library only.
"""
import argparse, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.normpath(os.path.join(HERE, "..", "data", "log.json"))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
REL = os.path.relpath(LOG, REPO)
NUM = ["weight", "bmi", "bodyFat", "muscle", "steps", "activeCal"]
SECRET = "/home/box/.secrets/github-tankgauges.txt"
CRED = ('!f() { echo username=DanielO3222; '
        'if [ -n "$GITHUB_TANKGAUGES_PASSWORD" ]; then echo "password=$GITHUB_TANKGAUGES_PASSWORD"; '
        'else echo "password=$(cat ' + SECRET + ')"; fi; }; f')

def git(*a, check=True):
    cmd = ["git", "-C", REPO, "-c", "credential.helper=", "-c", "credential.helper=" + CRED,
           "-c", "user.name=DanielO3222", "-c", "user.email=odisus@mail.grokbot.com", *a]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode: sys.exit(f"git {a[0]} failed: {r.stderr.strip()[-400:]}")
    return r

def now(): return time.strftime("%Y-%m-%dT%H:%M:%S") + (lambda z: z[:3] + ":" + z[3:])(time.strftime("%z"))
def load():
    with open(LOG, encoding="utf-8") as f: d = json.load(f)
    d.setdefault("days", {}); d.setdefault("weights", []); return d
def save(d):
    d["updated"] = now()
    with open(LOG, "w", encoding="utf-8") as f: json.dump(d, f, indent=1, ensure_ascii=False); f.write("\n")
def num(v):
    v = float(v); return int(v) if v.is_integer() else round(v, 2)
def totals(es):
    t = {k: 0 for k in ("calories", "protein", "fat", "carbs")}
    for e in es:
        for k in t:
            try: t[k] += float(e.get(k) or 0)
            except (TypeError, ValueError): pass
    return {k: num(v) for k, v in t.items()}
def set_weight(d, date, lb):
    d["weights"] = [w for w in d["weights"] if w.get("date") != date] + [{"date": date, "lb": num(lb)}]
    d["weights"].sort(key=lambda w: w["date"])
def parse_json(s):
    return json.load(open(s, encoding="utf-8")) if os.path.exists(s) else json.loads(s)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date"); ap.add_argument("--json"); ap.add_argument("--add-entry", action="append", default=[])
    ap.add_argument("--set", nargs="+", default=[]); ap.add_argument("--note"); ap.add_argument("--status")
    ap.add_argument("--weight", nargs=2, metavar=("DATE", "LB")); ap.add_argument("--show"); ap.add_argument("--clear-day")
    ap.add_argument("--no-push", action="store_true"); ap.add_argument("--no-git", action="store_true")
    ap.add_argument("-m", "--message")
    a = ap.parse_args()
    if a.show:
        d = load(); print(json.dumps(d["days"].get(a.show, {}), indent=1)); return 0
    if not a.no_git: git("pull", "--rebase", "--autostash", "-q", check=False)
    d = load(); date = a.date or (a.weight[0] if a.weight else None) or a.clear_day
    if not date: ap.error("need --date (or --weight / --clear-day)")
    if a.clear_day:
        d["days"].pop(date, None); d["weights"] = [w for w in d["weights"] if w.get("date") != date or w.get("date") == d.get("start", {}).get("date")]
        msg = f"Fuel: clear {date}"
    else:
        day = d["days"].setdefault(date, {}); touched_food = False
        if a.json:
            j = parse_json(a.json)
            for k, v in j.items(): day[k] = v
            touched_food = "entries" in j or "totals" in j
            if "entries" in j and "totals" not in j: day.pop("totals", None)
        for e in a.add_entry:
            day.setdefault("entries", []).append(parse_json(e)); touched_food = True; day.pop("totals", None)
        for kv in a.set:
            k, _, v = kv.partition("=")
            if k not in NUM: sys.exit(f"--set: unknown field {k} (use {', '.join(NUM)})")
            day[k] = None if v == "" else num(v)
        if a.note is not None: day["pulseNote"] = a.note
        if a.weight: day["weight"] = num(a.weight[1])
        if day.get("entries") and not day.get("totals"): day["totals"] = totals(day["entries"])
        if a.status: day["status"] = a.status
        elif touched_food: day["status"] = "reviewed"
        if day.get("status") == "reviewed": day["reviewedAt"] = now()
        if isinstance(day.get("weight"), (int, float)): set_weight(d, date, day["weight"])
        msg = a.message or f"Fuel: Pulse update {date}"
    save(d)
    print(json.dumps(d["days"].get(date, {}), indent=1))
    if a.no_git: return 0
    git("add", REL)
    r = git("commit", "-q", "-m", msg, "--", REL, check=False)
    if r.returncode and "nothing to commit" in (r.stdout + r.stderr): print("No change to commit."); return 0
    if r.returncode: sys.exit("commit failed: " + r.stderr.strip()[-300:])
    if a.no_push: print("Committed (not pushed)."); return 0
    if git("push", "-q", "origin", "HEAD:main", check=False).returncode:
        git("pull", "--rebase", "--autostash", "-q"); git("push", "-q", "origin", "HEAD:main")
    print("Pushed. The app shows it after GitHub Pages rebuilds (~1 min) and the app refreshes.")
    return 0

if __name__ == "__main__":
    sys.exit(main())

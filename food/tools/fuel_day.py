#!/usr/bin/env python3
"""Pulse: see what Daniel logged in the Fuel app (synced to the private repo DanielO3222/fuel-data).

  python3 fuel_day.py                 # pull, then show today (America/Denver)
  python3 fuel_day.py 2026-11-14      # one day: notes, manual numbers, photo file paths, Pulse's current review
  python3 fuel_day.py --recent 7      # list the last 7 days that have app data, with photo counts and review status
  python3 fuel_day.py --json DATE     # raw day JSON (app side) + Pulse's log entry
Photos are local files after the pull: /workspace/fuel-data/photos/<date>/<photoId>.jpg (open with the file reader).
Env FUEL_DATA_DIR overrides the clone path. Standard library only.
"""
import json, os, subprocess, sys, datetime
D = os.environ.get("FUEL_DATA_DIR", "/workspace/fuel-data")

def today():
    os.environ.setdefault("TZ", "America/Denver")
    try:
        import time; time.tzset()
    except Exception: pass
    return datetime.date.today().isoformat()

def pull():
    if not os.path.isdir(os.path.join(D, ".git")):
        r = subprocess.run(["git", "clone", "-q", "https://github.com/DanielO3222/fuel-data.git", D], capture_output=True, text=True)
    else:
        r = subprocess.run(["git", "-C", D, "pull", "-q", "--rebase", "--autostash"], capture_output=True, text=True)
    if r.returncode: print("warning: git pull failed:", r.stderr.strip()[-300:], file=sys.stderr)

def load(p, default=None):
    try:
        with open(p, encoding="utf-8") as f: return json.load(f)
    except (OSError, ValueError): return default

def show(date, raw=False):
    day = load(os.path.join(D, "days", date + ".json"))
    log = load(os.path.join(D, "log.json"), {}) or {}
    rev = (log.get("days") or {}).get(date)
    if raw: print(json.dumps({"app": day, "pulse": rev}, indent=1)); return
    if not day: print(f"{date}: nothing synced from the app yet."); 
    else:
        print(f"{date}  (app updated {day.get('updatedAt')}, version {day.get('version')})")
        print("Notes:", day.get("notes") or "—")
        man = {k: v for k, v in (day.get("manual") or {}).items() if v is not None}
        print("Manual:", json.dumps(man) if man else "—")
        for p in day.get("photos") or []:
            fp = os.path.join(D, p["path"]); print(f"  photo {p['id']}  taken {p.get('takenAt')}  {fp}{'' if os.path.exists(fp) else '  (not synced yet)'}")
        if day.get("submittedAt"): print("Daniel pinged/sent:", day["submittedAt"], "via", day.get("submittedVia"))
    if rev:
        print(f"Pulse review: status={rev.get('status')} totals={rev.get('totals')} entries={len(rev.get('entries') or [])}")
        done = {e.get('photoId') for e in rev.get('entries') or []}
        todo = [p['id'] for p in (day or {}).get('photos') or [] if p['id'] not in done]
        if todo: print("Photos without a Pulse entry yet:", ", ".join(todo))
    elif day: print("Pulse review: none yet")

def recent(n):
    log = (load(os.path.join(D, "log.json"), {}) or {}).get("days") or {}
    days = sorted([f[:-5] for f in os.listdir(os.path.join(D, "days")) if f.endswith(".json")], reverse=True)[:n]
    for d in days:
        day = load(os.path.join(D, "days", d + ".json"), {}) or {}
        print(f"{d}  photos={len(day.get('photos') or [])}  notes={'yes' if day.get('notes') else 'no'}  updated={day.get('updatedAt')}  pulse={(log.get(d) or {}).get('status', '—')}")

if __name__ == "__main__":
    a = sys.argv[1:]; pull()
    if a[:1] == ["--recent"]: recent(int(a[1]) if len(a) > 1 else 7)
    elif a[:1] == ["--json"]: show(a[1] if len(a) > 1 else today(), raw=True)
    else: show(a[0] if a else today())

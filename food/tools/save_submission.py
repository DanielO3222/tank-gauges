#!/usr/bin/env python3
"""Save a Fuel (food tracker) Submit payload so Pulse can look at the photos.

Usage:
  python3 save_submission.py payload.json          # a file holding the webhook JSON body
  python3 save_submission.py - < payload.json      # or stdin
  python3 save_submission.py payload.json --out /some/dir   # default /workspace/food-tracker/submissions

Accepts the bare payload {"app":"food-tracker","date":...,"photos":[...]} or that payload nested anywhere
inside a wrapper (e.g. {"body": {...}} or a JSON string). Writes:
  <out>/<date>/<photoId>.jpg          one per photo (open these with the file reader)
  <out>/<date>/submission.json        date, notes, manual values, photo file list (no base64)
  <out>/<date>/submission-<HHMMSS>.json  the same, kept per send (resubmits don't erase history)
Standard library only.
"""
import base64, json, os, re, sys, time

DEFAULT_OUT = "/workspace/food-tracker/submissions"

def find_payload(x, depth=0):
    if depth > 6: return None
    if isinstance(x, str):
        s = x.strip()
        if s.startswith("{"):
            try: return find_payload(json.loads(s), depth + 1)
            except ValueError: return None
        return None
    if isinstance(x, dict):
        if x.get("app") == "food-tracker" or ("date" in x and "photos" in x): return x
        for v in x.values():
            p = find_payload(v, depth + 1)
            if p: return p
    if isinstance(x, list):
        for v in x:
            p = find_payload(v, depth + 1)
            if p: return p
    return None

def main(argv):
    args = [a for a in argv if a != "--out"]
    out = DEFAULT_OUT
    if "--out" in argv: out = argv[argv.index("--out") + 1]; args.remove(out)
    src = args[0] if args else "-"
    raw = sys.stdin.read() if src == "-" else open(src, encoding="utf-8").read()
    try: data = json.loads(raw)
    except ValueError: data = raw
    p = find_payload(data)
    if not p: sys.exit("No food-tracker payload found (need app='food-tracker' with date and photos).")
    date = str(p.get("date", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date): sys.exit(f"Bad date: {date!r}")
    d = os.path.join(out, date); os.makedirs(d, exist_ok=True)
    files = []
    for i, ph in enumerate(p.get("photos") or []):
        pid = re.sub(r"[^A-Za-z0-9_-]", "_", str(ph.get("id") or f"{date}-photo{i+1}"))[:80]
        b = ph.get("base64") or ""
        if b.startswith("data:"): b = b.split(",", 1)[1]
        try: blob = base64.b64decode(b, validate=False)
        except Exception as e: print(f"skip {pid}: {e}", file=sys.stderr); continue
        path = os.path.join(d, pid + ".jpg")
        with open(path, "wb") as f: f.write(blob)
        files.append({"id": pid, "takenAt": ph.get("takenAt"), "path": path, "bytes": len(blob)})
    rec = {"date": date, "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "sentAt": p.get("sentAt"),
           "version": p.get("version"), "notes": p.get("notes", ""), "manual": p.get("manual") or {},
           "heightIn": p.get("heightIn"), "photos": files}
    for name in ("submission.json", "submission-" + time.strftime("%H%M%S") + ".json"):
        with open(os.path.join(d, name), "w", encoding="utf-8") as f: json.dump(rec, f, indent=1)
    print(f"Saved {len(files)} photo(s) for {date} -> {d}")
    if rec["notes"]: print("Notes:", rec["notes"])
    man = {k: v for k, v in rec["manual"].items() if v not in (None, "")}
    if man: print("Manual:", json.dumps(man))
    for f in files: print(f"  {f['id']}: {f['path']} ({f['bytes']//1024} KB, taken {f['takenAt']})")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

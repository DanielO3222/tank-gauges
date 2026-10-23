#!/usr/bin/env python3
"""Add or fix compressor readings in compressors/data/compressors.json.

Examples:
  add_compressor.py --date 2026-10-22 --batch "speed goat suction 45 rpm 1180; fiscus suction 50 rpm 1200"
  add_compressor.py --batch "timbro 1931 rpm 1150; bfed suction 38"      # today, partial is fine
  add_compressor.py --show --date 2026-10-22
  add_compressor.py --delete "peanut" --date 2026-10-22
Names match loosely: speedgoat, fiscus, timbro 1 / timbro 01, timbro 1931, bfed, bringelson / 5-20, peanut,
  sonic star / sonicstar, boydston 1|2|3 / boydston #2, shull 35, shull 25, martin, caster.
Fields: any key in the file's "fields" (suction, rpm, ...). Values are numbers.
"""
import argparse, datetime, json, os, re, sys, tempfile
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Denver")
PATH = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "compressors", "data", "compressors.json"))
ALIASES = {"suc": "suction", "psi": "suction", "suct": "suction", "rpms": "rpm"}


# Display order lives in compressors/data/compressors.json ("compressors" array) — reorder there.
# Loose name matching: (id, test on the lowercase alphanumeric-only name). First match wins.
MATCH = [
    ("timbro-1931", lambda n: "1931" in n),
    ("timbro-01", lambda n: n.startswith("timbro")),
    ("speed-goat", lambda n: "speed" in n or "goat" in n),
    ("fiscus", lambda n: n.startswith("fiscus")),
    ("b-fed", lambda n: n.startswith("bfed")),
    ("bringelson-13-20", lambda n: "1320" in n),
    ("bringelson-5-20", lambda n: "520" in n),
    ("peanut", lambda n: n.startswith("peanut")),
    ("sonic-star", lambda n: n.startswith("sonic")),
    ("boydston-1", lambda n: n.startswith("boyd") and n.endswith("1")),
    ("boydston-2", lambda n: n.startswith("boyd") and n.endswith("2")),
    ("boydston-3", lambda n: n.startswith("boyd") and n.endswith("3")),
    ("shull-35", lambda n: n.startswith("shul") and n.endswith("35")),
    ("shull-25", lambda n: n.startswith("shul") and n.endswith("25")),
    ("martin", lambda n: n.startswith("martin")),
    ("caster", lambda n: n.startswith("caster") or n.startswith("castor")),
]


def comp_id(name):
    n = re.sub(r"[^a-z0-9]", "", name.lower())
    for cid, test in MATCH:
        if test(n): return cid
    raise ValueError(f"unknown compressor {name!r}")


def parse_batch(s, keys):
    kw = "|".join(sorted(set(keys) | set(ALIASES), key=len, reverse=True))
    out = []
    for part in re.split(r"[;\n]", s):
        part = part.strip()
        if not part: continue
        m = re.match(rf"(.+?)\s+(?=(?:{kw})\s+\d)", part, re.I)
        if not m: raise SystemExit(f"can't parse {part!r} (want e.g. 'speed goat suction 45 rpm 1180')")
        cid, rest, vals = comp_id(m.group(1)), part[m.end():], {}
        for k, v in re.findall(rf"({kw})\s+(\d[\d,]*(?:\.\d+)?)", rest, re.I):
            k = ALIASES.get(k.lower(), k.lower()); v = float(v.replace(",", ""))
            vals[k] = int(v) if v.is_integer() else v
        if not vals: raise SystemExit(f"no values in {part!r}")
        out.append((cid, vals))
    return out


def save(db, path):
    db["updated"] = datetime.datetime.now(TZ).isoformat(timespec="seconds")
    db["days"] = dict(sorted(db["days"].items()))
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(db, f, indent=1); f.write("\n")
    os.replace(tmp, path)


def carried(db, date, cid):
    """Set points carry forward: per field, newest value on or before date -> {field: (value, set_date)}."""
    out = {}
    for d in sorted(db["days"]):
        if d > date: break
        for k, v in (db["days"][d].get(cid) or {}).items():
            out[k] = (v, d)
    return out


def show(db, date):
    lines = [f"Compressors {date} (carried forward)"]
    for c in db["compressors"]:
        r = carried(db, date, c["id"])
        lines.append(f"  {c['name']:<16} " + (" ".join(f"{k} {v} (set {d[5:]})" if d != date else f"{k} {v}" for k, (v, d) in r.items()) if r else "—"))
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--file", default=PATH)
    p.add_argument("--date", default=None)
    p.add_argument("--batch")
    p.add_argument("--show", action="store_true")
    p.add_argument("--delete", metavar="NAME")
    a = p.parse_args()
    with open(a.file) as f: db = json.load(f)
    date = a.date or datetime.datetime.now(TZ).date().isoformat()
    datetime.date.fromisoformat(date)
    if a.show: print(show(db, date)); return
    if a.delete:
        day = db["days"].get(date, {}); day.pop(comp_id(a.delete), None)
        if not day: db["days"].pop(date, None)
        save(db, a.file); print(show(db, date)); return
    if not a.batch: p.error("nothing to do (use --batch, --show or --delete)")
    keys = list(db.get("fields", {"suction": 0, "rpm": 0}).keys())
    for cid, vals in parse_batch(a.batch, keys):
        for k, v in vals.items():
            if v < 0: sys.exit(f"error: {cid} {k} must be >= 0 (nothing written)")
        db["days"].setdefault(date, {}).setdefault(cid, {}).update(vals)
        print(f"{date} {cid} {vals}")
    save(db, a.file); print(show(db, date))


if __name__ == "__main__":
    main()

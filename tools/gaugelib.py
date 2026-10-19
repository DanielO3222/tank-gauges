"""Shared helpers for the Tank Gauges data file (data/gauges.json).

Schema (version 1):
{
  "schema": 1,
  "updated": "2026-10-18T19:20:00-06:00",   # ISO time of last write (America/Denver)
  "max_ft": 20,                              # tank height used for the fill scale
  "default_lease": "bringelson",
  "leases": {                                # lease id -> name + route order
    "bringelson": {"name": "Bringelson",
                   "route": ["1-20","14-20","16-20","17-20","9-20","11-20","6-20","7-20"]}
  },
  "days": {                                  # YYYY-MM-DD -> list of lease groups
    "2026-10-15": [
      {"lease": "bringelson",
       "locations": [                        # kept in the lease's route order
         {"loc": "1-20", "oil": {"ft": 5, "in": 11}, "water": {"ft": 7, "in": 3}}
       ]}
    ]
  }
}
A tank that wasn't gauged is simply absent (or null).
"""
import json, os, tempfile, datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Denver")
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "gauges.json"))
DEFAULT_ROUTE = ["1-20", "14-20", "16-20", "17-20", "9-20", "11-20", "6-20", "7-20"]
TANKS = ("oil", "water")


def now_iso():
    return datetime.datetime.now(TZ).isoformat(timespec="seconds")


def today():
    return datetime.datetime.now(TZ).date().isoformat()


def slug(name):
    return "".join(c.lower() if c.isalnum() else "-" for c in name.strip()).strip("-")


def empty_db():
    return {"schema": 1, "updated": now_iso(), "max_ft": 20, "default_lease": "bringelson",
            "leases": {"bringelson": {"name": "Bringelson", "route": list(DEFAULT_ROUTE)}},
            "days": {}}


def load(path=DEFAULT_PATH):
    if not os.path.exists(path):
        return empty_db()
    with open(path) as f:
        return json.load(f)


def save(db, path=DEFAULT_PATH):
    db["updated"] = now_iso()
    db["days"] = dict(sorted(db["days"].items()))
    for date, groups in db["days"].items():
        for g in groups:
            sort_group(db, g)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(db, f, indent=1)
        f.write("\n")
    os.replace(tmp, path)  # atomic


def ensure_lease(db, lease):
    lid = slug(lease)
    if lid not in db["leases"]:
        db["leases"][lid] = {"name": lease.strip().title(), "route": []}
    return lid


def sort_group(db, g):
    route = db["leases"].get(g["lease"], {}).get("route", [])
    idx = {loc: i for i, loc in enumerate(route)}
    g["locations"].sort(key=lambda r: (idx.get(r["loc"], 10**6), r["loc"]))


def validate(db, ft, inch, force=False):
    if not (0 <= inch <= 11):
        raise ValueError(f"inches must be 0-11, got {inch}")
    if ft < 0 or (ft > db.get("max_ft", 20) and not force):
        raise ValueError(f"feet must be 0-{db.get('max_ft', 20)}, got {ft} (use --force to override)")
    if ft == db.get("max_ft", 20) and inch > 0 and not force:
        raise ValueError("reading is above the top of the tank (use --force to override)")


def set_reading(db, date, lease, loc, tank, ft, inch, force=False, add_to_route=True):
    """Insert/replace one reading. Returns the previous value (or None)."""
    assert tank in TANKS, tank
    datetime.date.fromisoformat(date)  # validate format
    validate(db, ft, inch, force)
    lid = ensure_lease(db, lease)
    loc = loc.strip().upper() if not loc.strip()[0].isdigit() else loc.strip()
    route = db["leases"][lid]["route"]
    if add_to_route and loc not in route:
        route.append(loc)
    groups = db["days"].setdefault(date, [])
    g = next((g for g in groups if g["lease"] == lid), None)
    if g is None:
        g = {"lease": lid, "locations": []}
        groups.append(g)
    row = next((r for r in g["locations"] if r["loc"] == loc), None)
    if row is None:
        row = {"loc": loc}
        g["locations"].append(row)
    prev = row.get(tank)
    row[tank] = {"ft": int(ft), "in": int(inch)}
    sort_group(db, g)
    return prev


def delete_reading(db, date, lease, loc, tank=None):
    lid = slug(lease)
    groups = db["days"].get(date, [])
    for g in groups:
        if g["lease"] != lid:
            continue
        for r in list(g["locations"]):
            if r["loc"] == loc:
                if tank:
                    r.pop(tank, None)
                if not tank or not any(r.get(t) for t in TANKS):
                    g["locations"].remove(r)
        if not g["locations"]:
            groups.remove(g)
    if not groups:
        db["days"].pop(date, None)


def fmt(v):
    return "—" if not v else f"{v['ft']}' {v['in']}\""


def day_table(db, date):
    out = []
    for g in db["days"].get(date, []):
        out.append(f"{db['leases'].get(g['lease'], {}).get('name', g['lease'])}  {date}")
        for r in g["locations"]:
            out.append(f"  {r['loc']:<8} oil {fmt(r.get('oil')):<8} water {fmt(r.get('water'))}")
    return "\n".join(out) or f"(no readings for {date})"

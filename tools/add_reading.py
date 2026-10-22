#!/usr/bin/env python3
"""Add or fix tank readings in data/gauges.json.

Examples:
  add_reading.py --loc 14-20 --tank oil --ft 8 --in 11                 # today, default lease
  add_reading.py --date 2026-10-15 --loc 9-20 --tank oil --ft 1 --in 11
  add_reading.py --batch "14-20 oil 8 11; 14-20 water 6 1; 16-20 oil 13 6"
  add_reading.py --batch "B-Fed haul 1250; Timbro 01 haul 840"        # daily total bbl hauled
  add_reading.py --delete-haul "B-Fed" --date 2026-10-22
  add_reading.py --lease "Speed Goat" --loc 3-20 --tank water --ft 4 --in 2
  add_reading.py --delete --date 2026-10-15 --loc 9-20 --tank oil
  add_reading.py --show --date 2026-10-15
  add_reading.py --route bringelson "1-20,14-20,16-20,17-20,9-20,11-20,6-20,7-20"
Inches must be 0-11; feet 0-max_ft (20). Writes are atomic.
"""
import argparse, re, sys
import gaugelib as gl


def parse_batch(s):
    items = []
    for part in re.split(r"[;\n]", s):
        part = part.strip()
        if not part:
            continue
        h = re.fullmatch(r"(b\s*-?\s*fed|timbro(?:\s*-?\s*(?:0?1|1931))?)\s+haul(?:ed|s)?\s+(\d[\d,]*)(?:\s*(?:bbls?|barrels?))?", part, re.I)
        if h:
            items.append(("haul", gl.hauler_id(h.group(1)), int(h.group(2).replace(",", "")), 0))
            continue
        m = re.fullmatch(r"(\S+)\s+(oil|water)\s+(\d+)(?:\s*(?:'|ft|-|\s)\s*(\d+)\"?)?", part, re.I)
        if not m:
            raise SystemExit(f"can't parse batch item: {part!r} (want e.g. '14-20 oil 8 11')")
        items.append((m.group(1), m.group(2).lower(), int(m.group(3)), int(m.group(4) or 0)))
    return items


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--file", default=gl.DEFAULT_PATH)
    p.add_argument("--date", default=None, help="YYYY-MM-DD (default: today, America/Denver)")
    p.add_argument("--lease", default=None, help="lease name/id (default: file's default_lease)")
    p.add_argument("--loc")
    p.add_argument("--tank", choices=gl.TANKS)
    p.add_argument("--ft", type=int)
    p.add_argument("--in", dest="inch", type=int, default=0)
    p.add_argument("--batch", help="'LOC TANK FT IN; ...'")
    p.add_argument("--delete", action="store_true")
    p.add_argument("--show", action="store_true")
    p.add_argument("--delete-haul", metavar="HAULER", help="remove a day's haul (B-Fed / Timbro 01)")
    p.add_argument("--route", nargs=2, metavar=("LEASE", "LOC,LOC,..."), help="set a lease's route order")
    p.add_argument("--force", action="store_true", help="allow readings above max_ft")
    a = p.parse_args()

    db = gl.load(a.file)
    date = a.date or gl.today()
    lease = a.lease or db.get("default_lease", "bringelson")

    if a.show:
        print(gl.day_table(db, date)); return
    if a.route:
        lid = gl.ensure_lease(db, a.route[0])
        db["leases"][lid]["route"] = [x.strip() for x in a.route[1].split(",") if x.strip()]
        gl.save(db, a.file); print(f"route for {lid}: {db['leases'][lid]['route']}"); return
    if a.delete_haul:
        gl.delete_haul(db, date, a.delete_haul)
        gl.save(db, a.file); print(gl.day_table(db, date)); return
    if a.delete:
        if not a.loc: p.error("--delete needs --loc")
        gl.delete_reading(db, date, lease, a.loc, a.tank)
        gl.save(db, a.file); print(gl.day_table(db, date)); return

    items = parse_batch(a.batch) if a.batch else []
    if a.loc or a.tank or a.ft is not None:
        if not (a.loc and a.tank and a.ft is not None):
            p.error("need --loc, --tank and --ft (and optionally --in)")
        items.append((a.loc, a.tank, a.ft, a.inch))
    if not items:
        p.error("nothing to do")
    for loc, tank, ft, inch in items:
        if loc == "haul":
            try:
                prev = gl.set_haul(db, date, lease, tank, ft, force=a.force)
            except ValueError as e:
                sys.exit(f"error: haul {tank}: {e}  (nothing written)")
            print(f"{date} haul {tank} = {ft} bbl" + (f" (was {prev})" if prev is not None else ""))
            continue
        try:
            prev = gl.set_reading(db, date, lease, loc, tank, ft, inch, force=a.force)
        except ValueError as e:
            sys.exit(f"error: {loc} {tank}: {e}  (nothing written)")
        note = f" (was {gl.fmt(prev)})" if prev else ""
        print(f"{date} {loc} {tank} = {ft}' {inch}\"{note}")
    gl.save(db, a.file)
    print(gl.day_table(db, date))


if __name__ == "__main__":
    main()

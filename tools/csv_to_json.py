#!/usr/bin/env python3
"""Convert a gauge-log CSV (date,location,tank,feet,inches[,lease]) into data/gauges.json.

  csv_to_json.py ../../gauge-log.csv                 # merge into existing gauges.json
  csv_to_json.py ../../gauge-log.csv --replace       # start fresh
  csv_to_json.py log.csv --lease Bringelson --out other.json
Rows merge by (date, lease, location, tank); later rows win.
"""
import argparse, csv
import gaugelib as gl

p = argparse.ArgumentParser()
p.add_argument("csv")
p.add_argument("--out", default=gl.DEFAULT_PATH)
p.add_argument("--lease", default=None, help="lease for rows without a lease column")
p.add_argument("--replace", action="store_true")
a = p.parse_args()

db = gl.empty_db() if a.replace else gl.load(a.out)
n = 0
with open(a.csv) as f:
    for r in csv.DictReader(f):
        lease = r.get("lease") or a.lease or db["default_lease"]
        gl.set_reading(db, r["date"], lease, r["location"], r["tank"].strip().lower(),
                       int(r["feet"]), int(r["inches"]), force=True)
        n += 1
gl.save(db, a.out)
print(f"{n} rows -> {a.out}")
for d in db["days"]:
    print(gl.day_table(db, d))

# Tank Gauges (v1)

Phone-first web app (PWA) that shows each day's oil and water tank gauges in route order.
It reads **`data/gauges.json`**, which Kal updates from voice-mode calls. The app re-fetches the file
on open, whenever the app comes back to the foreground, and every 60 s. The last good copy is cached
(service worker + localStorage), so the app still opens and shows data with no signal.

## Files
- `index.html`, `style.css`, `app.js`: the app (no build step and no dependencies)
- `sw.js`: service worker (app shell cache-first, `data/gauges.json` network-first with offline fallback)
- `manifest.webmanifest`, `icons/`: home-screen install
- `fonts/`: Orbitron and Roboto Condensed (OFL), bundled for offline
- `data/gauges.json`: the shared data file (seeded from `../gauge-log.csv`)
- `tools/add_reading.py`: add, fix, or delete readings, show a day, set route order
- `tools/csv_to_json.py`: CSV (`date,location,tank,feet,inches[,lease]`) → gauges.json
- `tools/gaugelib.py`: shared helpers and the schema docstring
- `tests/e2e.py`: headless iPhone-size (390×844) test; `screenshots/`: output

## Schema (v1)
```json
{
 "schema": 1, "updated": "2026-10-18T19:19:00-06:00", "max_ft": 20, "default_lease": "bringelson",
 "leases": {"bringelson": {"name": "Bringelson", "route": ["1-20","14-20","16-20","17-20","9-20","11-20","6-20","7-20"]}},
 "days": {"2026-10-15": [{"lease": "bringelson", "locations": [
   {"loc": "1-20", "oil": {"ft": 5, "in": 11}, "water": {"ft": 7, "in": 3}} ]}]}
}
```
Locations are stored and shown in the lease's `route` order. A missing tank shows "—". A new location
gets appended to that lease's route automatically; reorder it with `--route`.

## Adding readings (Kal)
```bash
cd tools
python3 add_reading.py --loc 14-20 --tank oil --ft 8 --in 11                       # today (America/Denver), default lease
python3 add_reading.py --batch "14-20 oil 8 11; 14-20 water 6 1; 16-20 oil 13 6"   # several at once
python3 add_reading.py --date 2026-10-15 --loc 9-20 --tank oil --ft 1 --in 11       # fix a past day
python3 add_reading.py --delete --date 2026-10-15 --loc 9-20 --tank oil
python3 add_reading.py --show                                                       # print today
python3 add_reading.py --lease "Speed Goat" --loc 3-20 --tank water --ft 4 --in 2   # another lease
python3 add_reading.py --route bringelson "1-20,14-20,16-20,17-20,9-20,11-20,6-20,7-20"
python3 csv_to_json.py ../../gauge-log.csv            # merge a CSV (add --replace to rebuild)
```
Inches must be 0–11 and feet 0–20 (`--force` to override). Writes are atomic. Once hosted, commit and push `data/gauges.json` after each update.

## App use
- Opens to **today**. ◀ ▶ step one day, tap the date to pick any day, swipe left or right to change day, and **Today** jumps back. Empty days offer a jump to the nearest gauged day. A URL like `#2026-10-15` opens that day.
- **Tanks** = glowing dashboard (fills animate up to the level, plus change since the last gauge). **List** = copy-friendly table plus "Copy as text".
- **Share** makes a 1080-wide PNG of the day and opens the iOS Share sheet (or a preview to save).
- **＋** (or tapping any tank or number) = add/fix form. Entries stay on the phone, marked **LOCAL**, until the shared file has the same value (then they clear themselves). "Copy for Kal" copies them as text.

## Run / test locally
```bash
python3 -m http.server 8765 --bind 127.0.0.1    # from this folder, then open http://127.0.0.1:8765/
/workspace/.venv-pw/bin/python tests/e2e.py      # needs the server running; it stops the server to test offline
```

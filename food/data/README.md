# Fuel data — where it lives (since fd-v1.5)

**Everything personal is in the PRIVATE repo `DanielO3222/fuel-data`** (box clone: `/workspace/fuel-data`).
This public `food/data/log.json` is only an empty stub (`"moved": true`); don't write to it.

Private repo layout:
- `days/<YYYY-MM-DD>.json` — written by the app automatically (debounced, on every change) when Daniel's
  phone has a Sync key: `{schema, app, version, date, updatedAt, notes, manual:{weight,bmi,bodyFat,muscle,steps,
  activeCal,exerciseMin,distanceMi,standHrs}, heightIn, submittedAt, submittedVia, photos:[{id,takenAt,path}]}`.
  `manual` values are what Daniel typed (null = empty).
- `photos/<YYYY-MM-DD>/<photoId>.jpg` — written by the app (~1024 px JPEG). Deleted photos are removed.
- `log.json` — written by Pulse with `pulse_update.py` (schema below). The app reads it with the Sync key.

Pulse tools (stdlib):
```bash
python3 /workspace/tank-gauges/app/food/tools/fuel_day.py            # git pull + show today: notes, numbers, photo paths, review state
python3 /workspace/tank-gauges/app/food/tools/fuel_day.py 2026-11-14 # a given day
python3 /workspace/tank-gauges/app/food/tools/fuel_day.py --recent 7 # recent days with app data
python3 /workspace/tank-gauges/app/food/tools/pulse_update.py --date 2026-11-14 --json day.json   # write review -> private log.json, commit, push
```

# log.json schema (private repo) — Pulse's numbers for the Fuel app

Pulse (the health bot) writes this file; the app fetches it from the private repo with the Sync key (GitHub API, no-store)
on open, when it comes back to the foreground, every 2 min, and on Settings → Refresh. Photos, notes and
Daniel's manual entries stay on his phone (IndexedDB); they are **not** in this file.

Merge rule in the app: for weight / bmi / bodyFat / muscle / steps / activeCal / exerciseMin / distanceMi /
standHrs, what Daniel typed on the phone
wins; Pulse's value fills in when his field is empty. Calories and macros come only from this file.

## Schema (v1)
```json
{
 "schema": 1,
 "updated": "2026-11-14T19:40:00-07:00",
 "start": {"date": "2026-11-10", "lb": 231.4},
 "goal": {"lb": 165},
 "weights": [{"date": "2026-11-10", "lb": 231.4}, {"date": "2026-11-14", "lb": 229.8}],
 "days": {
  "2026-11-14": {
   "status": "reviewed",
   "entries": [
    {"photoId": "2026-11-14-121503-ab12", "food": "Chicken burrito bowl", "calories": 720,
     "protein": 48, "fat": 24, "carbs": 78, "note": "ate half the rice"},
    {"food": "2 dinner rolls", "calories": 240, "protein": 7, "fat": 4, "carbs": 44}
   ],
   "totals": {"calories": 960, "protein": 55, "fat": 28, "carbs": 122},
   "steps": 8535, "activeCal": 679, "exerciseMin": 18, "distanceMi": 3.39, "standHrs": 15,
   "weight": 229.8, "bmi": 33.1, "bodyFat": 31.2, "muscle": 33.5,
   "pulseNote": "Protein is low today; aim for a shake tonight.",
   "reviewedAt": "2026-11-14T19:40:00-07:00"
  }
 }
}
```
- Dates are `YYYY-MM-DD` in America/Denver.
- `status`: `reviewed` (green badge), `needs-info` (red "Pulse has a question"), `in-review` / `submitted`
  (amber "Submitted"). No status + nothing sent from the phone = "Not sent".
- `entries[].photoId` matches the photo `id` in the Submit payload (also the `.jpg` file name that
  `tools/save_submission.py` writes). The app shows that entry under that photo. Entries without a
  `photoId` (or with an unknown one) are listed as "Other items".
- `totals` is optional; the app sums `entries` when it's missing. `pulse_update.py` fills it in.
- All metric fields are optional; use `null` or leave them out when unknown.
- Activity fields come from his Apple Fitness **Summary** screenshot: Move ring cal → `activeCal`,
  Exercise ring min → `exerciseMin`, Stand ring hrs → `standHrs`, Steps → `steps`, Step Distance mi → `distanceMi`.
  The dashboard's slim Activity strip shows 7-day averages (tap: 30-day), averaging only days that have a value.
- `weights[]` feeds the weight trend chart (along with any `days[].weight` and phone entries).

## Tools (stdlib Python)
```bash
# 0) Usually not needed any more: photos/notes are already in /workspace/fuel-data after fuel_day.py pulls.
# 1) Save a Submit payload (webhook body / Shortcut post) so the photos can be viewed:
python3 /workspace/tank-gauges/app/food/tools/save_submission.py payload.json      # or: ... - < payload.json
#    -> /workspace/food-tracker/submissions/<date>/<photoId>.jpg + submission.json

# 2) Write the reviewed day and push it live:
python3 /workspace/tank-gauges/app/food/tools/pulse_update.py --date 2026-11-14 --json day.json
python3 /workspace/tank-gauges/app/food/tools/pulse_update.py --date 2026-11-14 --set steps=8535 activeCal=679 exerciseMin=18 distanceMi=3.39 standHrs=15
python3 /workspace/tank-gauges/app/food/tools/pulse_update.py --date 2026-11-14 --set weight=229.8 bodyFat=31.2
python3 /workspace/tank-gauges/app/food/tools/pulse_update.py --date 2026-11-14 --status needs-info --note "Milk or water in the shake?"
python3 /workspace/tank-gauges/app/food/tools/pulse_update.py --show 2026-11-14
```
`pulse_update.py` pulls /workspace/fuel-data, edits log.json, commits only that file, and pushes to `main`
(the app picks it up on its next refresh). `--no-push` / `--no-git` for dry runs.

## Submit payload (phone → Pulse's routine webhook)
```json
{"app":"food-tracker","version":"fd-v1.1","date":"2026-11-14","tz":"America/Denver",
 "sentAt":"2026-11-14T19:02:11-07:00","notes":"ate half the rice, 2 rolls",
 "manual":{"weight":229.8,"bmi":null,"bodyFat":31.2,"muscle":33.5,"steps":8535,"activeCal":679,
           "exerciseMin":18,"distanceMi":3.39,"standHrs":15},
 "heightIn":70,
 "photos":[{"id":"2026-11-14-121503-ab12","takenAt":"2026-11-14T12:15:03-07:00","mime":"image/jpeg","base64":"/9j/..."}]}
```
Photos are ~640 px JPEGs; the app shrinks them further if the day would exceed ~1.3 MB of base64.

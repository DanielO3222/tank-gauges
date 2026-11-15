# Fuel — food & weight tracker (v1)

Live: https://danielo3222.github.io/tank-gauges/food/ — iPhone-first PWA (Add to Home Screen).
No build step, no dependencies. Service worker version string lives in `sw.js` and `app.js` (`fd-v1.x`); bump both on every update.

- `index.html`, `style.css`, `app.js` — the app. Photos (1024 px + 640 px JPEG), notes, manual entries in IndexedDB `fuel-db`; settings in localStorage `fd-settings`.
- Private data (photos, notes, numbers, Pulse's `log.json`) lives in the private repo `DanielO3222/fuel-data`; the app syncs to it with a fine-grained token (Settings → Sync key). `data/log.json` here is an empty stub. See `data/README.md`.
- `tools/fuel_day.py`, `tools/pulse_update.py`, `tools/save_submission.py` — Pulse's helpers (default to /workspace/fuel-data).
- `tests/e2e.py` — headless 390×844 test (screenshots go to /workspace/food-tracker/screenshots, not committed).

## Submit → Pulse
The day view has one **Send to Pulse** button. It uses the mode chosen in Settings → *Send to Pulse uses*
(default: share sheet). Webhook URL + Sender key (from Pulse's routine panel), header `Authorization`,
prefix `Bearer ` (both editable) are only used by the webhook mode. Modes:
1. **Webhook directly** — `fetch` POST with JSON. Cursor's webhook host (api2.cursor.sh) did not allow
   cross-origin calls from github.io when tested on 2026-11-14 (preflight returns no
   `Access-Control-Allow-Origin`), and it rejects keys sent any way other than the `Authorization` header, so a
   `no-cors` fallback can't authenticate. If the browser blocks it, the app says nothing was sent and offers
   Share or the Shortcut.
2. **iOS Shortcut** — copies the day's JSON to the clipboard and runs the Shortcut named in Settings
   (default "Send to Pulse"). One-time Shortcut: *Get Clipboard* → *Get Contents of URL* (URL = webhook URL,
   Method POST, Headers `Authorization: Bearer <key>` and `Content-Type: application/json`,
   Request Body: File = Clipboard) → optional *Show Notification*.
3. **Share sheet** — `navigator.share` with the photos + notes text, to drop into Pulse's chat by hand.

# Fuel — food & weight tracker (v1)

Live: https://danielo3222.github.io/tank-gauges/food/ — iPhone-first PWA (Add to Home Screen).
No build step, no dependencies. Service worker version string lives in `sw.js` and `app.js` (`fd-v1.x`); bump both on every update.

- `index.html`, `style.css`, `app.js` — the app. Photos (1024 px + 640 px JPEG), notes, manual entries in IndexedDB `fuel-db`; settings in localStorage `fd-settings`.
- `data/log.json` — Pulse's reviewed numbers (schema + tool usage in `data/README.md`).
- `tools/save_submission.py`, `tools/pulse_update.py` — Pulse's helpers.
- `tests/e2e.py` — headless 390×844 test (screenshots go to /workspace/food-tracker/screenshots, not committed).

## Submit → Pulse
Settings → *Send to Pulse*: Webhook URL + Sender key (from Pulse's routine panel), header `Authorization`,
prefix `Bearer ` (both editable). Modes:
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

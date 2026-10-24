/* Bubble Level service worker (scope /level/): shell cache-first (works offline). */
const VERSION = "lv-v1.0";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest",
  "../fonts/Orbitron.ttf", "../fonts/RobotoCondensed.ttf", "../icons/icon-192.png", "../icons/apple-touch-icon.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("lv-") && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(req, {ignoreSearch: req.mode === "navigate"}).then(hit => hit ||
    fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; })
      .catch(() => req.mode === "navigate" ? caches.match("index.html") : Response.error())));
});

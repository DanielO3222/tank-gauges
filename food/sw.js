/* Fuel (food & weight) service worker, scope /food/. App shell cache-first; data/log.json network-first. */
const VERSION = "fd-v1.5";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("fd-") && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith("/data/log.json")) {
    e.respondWith(fetch(req, {cache: "no-store"}).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(url.origin + url.pathname, cp)); }
      return r;
    }).catch(() => caches.match(url.origin + url.pathname, {ignoreSearch: true}).then(h => h || Response.error())));
    return;
  }
  e.respondWith(caches.match(req, {ignoreSearch: req.mode === "navigate"}).then(hit => hit ||
    fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; })
      .catch(() => req.mode === "navigate" ? caches.match("index.html") : Response.error())));
});

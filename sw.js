const CACHE_NAME = "akshay-tv-india-v5";
const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/akshay-tv-icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.endsWith(".m3u") || url.pathname.endsWith(".m3u8")) return;

  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok && event.request.method === "GET") {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request,copy));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});

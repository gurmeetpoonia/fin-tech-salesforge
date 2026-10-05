// SalesForge service worker for safe offline asset caching.
// HTML/navigation requests are always network-first so a normal refresh cannot
// keep serving an old application shell or stale JavaScript bundle references.
const CACHE = "salesforge-v3";
const ASSETS = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS).catch(() => null)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  const isNavigation = event.request.mode === "navigate";
  const isHtml = url.pathname === "/" || url.pathname.endsWith(".html");
  const isDevelopmentModule = url.pathname.startsWith("/src/");

  // Never cache the app shell or Vite source modules. These are the requests
  // that determine which frontend bundle/state is loaded after a refresh.
  if (isNavigation || isHtml || isDevelopmentModule) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/")),
    );
    return;
  }

  // Hashed production assets and static resources may use cache-first behavior.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE).then((cache) =>
              cache.put(event.request, clone),
            ).catch(() => null);
          }
          return res;
        })
        .catch(() => caches.match("/"));
    }),
  );
});

const appCache = "gramdrive-app-v1";
const appShell = ["/", "/site.webmanifest", "/brand-icon.svg", "/favicon.svg", "/apple-touch-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(appCache)
      .then((cache) => cache.addAll(appShell))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== appCache).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(appCache).then((cache) => cache.put("/", copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        const shouldCache =
          response.ok &&
          (url.pathname.startsWith("/assets/") || appShell.includes(url.pathname));

        if (shouldCache) {
          const copy = response.clone();
          caches.open(appCache).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }

        return response;
      });
    })
  );
});

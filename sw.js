const CACHE = "mealplanner-v1.0.18";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=1.0.18",
  "./app.js?v=1.0.18",
  "./firebase-sync.js?v=1.0.18",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("mealplanner-") && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function fetchWithTimeout(request, timeoutMs = 2200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetchWithTimeout(event.request);
        if (response && response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then(cache => cache.put("./index.html", copy)));
        }
        return response;
      } catch (_) {
        return (await caches.match("./index.html")) || (await caches.match("./"));
      }
    })());
    return;
  }

  // Exact matching is intentional. Versioned asset URLs must never resolve to
  // a previous build's cached app.js/style.css, which can create dead controls.
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request, { cache: "no-store" });
      if (response && response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
      }
      return response;
    } catch (_) {
      return Response.error();
    }
  })());
});

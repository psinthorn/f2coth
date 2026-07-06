// F2 PWA service worker.
//
// Scope: root. Served from /sw.js (Next.js exposes /public at the root).
// Design tenets — read this before adding caching logic:
//
//   1) Auth-sensitive paths (/api/*, /admin/*, /portal/*) NEVER get
//      cached. Staff toggle features, invoice paid/unpaid state, and
//      customer PDPA consent must never surface stale to the operator.
//      Any auth path passes straight through to the network.
//
//   2) Marketing pages + static assets ARE cache-first (with revalidate).
//      Homepage, case-studies, blog, services, etc. can safely serve a
//      cached copy while the network refresh backfills. Speeds up
//      repeat visits + preserves marketing UX on flaky connections.
//
//   3) Precache the offline fallback only. Loading a full precache list
//      pins us to Next's hashed asset names, which change every build.
//      Instead we rely on runtime caching to warm the cache lazily.
//
// Registration is done by src/components/ServiceWorkerRegistrar.tsx.

const CACHE_VERSION = "f2-v1";
const RUNTIME_CACHE = `f2-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

// --- lifecycle ---

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      // Cache the offline fallback page immediately so it's available
      // even when the very first offline event happens.
      try {
        await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      } catch {
        // /offline may 404 in dev before build — non-fatal.
      }
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop old-version caches. Only current CACHE_VERSION survives.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.endsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// --- fetch strategies ---

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never cache mutations
  const url = new URL(request.url);

  // Skip cross-origin — let the browser handle it (CDN, images.unsplash.com, etc)
  if (url.origin !== self.location.origin) return;

  // Auth-sensitive: network-only (do NOT cache).
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/portal") ||
    url.pathname.startsWith("/payments")
  ) {
    return; // fall through to the network without our intervention
  }

  // Next-generated hashed static assets are content-addressed → cache-first.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.jpg" ||
    url.pathname === "/apple-icon.jpg" ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/sw.js"
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else (marketing pages, blog, case studies): stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((fresh) => {
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(async () => {
      // Offline: fall back to the cached copy OR the offline page for
      // navigation requests. For subresources just error.
      if (cached) return cached;
      if (request.mode === "navigate") {
        const offline = await cache.match(OFFLINE_URL);
        if (offline) return offline;
      }
      return Response.error();
    });
  // stale-while-revalidate: return cached immediately when available,
  // let the network response silently backfill the cache in the background.
  return cached || network;
}

// --- messaging ---

self.addEventListener("message", (event) => {
  // Allow the page to trigger an immediate update on release.
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

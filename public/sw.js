const APP_SHELL_CACHE = "nahuitech-app-shell-v4";
const SELLER_DOCUMENT_CACHE = "nahuitech-seller-documents-v4";
const STATIC_CACHE = "nahuitech-static-v4";
const CACHE_PREFIX = "nahuitech-";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/brand/NAHUITECH%20LOGO.png",
  "/brand/nahuitech-pwa-icon.svg",
  "/machines/hyro-set-ome.png",
  "/machines/hyro-set-pro-8.png",
  "/machines/hyro-set-pro-6.png",
  "/machines/hyro-set-compact-4.png",
  "/machines/hyro-set-intro.png",
  "/machines/hyro-set-basic-4.png",
  "/machines/hyro-set-tri-basic.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(CACHE_PREFIX) &&
                ![APP_SHELL_CACHE, SELLER_DOCUMENT_CACHE, STATIC_CACHE].includes(key)
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function sellerNavigation(request) {
  const cache = await caches.open(SELLER_DOCUMENT_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    const cachedSellerShell = await cache.match("/seller");
    if (cachedSellerShell) return cachedSellerShell;

    return new Response("Sin conexión", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.headers.has("RSC") ||
    request.headers.has("Next-Router-State-Tree")
  ) {
    return;
  }

  // La pantalla de acceso nunca se sirve desde Cache Storage: su estado debe
  // resolverse con las cookies de Supabase y el servidor.
  if (url.pathname === "/login") {
    return;
  }

  if (
    request.mode === "navigate" &&
    (
      url.pathname === "/seller" ||
      url.pathname === "/seller/offline" ||
      url.pathname.startsWith("/seller/quote/")
    )
  ) {
    event.respondWith(sellerNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/machines/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirst(request));
  }
});

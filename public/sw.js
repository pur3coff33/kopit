// kopit service worker: keeps the add screen usable with no signal.
const CACHE = "kopit-v1";
const PRECACHE = [
  "/app.css",
  "/js/history.js",
  "/js/edit.js",
  "/js/keypad.js",
  "/js/add.js",
  "/js/queue.js",
  "/js/save.js",
  "/js/install.js",
  "/js/notes.js",
  "/js/router.js",
  "/js/update.js",
  "/js/leaf.js",
  "/js/tour.js",
  "/js/tour-page.js",
  "/js/wrapped.js",
  "/js/sky.js",
  "/fonts/nunito-latin-wght-normal.woff2",
  "/fonts/nunito-latin-ext-wght-normal.woff2",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
  "/manifest.webmanifest",
];

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>kop.it</title>
<link rel="stylesheet" href="/app.css"></head><body><div class="app"><header class="top"><a class="logo" href="/">
<span class="wm" role="img" aria-label="kop.it">kop<i aria-hidden="true"></i>it</span></a></header>
<main style="align-items:center;text-align:center;justify-content:center">
<svg viewBox="0 0 120 150" width="96" aria-hidden="true"><path d="M40 148 L80 148 L75 128 L45 128 Z" fill="#C98B5E"/>
<rect x="42" y="122" width="36" height="8" rx="4" fill="#B07548"/><path d="M60 124 C60 112 59 108 61 100" stroke="#3E7A4A" stroke-width="3" fill="none"/>
<ellipse cx="52" cy="106" rx="8" ry="4" fill="#8FC19B" transform="rotate(-30 52 106)"/><ellipse cx="68" cy="102" rx="8" ry="4" fill="#7FB08C" transform="rotate(30 68 102)"/></svg>
<h1>No signal</h1><p class="muted">kop.it needs internet for this page.</p>
<a class="save" href="/" style="margin-top:18px">Back to add</a></main></div></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// iOS Safari refuses redirected responses for navigations, so hand back a fresh copy.
function clean(res) {
  return res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
}

function offline() {
  return new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// How long the add screen waits for the network before using the cached copy (weak signal).
const NAV_TIMEOUT_MS = 3000;

async function addScreen(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match("/");
  const network = fetch(event.request).then(async (res) => {
    if (res.ok && !res.redirected) await cache.put("/", res.clone());
    // Sent to /login or /profile: the saved add screen no longer belongs to this phone.
    else if (res.redirected) await cache.delete("/");
    return res;
  });
  if (!cached) return network.then(clean).catch(offline);
  // Open instantly from the saved copy and refresh it in the background — unless a fresh copy
  // was asked for (?fresh, right after picking a profile), where a stale page would be wrong.
  if (!new URL(event.request.url).searchParams.has("fresh")) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  event.waitUntil(network.catch(() => {})); // keep refreshing the cache in the background
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    return res ? clean(res) : cached;
  } catch {
    return cached;
  }
}

// Serve static files from cache straight away and refresh them in the background.
async function staticFile(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  const fresh = fetch(event.request)
    .then((res) => {
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  return (await fresh) ?? new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(url.pathname === "/" ? addScreen(event) : fetch(request).then(clean).catch(offline));
    return;
  }
  if (PRECACHE.includes(url.pathname)) event.respondWith(staticFile(event));
});

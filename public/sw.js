// kopit service worker: keeps the add screen usable with no signal.
const CACHE = "kopit-v1";
const PRECACHE = [
  "/app.css",
  "/js/keypad.js",
  "/js/add.js",
  "/js/queue.js",
  "/fonts/nunito-latin-wght-normal.woff2",
  "/fonts/nunito-latin-ext-wght-normal.woff2",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
  "/manifest.webmanifest",
];

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>kopit</title>
<link rel="stylesheet" href="/app.css"></head><body><div class="app"><header class="top"><a class="logo" href="/">kopit</a></header>
<main><h1>No signal</h1><p>kopit needs internet for this page.</p>
<a class="save" href="/" style="text-align:center;text-decoration:none;margin-top:18px">Back to add</a></main></div></body></html>`;

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

async function addScreen(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected) await cache.put("/", res.clone());
    return clean(res);
  } catch {
    return (await cache.match("/")) ?? offline();
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
    event.respondWith(url.pathname === "/" ? addScreen(request) : fetch(request).then(clean).catch(offline));
    return;
  }
  if (PRECACHE.includes(url.pathname)) event.respondWith(staticFile(event));
});

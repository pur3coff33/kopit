// Switches screens without reloading: fetches the next page, shows a placeholder if it's slow, then swaps
// the header, content and bottom bar in place. Anything unusual (offline, a redirect to log in, an error)
// falls back to a normal page load, so the server-rendered pages keep working on their own.

import { askToUpdate, needsUpdate, versionOf } from "./update.js";

/** The same-site path a click should open in place, or null to leave it to the browser. */
export function navTarget({ href, target, download, button, modified }, here) {
  if (button !== 0 || modified || download || (target && target !== "_self")) return null;
  let url;
  try {
    url = new URL(href, here);
  } catch {
    return null;
  }
  const now = new URL(here);
  if (url.origin !== now.origin || url.pathname.startsWith("/api/")) return null;
  if (url.hash && url.pathname === now.pathname && url.search === now.search) return null;
  return url.pathname + url.search + url.hash;
}

/** `href` is the screen already showing (`shown`, a path), maybe at another section: anchors don't make a new screen. */
export function sameScreen(href, shown) {
  const a = new URL(href, "https://x.invalid");
  const b = new URL(shown, "https://x.invalid");
  return a.pathname === b.pathname && a.search === b.search;
}

const PAGE_TIMEOUT_MS = 3000; // same patience the service worker gives the add screen on weak signal

/**
 * The next screen's HTML, or null when a normal page load should handle it (redirect, error, not a page).
 * Rejects when offline or when nothing arrives within `timeoutMs`: then a normal page load lets the
 * service worker answer (the add screen opens from its offline copy instead of waiting on a dead connection).
 * @param {string} url
 * @param {{ fetchImpl?: (url: string, init: { credentials: "same-origin"; signal: AbortSignal }) => Promise<any>; timeoutMs?: number }} [opts]
 */
export async function fetchPage(url, { fetchImpl = fetch, timeoutMs = PAGE_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { credentials: "same-origin", signal: ctrl.signal });
    const isHtml = res.headers.get("Content-Type")?.includes("text/html");
    return res.ok && !res.redirected && isHtml ? await res.text() : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Which placeholder fits the screen being opened. */
export function skeletonKind(pathname) {
  if (pathname === "/") return "add";
  if (pathname === "/spending") return "spending";
  if (pathname === "/history") return "history";
  return "list";
}

// ---------- placeholders, shaped like the screen that's on its way ----------

const bone = (cls = "") => `<span class="sk ${cls}"></span>`;
const rows = (n) =>
  `<div class="sk-rows">${`<div class="sk-row">${bone("sk-ic")}<span class="sk-mid">${bone("sk-line")}${bone("sk-bar")}</span></div>`.repeat(n)}</div>`;
const chips = (n) => `<div class="sk-chips">${bone("sk-chip").repeat(n)}</div>`;

const SKELETONS = {
  add: `${bone("sk-amount")}<div class="cats">${bone("sk-tile").repeat(8)}</div>${bone("sk-chip")}<div class="keys">${bone("sk-key").repeat(12)}</div>${bone("sk-save")}`,
  spending: `${chips(3)}${chips(3)}${bone("sk-total")}${bone("sk-line sk-short")}${bone("sk-nudge")}${rows(6)}`,
  history: `${chips(3)}${bone("sk-line sk-day")}${rows(4)}${bone("sk-line sk-day")}${rows(3)}`,
  list: `${bone("sk-line sk-short")}${bone("sk-title")}${rows(5)}`,
};

// ---------- the router itself ----------

if (typeof document !== "undefined" && typeof history.pushState === "function") {
  // Page scripts check this flag: with the router around, it starts them instead of them starting themselves.
  globalThis.kopitRouter = true;

  const SLOW_MS = 120; // show the placeholder only if the next screen isn't back by then
  const EARLY_MS = 10_000; // a page fetched on finger-down is reused by the click for this long
  const PREFETCH_DELAY_MS = 80; // a finger that's still down and still after this long is a tap, not a scroll
  const early = new Map();
  let stop = null;
  let seq = 0;
  let loading = false;

  // Where each history entry was scrolled to, so Back and Forward land where you left. Keyed per entry; recorded
  // only while no screen is loading (a placeholder shrinks the page and would record the wrong spot).
  history.scrollRestoration = "manual";
  const positions = new Map();
  const newKey = () => Math.random().toString(36).slice(2);
  let key = history.state?.key ?? newKey();
  history.replaceState({ ...history.state, key }, "");
  let shown = location.pathname + location.search; // the screen on show, whatever section it's at

  /** The section a URL's anchor points at on the current screen, if there is one. */
  function section(url) {
    const hash = new URL(url, location.href).hash;
    return hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
  }

  function load(url) {
    const hit = early.get(url);
    early.delete(url);
    if (hit && Date.now() - hit.at < EARLY_MS) return hit.page;
    return fetchPage(url);
  }

  /** Loads the page scripts (data-page) of `doc`, before its screen goes in, so no early tap is missed. */
  function importScripts(doc) {
    const srcs = [...doc.querySelectorAll("script[data-page]")].map((s) => new URL(s.getAttribute("src"), location.href).href);
    return Promise.all(srcs.map((src) => import(src).catch((err) => (console.error(err), null))));
  }

  /** Starts loaded page scripts; keeps their stop functions for when we leave. */
  function start(mods) {
    const stops = [];
    for (const mod of mods) {
      try {
        const off = typeof mod?.mount === "function" ? mod.mount() : null;
        if (typeof off === "function") stops.push(off);
      } catch (err) {
        console.error(err);
      }
    }
    stop = () => stops.forEach((off) => off());
  }

  function leave() {
    stop?.();
    stop = null;
  }

  function markTab(url) {
    const path = new URL(url, location.href).pathname;
    const nav = document.querySelector(".app > .nav");
    if (!nav || ![...nav.querySelectorAll("a")].some((a) => a.pathname === path)) return;
    for (const a of nav.querySelectorAll("a")) a.classList.toggle("on", a.pathname === path);
  }

  function showSkeleton(url) {
    const main = document.querySelector(".app > main");
    if (!main) return;
    leave();
    const kind = skeletonKind(new URL(url, location.href).pathname);
    main.innerHTML = `<div class="skeleton" data-kind="${kind}" aria-hidden="true">${SKELETONS[kind]}</div>`;
    main.setAttribute("aria-busy", "true");
    markTab(url);
  }

  /** Puts `doc`'s version of a top-level part of the app (header, main, nav) in place of ours. */
  function put(sel, doc, before) {
    const app = document.querySelector(".app");
    const mine = app.querySelector(`:scope > ${sel}`);
    const next = doc.querySelector(`.app > ${sel}`);
    if (next) {
      const node = document.adoptNode(next);
      if (mine) mine.replaceWith(node);
      else app.insertBefore(node, before ? app.querySelector(`:scope > ${before}`) : null);
    } else mine?.remove();
  }

  /** Scripts parsed from a fetched page don't run; recreate the inline ones (e.g. clearing the cache after logout). */
  function runInlineScripts(root) {
    for (const old of root.querySelectorAll("script:not([src])")) {
      const s = document.createElement("script");
      s.textContent = old.textContent;
      old.replaceWith(s);
    }
  }

  async function go(url, push) {
    const mine = ++seq;
    loading = true;
    const slow = setTimeout(() => mine === seq && showSkeleton(url), SLOW_MS);
    let html = null;
    try {
      html = await load(url);
    } catch {} // offline or no answer in time: the normal page load below lets the service worker answer
    clearTimeout(slow);
    if (mine !== seq) return;
    const doc = html && new DOMParser().parseFromString(html, "text/html");
    if (!doc?.querySelector(".app > main")) {
      if (push) location.assign(url);
      else location.reload();
      return;
    }
    // A screen from a newer deploy won't work with this page's scripts: ask for a reload instead of swapping it in.
    if (needsUpdate(versionOf(document), versionOf(doc))) {
      loading = false;
      askToUpdate();
      return;
    }
    const mods = await importScripts(doc);
    if (mine !== seq) return;
    // A page script without mount() (an old copy from the cache during an update) can't be restarted in place.
    if (mods.some((m) => typeof m?.mount !== "function")) {
      if (push) location.assign(url);
      else location.reload();
      return;
    }
    if (push) {
      const same = url === location.pathname + location.search + location.hash;
      if (!same) key = newKey();
      history[same ? "replaceState" : "pushState"]({ key }, "", url);
    }
    const swap = () => {
      leave();
      put(".top", doc, "main");
      put("main", doc, ".nav");
      put(".nav", doc);
      document.title = doc.title;
      runInlineScripts(document.querySelector(".app > main"));
      shown = location.pathname + location.search;
      // Back and Forward land where you left; a new screen opens at its anchor's section, or at the top.
      const saved = push ? undefined : positions.get(key);
      const target = saved === undefined ? section(url) : null;
      if (target) target.scrollIntoView();
      else scrollTo(0, saved ?? 0);
      loading = false;
      start(mods);
    };
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.startViewTransition && !calm) {
      // The browser may skip the cross-fade (e.g. during back/forward); the swap still happens.
      const t = document.startViewTransition(swap);
      t.ready.catch(() => {});
      t.finished.catch(() => {});
    } else swap();
  }

  function linkTarget(ev) {
    const a = ev.target.closest?.("a[href]");
    if (!a || a.hasAttribute("data-reload")) return null;
    return navTarget(
      {
        href: a.href,
        target: a.target,
        download: a.hasAttribute("download"),
        button: ev.button,
        modified: ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey,
      },
      location.href,
    );
  }

  function prefetch(url) {
    const now = Date.now();
    for (const [u, hit] of early) if (now - hit.at >= EARLY_MS) early.delete(u);
    if (early.has(url)) return;
    const page = fetchPage(url);
    page.catch(() => {});
    early.set(url, { at: now, page });
  }

  // Start fetching once a finger has rested on a link for a moment, so the screen is often ready by the time it
  // lifts. A finger that moves, or a page that scrolls, is a scroll gesture: nothing is fetched.
  let pending = null;
  const cancelPending = () => {
    clearTimeout(pending?.timer);
    pending = null;
  };
  document.addEventListener(
    "pointerdown",
    (ev) => {
      cancelPending();
      const url = linkTarget(ev);
      if (!url) return;
      const timer = setTimeout(() => {
        pending = null;
        prefetch(url);
      }, PREFETCH_DELAY_MS);
      pending = { x: ev.clientX, y: ev.clientY, timer };
    },
    { passive: true },
  );
  document.addEventListener("pointercancel", cancelPending);
  document.addEventListener(
    "pointermove",
    (ev) => pending && Math.hypot(ev.clientX - pending.x, ev.clientY - pending.y) > 10 && cancelPending(),
    { passive: true },
  );
  addEventListener(
    "scroll",
    () => {
      cancelPending();
      if (!loading) positions.set(key, scrollY);
    },
    { passive: true },
  );

  document.addEventListener("click", (ev) => {
    if (ev.defaultPrevented) return;
    const url = linkTarget(ev);
    if (!url) return;
    ev.preventDefault();
    go(url, true);
  });

  addEventListener("popstate", () => {
    key = history.state?.key ?? newKey();
    if (!history.state?.key) history.replaceState({ ...history.state, key }, ""); // an anchor's entry, made by the browser
    // A jump between sections of the screen on show (an in-page anchor, or Back over one) isn't a new screen: just
    // scroll, instead of loading the page again from the top.
    if (sameScreen(location.href, shown)) {
      const target = section(location.href);
      if (target) target.scrollIntoView();
      else scrollTo(0, positions.get(key) ?? 0);
      return;
    }
    go(location.pathname + location.search + location.hash, false);
  });

  // First load: the page came from the server as usual; start its scripts.
  importScripts(document).then(start);
}

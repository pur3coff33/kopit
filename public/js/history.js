// The greenhouse (History): each week's shelf builds itself as it comes into view, a tap on a pot opens that day's
// receipt under its shelf, a week's watering can pours before its recap opens, and the next weeks load when
// "Show more" scrolls into view (the link still works without JS). Each batch holds whole weeks, so it can simply be
// added to the end.

const SETTLE_MS = 700; // the drawer's fold (app.css), before a closed receipt is hidden
const BUILD_MS = 900; // a shelf's build-in is given this long to itself before the next one may start
const STILL_MS = 150; // the page counts as still this long after the last scroll

/** Which pot and receipt a tap shows: `open` the pot's place on its shelf (0–6) or null; tapping the open one closes it. */
export function nextOpen(open, tapped) {
  return open === tapped ? null : tapped;
}

/** Starts the history screen; returns a function that stops it. Each visit keeps its own state, so a batch
 * still loading when you leave can't land in a later visit's list. */
export function mount() {
  const house = document.querySelector(".greenhouse");
  const list = document.querySelector("#history");
  let more = document.querySelector("#more-history");
  let stopped = false;
  if (!house || !list) return;
  const observing = "IntersectionObserver" in window;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || !observing;

  // Build each shelf and sign in as it comes into view. One shelf builds at a time: one that comes into view while
  // another is still going (a quick scroll) is just there.
  let lastBuild = -Infinity;
  const reveal = still ? null : new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    if (e.target.matches(".g-shelf")) {
      const now = performance.now();
      if (now - lastBuild < BUILD_MS) e.target.classList.add("quick");
      else lastBuild = now;
    }
    e.target.classList.add("in");
    reveal.unobserve(e.target);
  }), { threshold: 0.25 });
  // Only what's on screen moves (app.css): the shelves, signs and roof in view are .live.
  const live = observing
    ? new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle("live", e.isIntersecting)), { rootMargin: "80px 0px" })
    : null;
  const roof = house.querySelector(".g-roof");
  if (roof) live?.observe(roof);
  // Shelves far from the screen stop being drawn (app.css) and keep their height: with years of history there are
  // hundreds of them, each with seven swaying pots, and only a few are ever in view.
  const park =
    observing && CSS.supports("content-visibility", "hidden")
      ? new IntersectionObserver(
          (es) =>
            es.forEach((e) => {
              if (e.isIntersecting) return e.target.classList.remove("far");
              e.target.style.containIntrinsicSize = `auto ${Math.round(e.boundingClientRect.height)}px`;
              e.target.classList.add("far");
            }),
          { rootMargin: "1500px 0px" },
        )
      : null;
  const watch = (els) =>
    els.forEach((el) => {
      if (!el.matches(".g-shelf, .g-chapter")) return;
      reveal?.observe(el);
      live?.observe(el);
      park?.observe(el);
    });
  if (reveal) house.classList.add("animate");
  watch([...list.children]);

  // While the page is being scrolled, the endless motion holds still (app.css, .moving).
  let scrollTimer = 0;
  const onScroll = () => {
    house.classList.add("moving");
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => house.classList.remove("moving"), STILL_MS);
  };
  addEventListener("scroll", onScroll, { passive: true });

  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => (timers.delete(t), fn()), ms);
    timers.add(t);
  };

  function show(shelf, k, tapped) {
    const pots = shelf.querySelector(".g-pots");
    const drawer = shelf.querySelector(".g-drawer");
    for (const p of pots.querySelectorAll(".g-pot")) {
      const on = Number(p.dataset.k) === k;
      p.classList.toggle("sel", on);
      if (!p.disabled) p.setAttribute("aria-pressed", on ? "true" : "false");
    }
    pots.classList.toggle("focus", tapped && k !== null);
    if (k === null) {
      drawer.classList.remove("open");
      later(() => !drawer.classList.contains("open") && drawer.querySelectorAll(".g-receipt").forEach((r) => (r.hidden = true)), SETTLE_MS);
      return;
    }
    drawer.querySelectorAll(".g-receipt").forEach((r) => (r.hidden = Number(r.dataset.k) !== k));
    drawer.classList.add("open");
    const receipt = drawer.querySelector(`.g-receipt[data-k="${k}"]`);
    // On a wide screen the receipt stands beside its shelf, so there is nothing to scroll to.
    if (matchMedia("(min-width: 1100px) and (min-height: 600px)").matches) return;
    later(() => {
      const box = receipt?.getBoundingClientRect();
      if (!box || box.bottom <= innerHeight - 90) return;
      // Bring the receipt's end into view, but never past its top: a long day stays read from the start.
      const top = Math.min(box.bottom - innerHeight + 110, box.top - 90);
      if (top > 0) scrollBy({ top, behavior: still ? "auto" : "smooth" });
    }, 350);
  }

  function onClick(ev) {
    const pot = ev.target.closest(".g-pot");
    if (pot && !pot.disabled) {
      const shelf = pot.closest(".g-shelf");
      const sel = shelf.querySelector(".g-pot.sel");
      const k = nextOpen(sel ? Number(sel.dataset.k) : null, Number(pot.dataset.k));
      // One day open at a time: opening this one closes any other shelf's.
      for (const other of list.querySelectorAll(".g-shelf")) if (other !== shelf && other.querySelector(".g-pot.sel")) show(other, null, false);
      show(shelf, k, true);
      return;
    }
    const can = ev.target.closest(".g-can");
    if (!can || still) return;
    if (can.dataset.go) {
      delete can.dataset.go; // poured: let the router open the recap
      return;
    }
    ev.preventDefault();
    can.classList.add("pour");
    later(() => {
      can.classList.remove("pour");
      can.dataset.go = "1";
      can.click();
    }, SETTLE_MS);
  }
  list.addEventListener("click", onClick);

  async function loadMore() {
    if (!more || more.dataset.loading) return;
    more.dataset.loading = "1";
    more.textContent = "Loading…";
    try {
      // Just the shelves and the next link, not the page around them.
      const url = new URL(more.href);
      url.searchParams.set("part", "shelves");
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      if (stopped) return;
      const incoming = doc.querySelector("#history");
      if (incoming) {
        const added = [...incoming.children];
        list.append(...added);
        watch(added);
      }
      const next = doc.querySelector("#more-history");
      if (next) {
        more.href = next.href;
        more.textContent = "Show more";
        delete more.dataset.loading;
        // An observer only speaks when the link crosses the edge. If it's still in range after this batch (a fast
        // scroll can leave it there, or a slow phone has scrolled on while it loaded), no one would ask for the next
        // weeks: observing again reports where it stands now.
        if (seen) {
          seen.unobserve(more);
          seen.observe(more);
        }
      } else {
        seen?.disconnect();
        more.remove();
        more = null;
      }
    } catch {
      if (stopped || !more) return;
      more.textContent = "Show more";
      delete more.dataset.loading;
    }
  }

  const seen = more && observing ? new IntersectionObserver((s) => s.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "300px" }) : null;
  if (seen) seen.observe(more);
  return () => {
    stopped = true;
    seen?.disconnect();
    reveal?.disconnect();
    park?.disconnect();
    live?.disconnect();
    removeEventListener("scroll", onScroll);
    clearTimeout(scrollTimer);
    list.removeEventListener("click", onClick);
    timers.forEach(clearTimeout);
  };
}

// An older page without the router (still in the phone's cache) starts itself.
if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();

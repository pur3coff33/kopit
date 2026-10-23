// The greenhouse (History): each week's shelf builds itself as it comes into view, a tap on a pot opens that day's
// receipt under its shelf, a week's watering can pours before its recap opens, and the next weeks load when
// "Show more" scrolls into view (the link still works without JS). Each batch holds whole weeks, so it can simply be
// added to the end.

const SETTLE_MS = 700; // the drawer's fold (app.css), before a closed receipt is hidden

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
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window);

  // Build each shelf and sign in as it comes into view.
  const reveal = still ? null : new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    reveal.unobserve(e.target);
  }), { threshold: 0.25 });
  const watch = (els) => reveal && els.forEach((el) => el.matches(".g-shelf, .g-chapter") && reveal.observe(el));
  if (reveal) {
    house.classList.add("animate");
    watch([...list.children]);
  }

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
    later(() => {
      const box = receipt?.getBoundingClientRect();
      if (box && box.bottom > innerHeight - 90) scrollBy({ top: box.bottom - innerHeight + 110, behavior: still ? "auto" : "smooth" });
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

  // The glass's drops drift a little slower than the shelves.
  const far = house.querySelector(".g-far");
  let frame = 0;
  const onScroll = () => {
    if (frame || still || !far) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      far.style.transform = `translateY(${(scrollY * 0.15).toFixed(1)}px)`;
    });
  };
  addEventListener("scroll", onScroll, { passive: true });

  async function loadMore() {
    if (!more || more.dataset.loading) return;
    more.dataset.loading = "1";
    more.textContent = "Loading…";
    try {
      const res = await fetch(more.href);
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

  const seen = more && "IntersectionObserver" in window ? new IntersectionObserver((s) => s.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "300px" }) : null;
  if (seen) seen.observe(more);
  return () => {
    stopped = true;
    seen?.disconnect();
    reveal?.disconnect();
    list.removeEventListener("click", onClick);
    removeEventListener("scroll", onScroll);
    if (frame) cancelAnimationFrame(frame);
    timers.forEach(clearTimeout);
  };
}

// An older page without the router (still in the phone's cache) starts itself.
if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();

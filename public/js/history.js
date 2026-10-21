// Loads the next 5 days automatically when "Show more" scrolls into view (the link still works without JS).
// Each batch holds whole days, so it can simply be added to the end.

/** Starts the history screen; returns a function that stops it. Each visit keeps its own state, so a batch
 * still loading when you leave can't land in a later visit's list. */
export function mount() {
  const list = document.querySelector("#history");
  let more = document.querySelector("#more-history");
  let stopped = false;
  if (!list || !more || !("IntersectionObserver" in window)) return;

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
      if (incoming) list.append(...incoming.children);
      const next = doc.querySelector("#more-history");
      if (next) {
        more.href = next.href;
        more.textContent = "Show more";
        delete more.dataset.loading;
      } else {
        seen.disconnect();
        more.remove();
        more = null;
      }
    } catch {
      if (stopped || !more) return;
      more.textContent = "Show more";
      delete more.dataset.loading;
    }
  }

  const seen = new IntersectionObserver((s) => s.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "300px" });
  seen.observe(more);
  return () => {
    stopped = true;
    seen.disconnect();
  };
}

// An older page without the router (still in the phone's cache) starts itself.
if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();

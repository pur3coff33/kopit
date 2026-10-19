// Loads older expenses automatically when "Show more" scrolls into view (the link still works without JS).
const list = document.querySelector("#history");
let more = document.querySelector("#more-history");

async function loadMore() {
  if (!more || more.dataset.loading) return;
  more.dataset.loading = "1";
  more.textContent = "Loading…";
  try {
    const res = await fetch(more.href);
    if (!res.ok) throw new Error(String(res.status));
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const incoming = doc.querySelector("#history");
    if (incoming) {
      // A day can continue across pages: merge into the last group instead of repeating its heading.
      const firstHeading = incoming.querySelector(".day");
      const lastHeading = [...list.querySelectorAll(".day")].at(-1);
      if (firstHeading && lastHeading && firstHeading.textContent === lastHeading.textContent) {
        const rows = firstHeading.nextElementSibling;
        list.lastElementChild.append(...rows.children);
        firstHeading.remove();
        rows.remove();
      }
      list.append(...incoming.children);
    }
    const next = doc.querySelector("#more-history");
    if (next) {
      more.href = next.href;
      more.textContent = "Show more";
      delete more.dataset.loading;
    } else {
      more.remove();
      more = null;
    }
  } catch {
    more.textContent = "Show more";
    delete more.dataset.loading;
  }
}

if (list && more && "IntersectionObserver" in window) {
  new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "300px" }).observe(more);
}

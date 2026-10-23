// The eye by the garden's and a category's total, flipped on the spot: every total on the screen hides (or shows)
// at once, and the person's setting is saved in the background. No signal or an error: the screen flips back. Without
// this script, the eye's form still works, reloading the page.

/** ₱12,250.50, as the server writes it (lib/money.ts). */
export function formatPeso(centavos) {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const pesos = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = abs % 100;
  return `${sign}₱${pesos}${cents ? "." + String(cents).padStart(2, "0") : ""}`;
}

/** A hidden total: the first digit and the shape, the rest dotted out (₱12,250.50 → ₱1•,•••), as the server does. */
export function maskPeso(centavos) {
  let first = true;
  return formatPeso(Math.trunc(centavos / 100) * 100).replace(/\d/g, (d) => (first ? ((first = false), d) : "•"));
}

/** Hides or shows every total and eye on the screen. */
function apply(hidden) {
  for (const el of document.querySelectorAll("[data-amount]")) {
    const c = Number(el.dataset.amount);
    el.textContent = hidden ? maskPeso(c) : formatPeso(c);
  }
  for (const form of document.querySelectorAll("form.eye")) {
    form.dataset.hidden = hidden ? "1" : "0";
    form.elements.hide.value = hidden ? "0" : "1"; // what the next tap asks for
    const label = hidden ? "Show total" : "Hide total";
    const button = form.querySelector("button");
    button.setAttribute("aria-label", label);
    button.title = label;
    const svg = button.querySelector("svg");
    const slash = svg.querySelector(".slash");
    if (hidden && !slash) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "slash");
      path.setAttribute("d", "M4 4l16 16");
      svg.append(path);
    } else if (!hidden) slash?.remove();
  }
}

async function onSubmit(ev) {
  const form = ev.target.closest?.("form.eye");
  if (!form) return;
  ev.preventDefault();
  const hidden = form.dataset.hidden !== "1";
  apply(hidden);
  try {
    const res = await fetch(form.action, {
      method: "POST",
      body: new URLSearchParams({ hide: hidden ? "1" : "0", back: form.elements.back.value }),
      credentials: "same-origin",
      redirect: "manual", // it answers with a redirect back to this screen; nothing to load
    });
    if (res.type !== "opaqueredirect" && !res.ok) throw new Error(String(res.status));
  } catch {
    apply(!hidden);
  }
}

/** Starts the eye on this screen; returns a function that stops it. */
export function mount() {
  document.addEventListener("submit", onSubmit);
  return () => document.removeEventListener("submit", onSubmit);
}

// An older page without the router (still in the phone's cache) starts itself.
if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();

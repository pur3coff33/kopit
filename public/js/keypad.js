// Amount entry shared by the add and edit screens. State is the typed string, "0" to start.
const MAX_CENTAVOS = 100_000_000; // ₱1,000,000, same cap as the server

export function toCentavos(s) {
  const [whole, frac = ""] = s.split(".");
  return Number(whole || "0") * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
}

export function press(current, key) {
  if (key === "back") return current.length <= 1 || current === "0." ? "0" : current.slice(0, -1);
  if (key === ".") return current.includes(".") ? current : current + ".";
  if (!/^\d$/.test(key)) return current;
  const dot = current.indexOf(".");
  if (dot !== -1 && current.length - dot > 2) return current;
  const next = current === "0" ? key : current + key;
  return toCentavos(next) > MAX_CENTAVOS ? current : next;
}

/** "1234.5" → "1,234.5" for display, keeping what was typed. */
export function display(s) {
  const [whole, frac] = s.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

/** Wires a .keys container to a state getter/setter. */
export function attachKeypad(keys, get, set) {
  keys.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-key]");
    if (btn) set(press(get(), btn.dataset.key));
  });
}

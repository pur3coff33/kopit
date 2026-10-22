// Spots a newer deploy and asks for a reload. A phone (an iPhone most of all) keeps the app open for days; after a
// deploy its old scripts meet new screens from the server, or the service worker's old copies, and taps stop
// answering. One full reload with those copies cleared puts the whole app on the newest version again.

/** True when `live` is a newer deploy than `running` (both upload times). Unknown on either side is not. */
export function needsUpdate(running, live) {
  return Boolean(running && live && live > running);
}

/** The deploy that made `doc` (a page's stamp), or "" for a page without one (the offline page, an old copy). */
export function versionOf(doc) {
  return doc.querySelector('meta[name="kopit-version"]')?.getAttribute("content") ?? "";
}

const PATIENCE_MS = 3000; // how long Reload waits for the new service worker before reloading anyway

let asked = false;

/** Clears the saved copies of the app (fonts stay: they don't change between deploys), then reloads. */
async function reload() {
  dispatchEvent(new Event("kopit:update")); // the add screen keeps what was typed
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith("kopit")) continue;
      const cache = await caches.open(name);
      for (const req of await cache.keys()) if (!new URL(req.url).pathname.startsWith("/fonts/")) await cache.delete(req);
    }
  } catch {}
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await Promise.race([reg?.update(), new Promise((resolve) => setTimeout(resolve, PATIENCE_MS))]);
  } catch {}
  location.reload();
}

/** Covers the app with the update note. There's no Later: carrying on with the old version is what hangs. */
export function askToUpdate() {
  if (asked) return;
  asked = true;
  const dialog = document.createElement("dialog");
  dialog.className = "sheet update";
  dialog.setAttribute("aria-labelledby", "update-title");
  dialog.innerHTML =
    '<h2 id="update-title">kop.it got an update</h2>' +
    "<p>Reload to get the newest version. Anything not synced yet stays safe on this phone.</p>" +
    '<button type="button" class="save">Reload</button>';
  dialog.addEventListener("cancel", (ev) => ev.preventDefault());
  const button = dialog.querySelector("button");
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Reloading…";
    reload();
  });
  document.body.append(dialog);
  dialog.showModal();
}

/** Asks the server which deploy is live; quiet when offline or there's no answer. */
async function check() {
  if (asked || !navigator.onLine) return;
  try {
    const res = await fetch("/version", { cache: "no-store" });
    if (res.ok && needsUpdate(versionOf(document), (await res.json()).version)) askToUpdate();
  } catch {}
}

// On opening, and each time the app comes back to the front (an iPhone resumes it rather than starting it again).
if (typeof document !== "undefined") {
  check();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
}

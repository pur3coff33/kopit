// "Install kopit on this phone" badge. Shown only on phones, only when kopit isn't installed yet.
const DISMISSED = "kopit-install-dismissed";

/** Which badge to show: "prompt" (real install button), "ios" (Add to Home Screen steps) or "hidden". */
export function installMode({ standalone, coarse, ios, canPrompt, dismissed }) {
  if (standalone || !coarse || dismissed) return "hidden";
  if (canPrompt) return "prompt";
  if (ios) return "ios";
  return "hidden";
}

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

if (typeof document !== "undefined") {
  const el = document.getElementById("install");
  let deferred = null;

  const render = () => {
    if (!el) return;
    const mode = installMode({
      standalone: matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
      coarse: matchMedia("(pointer: coarse)").matches,
      ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      canPrompt: deferred !== null,
      dismissed: wasDismissed(),
    });
    el.dataset.mode = mode;
    el.hidden = mode === "hidden";
  };

  addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    deferred = ev;
    render();
  });
  addEventListener("appinstalled", () => {
    deferred = null;
    if (el) el.hidden = true;
  });

  el?.querySelector("[data-install]")?.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    render();
  });
  el?.querySelector("[data-dismiss]")?.addEventListener("click", () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {}
    el.hidden = true;
  });

  render();
}

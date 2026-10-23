// "Install kopit on this phone": a small badge, and a full-screen page with the steps that opens by itself the first
// time. Shown only on phones, only when kopit isn't installed yet.
const DISMISSED = "kopit-install-dismissed";
const SEEN = "kopit-install-seen"; // the full-screen page has been closed on this phone

/**
 * Which badge to show: "prompt" (real install button), "ios" (Add to Home Screen steps), "chrome" (a browser that can't
 * install it: open it in Chrome) or "hidden".
 */
export function installMode({ standalone, coarse, ios, canPrompt, dismissed, noInstall = false }) {
  if (standalone || !coarse || dismissed) return "hidden";
  if (canPrompt) return "prompt";
  if (ios) return "ios";
  if (noInstall) return "chrome";
  return "hidden";
}

/**
 * Whether this is an Android browser that can never install a web app: Firefox, or the browser inside another app
 * (Facebook, Instagram, an in-app web view). Chrome, Samsung Internet and Edge are left out: when they show no prompt,
 * the app is most likely installed already.
 */
export function cannotInstall(userAgent) {
  return /android/i.test(userAgent) && /firefox|fban|fbav|instagram|snapchat|musical_ly|line\/|; wv\)/i.test(userAgent);
}

/** A link that makes Android open this page in Chrome. */
export function chromeLink({ protocol, host, pathname, search }) {
  return `intent://${host}${pathname}${search}#Intent;scheme=${protocol.replace(":", "")};package=com.android.chrome;end`;
}

/** Whether the full-screen page should open by itself: once, on a screen with the bottom bar, when nothing else is open. */
export function shouldAutoOpen({ mode, seen, onMainScreen, busy }) {
  return mode !== "hidden" && !seen && onMainScreen && !busy;
}

function flag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function setFlag(key) {
  try {
    localStorage.setItem(key, "1");
  } catch {}
}

if (typeof document !== "undefined") {
  const el = document.getElementById("install");
  const modal = document.getElementById("install-modal");
  let deferred = null;
  let mode = "hidden";
  let autoTried = false;

  const openModal = () => {
    if (modal && !modal.open && mode !== "hidden") modal.showModal();
  };

  // Opens the full-screen page by itself, once. A first-time tour goes first; the page follows when it closes.
  const autoOpen = () => {
    if (autoTried || !modal) return;
    const openIfFree = () =>
      shouldAutoOpen({ mode, seen: flag(SEEN), onMainScreen: !!document.querySelector(".app > .nav"), busy: !!document.querySelector("dialog[open]") }) &&
      openModal();
    const tour = document.getElementById("tour");
    if (tour?.open || tour?.dataset.due === "1") {
      if (mode === "hidden") return;
      autoTried = true;
      tour.addEventListener("close", () => setTimeout(openIfFree, 400), { once: true });
      return;
    }
    if (mode === "hidden") return;
    autoTried = true;
    setTimeout(openIfFree, 600);
  };

  const render = () => {
    if (!el) return;
    mode = installMode({
      standalone: matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
      coarse: matchMedia("(pointer: coarse)").matches,
      ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
      canPrompt: deferred !== null,
      dismissed: flag(DISMISSED),
      noInstall: cannotInstall(navigator.userAgent),
    });
    el.dataset.mode = mode;
    el.hidden = mode === "hidden";
    if (modal) modal.dataset.mode = mode;
    for (const a of document.querySelectorAll("[data-chrome]")) a.href = chromeLink(location);
    autoOpen();
  };

  addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    deferred = ev;
    render();
  });
  addEventListener("appinstalled", () => {
    deferred = null;
    modal?.close();
    if (el) el.hidden = true;
  });

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    modal?.close();
    render();
  };
  for (const btn of document.querySelectorAll("[data-install]")) btn.addEventListener("click", install);
  for (const btn of el?.querySelectorAll("[data-howto]") ?? []) btn.addEventListener("click", openModal);
  modal?.querySelector("[data-later]")?.addEventListener("click", () => modal.close());
  modal?.addEventListener("close", () => setFlag(SEEN)); // however it closed: the button, Escape, installing
  el?.querySelector("[data-dismiss]")?.addEventListener("click", () => {
    setFlag(DISMISSED);
    el.hidden = true;
  });

  render();
}

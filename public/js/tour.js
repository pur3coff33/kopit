// The first-time tours: a few stops on each screen, the screen dimmed and the part each stop is about lit up, with a
// note beside it. Closing a tour any way counts as having had it. The server remembers per person and screen; this
// phone also remembers, so an offline copy of a screen (rendered before the tour was closed) doesn't offer it again.

const SEEN = "kopit-tours-seen-"; // + the person's id: screens whose tour closed on this phone
const REPLAY = "kopit-tours-replay-"; // + the person's id: screens to play again the next time they're opened
const GAP = 12; // between the lit-up part and the note, and around the screen's edges
const PAD = 6; // room around the lit-up part

/** Open a screen's tour: asked for again, or this person hasn't had it and this phone hasn't shown it. */
export function shouldTour(due, seenHere, replay) {
  return replay || (due && !seenHere);
}

/**
 * Where the note goes for a lit-up `rect` in a `vw`×`vh` screen: below it if it fits, else above, else whichever side
 * has more room. `tip` is where its arrow points, along the note. No rect: in the middle, without an arrow.
 */
export function placeNote(rect, note, vw, vh) {
  const left = Math.round(Math.max(GAP, Math.min(vw - note.width - GAP, rect ? rect.left + rect.width / 2 - note.width / 2 : (vw - note.width) / 2)));
  if (!rect) return { left, top: Math.round(Math.max(GAP, (vh - note.height) / 2)), side: null, tip: 0 };
  const below = vh - (rect.top + rect.height) - GAP;
  const above = rect.top - GAP;
  const side = below >= note.height + GAP || below >= above ? "below" : "above";
  const top = side === "below" ? rect.top + rect.height + GAP : rect.top - GAP - note.height;
  const tip = Math.round(Math.max(22, Math.min(note.width - 22, rect.left + rect.width / 2 - left)));
  return { left, top: Math.round(Math.max(GAP, Math.min(vh - note.height - GAP, top))), side, tip };
}

function readList(key) {
  try {
    return (localStorage.getItem(key) ?? "").split(",").filter(Boolean);
  } catch {
    return [];
  }
}

function writeList(key, list) {
  try {
    localStorage.setItem(key, list.join(","));
  } catch {}
}

/** Tells the server this person has had a screen's tour. Fails quietly offline: the screen tries again next time. */
export function markToured(screen) {
  return fetch("/api/tour", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screen }),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {});
}

/** The parts of the screen a stop points at, outside the tour itself. */
function targets(dialog, spot) {
  return spot ? [...document.querySelectorAll(`[data-spot~="${spot}"]`)].filter((el) => !dialog.contains(el) && el.getClientRects().length) : [];
}

function union(els) {
  const rs = els.map((el) => el.getBoundingClientRect());
  const left = Math.min(...rs.map((r) => r.left)) - PAD;
  const top = Math.min(...rs.map((r) => r.top)) - PAD;
  return { left, top, width: Math.max(...rs.map((r) => r.right)) + PAD - left, height: Math.max(...rs.map((r) => r.bottom)) + PAD - top };
}

/** Shows the tour from its first stop; `onDone` runs once it's closed (finished, skipped or Escape). */
export function openTour(dialog, onDone) {
  const light = dialog.querySelector(".tour-spot");
  const note = dialog.querySelector(".tour-note");
  const skip = dialog.querySelector("[data-skip]");
  const back = dialog.querySelector("[data-back]");
  const next = dialog.querySelector("[data-next]");
  const count = dialog.querySelector(".tour-count");
  // Stops whose part isn't on the screen right now (no expenses yet, say) are left out.
  const steps = [...dialog.querySelectorAll(".tour-step")].filter((s) => !s.dataset.stepSpot || targets(dialog, s.dataset.stepSpot).length);
  if (steps.length === 0) return false;
  let at = 0;

  const place = () => {
    const els = targets(dialog, steps[at].dataset.stepSpot);
    const rect = els.length ? union(els) : null;
    light.classList.toggle("none", !rect);
    const r = rect ?? { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    Object.assign(light.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const p = placeNote(rect, { width: note.offsetWidth, height: note.offsetHeight }, innerWidth, innerHeight);
    Object.assign(note.style, { left: `${p.left}px`, top: `${p.top}px` });
    note.dataset.side = p.side ?? "";
    note.style.setProperty("--tip", `${p.tip}px`);
  };

  const show = (i) => {
    at = i;
    for (const s of dialog.querySelectorAll(".tour-step")) s.hidden = s !== steps[i];
    skip.hidden = i > 0;
    back.hidden = i === 0;
    count.textContent = steps.length > 1 ? `${i + 1} of ${steps.length}` : "";
    const last = i === steps.length - 1;
    next.textContent = last ? next.dataset.last : i === 0 && !steps[0].dataset.stepSpot ? next.dataset.first : next.dataset.label;
    dialog.setAttribute("aria-labelledby", steps[i].querySelector("h2").id);
    // Bring the part into view first (the garden shed's PIN is further down), then light it up.
    const first = targets(dialog, steps[i].dataset.stepSpot)[0];
    const r = first?.getBoundingClientRect();
    if (r && (r.top < 0 || r.bottom > innerHeight)) first.scrollIntoView({ block: "center" });
    place();
  };

  const onNext = () => (at < steps.length - 1 ? show(at + 1) : dialog.close());
  const onBack = () => at > 0 && show(at - 1);
  const onSkip = () => dialog.close();
  next.addEventListener("click", onNext);
  back.addEventListener("click", onBack);
  skip.addEventListener("click", onSkip);
  addEventListener("resize", place);
  addEventListener("scroll", place, { passive: true });
  dialog.addEventListener(
    "close",
    () => {
      next.removeEventListener("click", onNext);
      back.removeEventListener("click", onBack);
      skip.removeEventListener("click", onSkip);
      removeEventListener("resize", place);
      removeEventListener("scroll", place);
      onDone();
    },
    { once: true },
  );
  dialog.showModal();
  show(0); // after showModal: the note has its size only once it's showing
  return true;
}

/**
 * Opens this screen's tour if it's due, was asked for again (`replay`, or "Take the tour again" earlier), and returns
 * whether it opened. `onDone` runs when it's closed.
 */
export function startTour(dialog, { replay = false, onDone = () => {} } = {}) {
  const screen = dialog.dataset.screen;
  const id = dialog.dataset.profileId;
  const seen = readList(SEEN + id);
  const replays = readList(REPLAY + id);
  const due = dialog.dataset.due === "1";
  // Closed here while offline: the server still thinks it's due, so tell it again.
  if (due && seen.includes(screen)) markToured(screen);
  if (replay && dialog.dataset.then) writeList(REPLAY + id, dialog.dataset.then.split(","));
  if (!shouldTour(due, seen.includes(screen), replay || replays.includes(screen))) return false;
  const opened = openTour(dialog, () => {
    if (!seen.includes(screen)) writeList(SEEN + id, [...readList(SEEN + id), screen]);
    writeList(REPLAY + id, readList(REPLAY + id).filter((s) => s !== screen));
    if (dialog.dataset.due === "1") markToured(screen);
    delete dialog.dataset.due;
    onDone();
  });
  return opened;
}

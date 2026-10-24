// The start of the day, on whichever screen a person opens first (src/lib/morning.ts decides what's due): a recap to
// play, or the morning card with yesterday's leaf and its note. Waits for anything already open (a first-time tour, the
// install steps) to close. Each part shows once per person: closing the card, or a recap starting, tells the server.

const NOTE_WAIT_MS = 20_000; // a note written on the spot can take a few seconds; past this, the card goes without it
const NOTE_GONE_MS = 3_500; // how long a card that couldn't get its note says so before it closes itself
const DONE = "kopit-morning-done"; // "<person>|<Manila date>": nothing more due today, so don't ask again
const MANILA_OFFSET_MS = 8 * 3_600_000;

/** "YYYY-MM-DD" in Manila time. */
export function manilaDate(ms) {
  return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The key that says this person has nothing more due on the Manila day of `nowMs`. */
export function doneKey(person, nowMs) {
  return `${person}|${manilaDate(nowMs)}`;
}

function remember() {
  try {
    return localStorage.getItem(DONE);
  } catch {
    return null;
  }
}

function rememberDone(person) {
  try {
    localStorage.setItem(DONE, doneKey(person, Date.now()));
  } catch {}
}

function seen(had) {
  return fetch("/api/morning/seen", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(had),
    keepalive: true,
  }).then((r) => r.ok, () => false);
}

/** Puts a day's note in `slot`: "ok"; "none" when it has none and won't; "later" when it may come later (or we're offline). */
async function fillNote(slot, day) {
  try {
    const res = await fetch(`/api/day-note/${day}?full`, { credentials: "same-origin", signal: AbortSignal.timeout(NOTE_WAIT_MS) });
    if (res.status === 204) return "none";
    if (res.status !== 200) return "later";
    slot.innerHTML = await res.text();
    slot.firstElementChild?.classList.add("dn-in");
    return "ok";
  } catch {
    return "later";
  }
}

/** Opens the morning card (`m.card`, its HTML), fetching its note into it while it's open. */
function showCard(m, person) {
  document.querySelector("#morning-card")?.remove();
  document.body.insertAdjacentHTML("beforeend", m.card);
  const card = document.querySelector("#morning-card");
  if (!card) return;
  const slot = card.querySelector(".dn-slot");
  // No signal: the note can't come, so it waits for a launch with signal (a card that's only the note doesn't open).
  const note = m.note && navigator.onLine ? m.note : null;
  if (slot) slot.hidden = !note;
  if (!m.leaf && !note) return void card.remove();
  card.addEventListener(
    "close",
    () => {
      const had = {};
      if (m.leaf) had.leaf = m.leaf;
      if (note) had.note = note;
      seen(had);
      if (note || !m.note) rememberDone(person);
      setTimeout(() => card.remove(), 400);
    },
    { once: true },
  );
  card.showModal();
  if (!note || !slot) return;
  fillNote(slot, note).then((got) => {
    if (got === "ok") return;
    // The leaf stands on its own. A card that's only the note says what happened and closes itself: it's had for today
    // either way, and a note that can still come waits in History.
    if (m.leaf) return void (slot.hidden = true);
    slot.innerHTML = `<p class="dn-wait">${got === "later" ? "Couldn't write yesterday's note just now. You'll find it in History later." : "No note for yesterday this time."}</p>`;
    setTimeout(() => card.open && card.close(), NOTE_GONE_MS);
  });
}

let asking = false;

/** Asks what's due and plays it, unless this person is done for today or something else is open (then waits for it). */
async function check() {
  const person = document.querySelector('meta[name="kopit-person"]')?.content;
  if (!person || asking || document.visibilityState !== "visible") return;
  if (remember() === doneKey(person, Date.now())) return;
  if (document.querySelector("dialog[open], #tour[open]")) return; // its closing asks again (below)
  asking = true;
  try {
    const res = await fetch("/api/morning", { credentials: "same-origin" });
    if (res.status === 204) return rememberDone(person);
    if (!res.ok) return;
    const m = await res.json();
    if (document.querySelector("dialog[open]")) return; // something opened meanwhile: its closing asks again
    if (m.recap) {
      // Played only once the server knows, so a phone that can't tell it never loops back into the recap.
      if (await seen(m.marks)) location.assign(m.recap);
      return;
    }
    if (m.card) showCard(m, person);
  } catch {
    // offline: asked again when the app comes back with signal
  } finally {
    asking = false;
  }
}

if (typeof document !== "undefined") {
  check();
  document.addEventListener("visibilitychange", check);
  addEventListener("online", check);
  // A tour or the install steps closing: the day's start was waiting for it. (close doesn't bubble: caught on the way down.)
  document.addEventListener("close", (ev) => ev.target.id !== "morning-card" && setTimeout(check, 300), true);
}

import { attachKeypad, display, toCentavos } from "./keypad.js";
import { isStale, shouldCelebrate, shouldShowWrapped } from "./leaf.js";
import { sheetNotes, suggest, withPresets } from "./notes.js";
import { count, enqueue, flush, remove } from "./queue.js";
import { saveEntry } from "./save.js";

const $ = (sel) => document.querySelector(sel);
const LEAF_SEEN = "kopit-leaf-seen";
const WRAPPED_SEEN = "kopit-wrapped-seen";

function remember(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
// The screen's elements: looked up again each time the screen is mounted.
let profileId, amt, save, tiles, noteSheet, noteChips, noteOther, toastEl, toastText, undoBtn, noteToggle, noteBox, noteInput, suggestEl;

let notes = [];
let presets = {}; // category id → its ready-made notes
let typed = "0";
let categoryId = null;
let toastTimer;
let undoAction = null;

function render() {
  amt.textContent = display(typed);
  save.disabled = toCentavos(typed) === 0;
}

/** Shows a message; with `onUndo`, adds an Undo button and stays a little longer. */
export function toast(text, onUndo) {
  toastText.textContent = text;
  undoAction = onUndo ?? null;
  undoBtn.hidden = !onUndo;
  toastEl.classList.toggle("has-undo", !!onUndo);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
    undoAction = null;
  }, onUndo ? 5000 : 3000);
}

async function onUndo() {
  const action = undoAction;
  undoAction = null;
  undoBtn.hidden = true;
  if (action) toast(await action());
}

function select(id) {
  categoryId = id;
  for (const t of tiles.querySelectorAll(".cat")) t.classList.toggle("on", id !== null && t.dataset.id === String(id));
}

function onTile(ev) {
  const t = ev.target.closest(".cat");
  if (!t) return;
  const id = Number(t.dataset.id);
  if (categoryId === id) {
    select(null);
    return;
  }
  select(id);
  openSheet(t);
}

// ---------- the category's notes, sliding up after a tile is tapped ----------

function openSheet(tile) {
  if (!noteSheet) return; // an older offline copy of the screen, from before the sheet
  $("#note-sheet-title").textContent = `${tile.dataset.emoji} ${tile.dataset.name}: what was it?`;
  $("#note-skip").textContent = `Skip: just ${tile.dataset.name}`;
  noteOther.value = "";
  renderSheet();
  noteSheet.showModal();
}

function renderSheet() {
  noteChips.replaceChildren(
    ...sheetNotes(notes, categoryId, presets[categoryId], noteOther.value).map((text) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = text;
      b.addEventListener("click", () => useSheetNote(text));
      return b;
    }),
  );
}

/** The picked note goes in the note box (where it can still be changed), and the sheet closes. */
function useSheetNote(text) {
  noteInput.value = text;
  noteBox.hidden = false;
  noteToggle.hidden = true;
  suggestEl.replaceChildren();
  noteOther.blur(); // closes the keyboard so the amount and Save are visible again
  noteSheet.close();
}

function onOtherKey(ev) {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  const text = noteOther.value.trim().replace(/\s+/g, " ");
  if (text) useSheetNote(text);
  else noteSheet.close();
}

// ---------- note with autocomplete ----------

function renderSuggestions() {
  suggestEl.replaceChildren(
    ...suggest(withPresets(notes, presets), noteInput.value, 5).map((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = n.note;
      b.addEventListener("click", () => useNote(n));
      return b;
    }),
  );
}

function useNote(n) {
  noteInput.value = n.note;
  if (n.categoryId !== null && tiles.querySelector(`.cat[data-id="${n.categoryId}"]`)) select(n.categoryId);
  suggestEl.replaceChildren();
  noteInput.blur(); // closes the keyboard so the amount and Save are visible again
}

function openNote() {
  noteBox.hidden = false;
  noteToggle.hidden = true;
  renderSuggestions();
  noteInput.focus();
}

function resetNote() {
  noteInput.value = "";
  noteBox.hidden = true;
  noteToggle.hidden = false;
  suggestEl.replaceChildren();
}

function rememberNote(text, catId) {
  const i = notes.findIndex((n) => n.note.toLowerCase() === text.toLowerCase());
  const entry = i >= 0 ? notes.splice(i, 1)[0] : { note: text, count: 0 };
  entry.note = text;
  entry.categoryId = catId;
  entry.count += 1;
  const at = notes.findIndex((n) => n.count <= entry.count);
  notes.splice(at === -1 ? notes.length : at, 0, entry);
}

function onNoteKey(ev) {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  if (toCentavos(typed) > 0) onSave();
  else noteInput.blur();
}

// ---------- saving ----------

/** Sends one entry; returns the Response, or throws on network failure or abort. */
export function postEntry(entry, signal) {
  return fetch("/api/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
    signal,
  });
}

async function showSync() {
  const n = await count().catch(() => 0);
  const el = $("#sync"); // gone if you left the add screen while syncing
  if (el) el.textContent = n > 0 ? `${n} waiting to sync` : "";
}

async function sync() {
  const { sent } = await flush(postEntry).catch(() => ({ sent: 0 }));
  if (sent > 0) toast(`Synced ${sent} saved expense${sent === 1 ? "" : "s"} ✓`);
  await showSync();
}

/** Takes back the expense just saved, wherever it is: still on the phone, or already on the server. */
async function undo(id) {
  await remove(id).catch(() => {});
  try {
    const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(String(res.status));
  } catch {
    await showSync();
    return "Couldn't undo without signal. Delete it from History later.";
  }
  await showSync();
  return "Removed ✓";
}

async function onSave() {
  const note = noteInput.value.trim().replace(/\s+/g, " ").slice(0, 60);
  const entry = { id: crypto.randomUUID(), profileId, categoryId, amountCentavos: toCentavos(typed), note: note || null, spentAt: Date.now() };
  if (!entry.amountCentavos) return;
  if (note) rememberNote(note, categoryId);
  typed = "0";
  select(null);
  resetNote();
  render();
  const r = await saveEntry(entry, { enqueue, remove, post: postEntry });
  if (r.status === "saved") {
    toast(r.note, () => undo(entry.id));
    sync();
  } else if (r.status === "queued") {
    toast("Saved on this phone ✓ · will sync when online", () => undo(entry.id));
  } else {
    toast("Couldn't save that one. Try again?");
  }
  await showSync();
}

function onVisible() {
  if (document.visibilityState !== "visible") return;
  sync();
  // Back from the background, maybe on a new day: re-check yesterday's leaf.
  const root = $("#add");
  if (root) showGarden(root);
}

/** Celebrate yesterday's leaf once on this phone (fetching a fresh stamp first if this screen is from an earlier day). */
function showGarden(root) {
  if (isStale(root.dataset.day, Date.now())) {
    refreshGarden(root); // rendered on an earlier day: fetch today's leaf in the background
    return;
  }
  // A new month: last month's Wrapped plays first (once per phone, and only if this phone can remember it played).
  const month = root.dataset.wrapped ?? null;
  if (shouldShowWrapped(month, remember(WRAPPED_SEEN))) {
    try {
      localStorage.setItem(WRAPPED_SEEN, month);
      // The recap shows instead of yesterday's leaf card, not before it.
      if (root.dataset.leaf) localStorage.setItem(LEAF_SEEN, root.dataset.leaf);
    } catch {}
    if (remember(WRAPPED_SEEN) === month) {
      location.assign(`/wrapped/${month}`);
      return;
    }
  }
  const sheet = $("#leaf-sheet");
  if (!sheet || sheet.open || !shouldCelebrate(root.dataset.leaf ?? null, Date.now(), remember(LEAF_SEEN))) return;
  sheet.addEventListener(
    "close",
    () => {
      try {
        localStorage.setItem(LEAF_SEEN, root.dataset.leaf);
      } catch {}
    },
    { once: true },
  );
  sheet.showModal();
}

/** Swaps in today's leaf from a fresh copy of the add screen, and keeps that copy for the next offline launch. */
async function refreshGarden(root) {
  try {
    const res = await fetch("/", { credentials: "same-origin" });
    if (!res.ok || res.redirected) return;
    const copy = res.clone();
    self.caches?.open("kopit-v2").then((c) => c.put("/", copy)).catch(() => {});
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const fresh = doc.querySelector("#add");
    if (!fresh || root !== $("#add") || isStale(fresh.dataset.day, Date.now())) return; // left the screen, or still stale
    root.dataset.day = fresh.dataset.day;
    if (fresh.dataset.leaf) root.dataset.leaf = fresh.dataset.leaf;
    else delete root.dataset.leaf;
    if (fresh.dataset.wrapped) root.dataset.wrapped = fresh.dataset.wrapped;
    else delete root.dataset.wrapped;
    $("#leaf-sheet")?.remove();
    const sheet = doc.querySelector("#leaf-sheet");
    if (sheet) root.after(document.adoptNode(sheet));
    showGarden(root);
  } catch {} // offline: the leaf waits for a launch with signal
}

/** Starts the add screen; returns a function that stops it. */
export function mount() {
  const root = $("#add");
  profileId = Number(root.dataset.profileId);
  amt = $("#amt");
  save = $("#save");
  tiles = $("#tiles");
  noteSheet = $("#note-sheet");
  noteChips = $("#note-chips");
  noteOther = $("#note-other");
  toastEl = $("#toast");
  toastText = $("#toast-text");
  undoBtn = $("#toast-undo");
  noteToggle = $("#note-toggle");
  noteBox = $("#note-box");
  noteInput = $("#note");
  suggestEl = $("#suggest");
  try {
    notes = JSON.parse(root.dataset.notes || "[]");
  } catch {
    notes = [];
  }
  try {
    presets = JSON.parse(root.dataset.presets || "{}");
  } catch {
    presets = {};
  }
  typed = "0";
  categoryId = null;
  undoAction = null;

  attachKeypad($("#keys"), () => typed, (v) => {
    typed = v;
    render();
  });
  undoBtn.addEventListener("click", onUndo);
  tiles.addEventListener("click", onTile);
  if (noteSheet) {
    noteOther.addEventListener("input", renderSheet);
    noteOther.addEventListener("keydown", onOtherKey);
    $("#note-skip").addEventListener("click", () => noteSheet.close());
    $("#note-close").addEventListener("click", () => noteSheet.close());
  }
  noteToggle.addEventListener("click", openNote);
  noteInput.addEventListener("input", renderSuggestions);
  noteInput.addEventListener("focus", renderSuggestions);
  noteInput.addEventListener("keydown", onNoteKey);
  save.addEventListener("click", onSave);
  window.addEventListener("online", sync);
  document.addEventListener("visibilitychange", onVisible);
  render();
  sync();
  showGarden(root);

  return () => {
    window.removeEventListener("online", sync);
    document.removeEventListener("visibilitychange", onVisible);
    clearTimeout(toastTimer);
  };
}

// An older page without the router (still in the phone's cache) starts itself.
if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();

import { attachKeypad, display, keypadKeyFor, press, toCentavos } from "./keypad.js";
import { isStale, recapToPlay, shouldCelebrate } from "./leaf.js";
import { sheetNotes, suggest, withPresets } from "./notes.js";
import { count, enqueue, flush, remove } from "./queue.js";
import { saveEntry } from "./save.js";
import { startTour } from "./tour.js";

const $ = (sel) => document.querySelector(sel);
const LEAF_SEEN = "kopit-leaf-seen";
const WRAPPED_SEEN = "kopit-wrapped-seen";
const WEEK_SEEN = "kopit-week-seen";
const DRAFT = "kopit-draft"; // what was typed when an update reloaded the app (sessionStorage)

/** The amount, category and note kept across an update's reload, or null when there's nothing worth bringing back. */
export function readDraft(raw) {
  try {
    const d = JSON.parse(raw ?? "null");
    if (typeof d?.typed !== "string" || !/^\d+(\.\d{0,2})?$/.test(d.typed) || toCentavos(d.typed) === 0) return null;
    return {
      typed: d.typed,
      categoryId: Number.isInteger(d.categoryId) ? d.categoryId : null,
      note: typeof d.note === "string" ? d.note : "",
    };
  } catch {
    return null;
  }
}

function remember(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
// The screen's elements: looked up again each time the screen is mounted.
let profileId, amt, save, tiles, usual, pick, catSheet, noteSheet, noteChips, noteOther, noteUse, toastEl, toastText, undoBtn, noteToggle, noteBox, noteInput, suggestEl;
let pickIcon = ""; // the picker button's icon while nothing is picked

let notes = [];
let presets = {}; // category id → its ready-made notes
let typed = "0";
let categoryId = null;
let toastTimer;
let undoAction = null;

/** Typing the amount on a keyboard: digits, the point and Backspace press the keypad; Enter saves. */
function onKey(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return;
  if (document.querySelector("dialog[open]") || ev.target.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
  if (ev.key === "Enter") {
    if (!save.disabled) {
      ev.preventDefault();
      onSave();
    }
    return;
  }
  const key = keypadKeyFor(ev.key);
  if (key === null) return;
  ev.preventDefault();
  typed = press(typed, key);
  render();
}

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
  for (const t of document.querySelectorAll("#tiles .cat, #usual .cat")) t.classList.toggle("on", id !== null && t.dataset.id === String(id));
  if (!pick) return; // an older offline copy of the screen, with the tiles on it
  const tile = id === null ? null : tiles.querySelector(`.cat[data-id="${id}"]`);
  pick.classList.toggle("on", !!tile);
  const icon = $("#pick-e");
  if (tile) icon.textContent = tile.dataset.emoji;
  else icon.innerHTML = pickIcon;
  icon.style.cssText = tile?.style.cssText ?? "";
  $("#pick-name").textContent = tile ? tile.dataset.name : "What was it for?";
  $("#pick-sub").textContent = tile ? "Tap to change" : "Optional · tap to pick a category";
}

/** A usual chip (or a tile, on an older copy of the screen): picks it and slides its notes up; tapped again, unpicks. */
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

/** A tile in the picker: picks it, and the picker gives way to its notes. */
function onPickerTile(ev) {
  const t = ev.target.closest(".cat");
  if (!t) return;
  select(Number(t.dataset.id));
  catSheet.close();
  openSheet(t);
}

// ---------- the category's notes, sliding up after a tile is tapped ----------

function openSheet(tile) {
  if (!noteSheet) return; // an older offline copy of the screen, from before the sheet
  $("#note-sheet-title").textContent = `${tile.dataset.emoji} ${tile.dataset.name}: what was it?`;
  $("#note-skip").textContent = `Skip: just ${tile.dataset.name}`;
  const desc = $("#note-sheet-desc");
  if (desc) {
    desc.textContent = tile.dataset.desc ?? "";
    desc.hidden = !tile.dataset.desc;
  }
  noteOther.value = "";
  renderSheet();
  noteSheet.showModal();
}

function renderSheet() {
  if (noteUse) noteUse.disabled = !noteOther.value.trim();
  const mine = new Set(notes.filter((n) => n.categoryId === categoryId).map((n) => n.note.toLowerCase()));
  noteChips.replaceChildren(
    ...sheetNotes(notes, categoryId, presets[categoryId], noteOther.value).map((text) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = mine.has(text.toLowerCase()) ? "chip mine" : "chip";
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

/** What's typed in "Something else…" becomes the note (Use, or Enter); nothing typed just closes. */
function useOther() {
  const text = noteOther.value.trim().replace(/\s+/g, " ");
  if (text) useSheetNote(text);
  else noteSheet.close();
}

function onOtherKey(ev) {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  useOther();
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

/**
 * Opens the add screen's first-time tour if it's due (or asked for again with ?tour); returns whether it opened.
 * Yesterday's leaf and Wrapped wait until it's closed.
 */
function showTour(root) {
  const replay = new URLSearchParams(location.search).has("tour");
  if (replay) history.replaceState(history.state, "", "/"); // a reload shouldn't play it again
  const dialog = $("#tour");
  if (!dialog) return false; // an older offline copy of the screen, from before the tour
  return startTour(dialog, { replay, onDone: () => root === $("#add") && showGarden(root) });
}

/** Celebrate yesterday's leaf once on this phone (fetching a fresh stamp first if this screen is from an earlier day). */
function showGarden(root) {
  if ($("#tour")?.open) return; // the tour is on: the leaf waits for it to close
  if (isStale(root.dataset.day, Date.now())) {
    refreshGarden(root); // rendered on an earlier day: fetch today's leaf in the background
    return;
  }
  // A new month or week: its recap plays first (last month's and last week's as one story when both are due), once
  // per phone, and only if this phone can remember it played.
  const month = root.dataset.wrapped ?? null;
  const week = root.dataset.week ?? null;
  const recap = recapToPlay(month, week, remember(WRAPPED_SEEN), remember(WEEK_SEEN));
  if (recap) {
    try {
      if (month) localStorage.setItem(WRAPPED_SEEN, month);
      if (week) localStorage.setItem(WEEK_SEEN, week);
      // The recap shows instead of yesterday's leaf card, not before it.
      if (root.dataset.leaf) localStorage.setItem(LEAF_SEEN, root.dataset.leaf);
    } catch {}
    if ((!month || remember(WRAPPED_SEEN) === month) && (!week || remember(WEEK_SEEN) === week)) {
      location.assign(recap);
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
    if (fresh.dataset.week) root.dataset.week = fresh.dataset.week;
    else delete root.dataset.week;
    $("#leaf-sheet")?.remove();
    const sheet = doc.querySelector("#leaf-sheet");
    if (sheet) root.after(document.adoptNode(sheet));
    showGarden(root);
  } catch {} // offline: the leaf waits for a launch with signal
}

/** Keeps what's typed for after an update's reload. */
function keepDraft() {
  if (toCentavos(typed) === 0) return;
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({ typed, categoryId, note: noteInput.value }));
  } catch {}
}

/** Puts back what was typed before an update's reload, once. */
function restoreDraft() {
  let draft = null;
  try {
    draft = readDraft(sessionStorage.getItem(DRAFT));
    sessionStorage.removeItem(DRAFT);
  } catch {}
  if (!draft) return;
  typed = draft.typed;
  if (draft.categoryId !== null && tiles.querySelector(`.cat[data-id="${draft.categoryId}"]`)) select(draft.categoryId);
  if (draft.note) {
    noteInput.value = draft.note;
    noteBox.hidden = false;
    noteToggle.hidden = true;
  }
}

/** Starts the add screen; returns a function that stops it. */
export function mount() {
  const root = $("#add");
  profileId = Number(root.dataset.profileId);
  amt = $("#amt");
  save = $("#save");
  tiles = $("#tiles");
  usual = $("#usual");
  pick = $("#pick");
  catSheet = $("#cat-sheet");
  pickIcon = $("#pick-e")?.innerHTML ?? "";
  noteSheet = $("#note-sheet");
  noteChips = $("#note-chips");
  noteOther = $("#note-other");
  noteUse = $("#note-use");
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
  if (catSheet) {
    tiles.addEventListener("click", onPickerTile);
    usual.addEventListener("click", onTile);
    pick.addEventListener("click", () => catSheet.showModal());
    $("#cat-close").addEventListener("click", () => catSheet.close());
    $("#cat-none").addEventListener("click", () => {
      select(null);
      catSheet.close();
    });
  } else {
    tiles.addEventListener("click", onTile); // an older offline copy of the screen, with the tiles on it
  }
  if (noteSheet) {
    noteOther.addEventListener("input", renderSheet);
    noteOther.addEventListener("keydown", onOtherKey);
    noteUse?.addEventListener("click", useOther);
    $("#note-skip").addEventListener("click", () => noteSheet.close());
    $("#note-close").addEventListener("click", () => noteSheet.close());
  }
  noteToggle.addEventListener("click", openNote);
  noteInput.addEventListener("input", renderSuggestions);
  noteInput.addEventListener("focus", renderSuggestions);
  noteInput.addEventListener("keydown", onNoteKey);
  save.addEventListener("click", onSave);
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) document.addEventListener("keydown", onKey);
  window.addEventListener("online", sync);
  window.addEventListener("kopit:update", keepDraft);
  document.addEventListener("visibilitychange", onVisible);
  restoreDraft();
  render();
  sync();
  if (!showTour(root)) showGarden(root);

  return () => {
    window.removeEventListener("online", sync);
    window.removeEventListener("kopit:update", keepDraft);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("keydown", onKey);
    clearTimeout(toastTimer);
  };
}

// An older page without the router (still in the phone's cache) starts itself.
if (typeof document !== "undefined" && !globalThis.kopitRouter) mount();

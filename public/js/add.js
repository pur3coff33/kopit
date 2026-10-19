import { attachKeypad, display, toCentavos } from "./keypad.js";
import { suggest } from "./notes.js";
import { count, enqueue, flush, remove } from "./queue.js";
import { saveEntry } from "./save.js";

const $ = (sel) => document.querySelector(sel);
const root = $("#add");
const profileId = Number(root.dataset.profileId);
const amt = $("#amt");
const save = $("#save");
const tiles = $("#tiles");
const more = $("#more");
const sheet = $("#sheet");
const toastEl = $("#toast");
const toastText = $("#toast-text");
const undoBtn = $("#toast-undo");
const noteToggle = $("#note-toggle");
const noteBox = $("#note-box");
const noteInput = $("#note");
const suggestEl = $("#suggest");

let notes = [];
try {
  notes = JSON.parse(root.dataset.notes || "[]");
} catch {}

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

undoBtn.addEventListener("click", async () => {
  const action = undoAction;
  undoAction = null;
  undoBtn.hidden = true;
  if (action) toast(await action());
});

function resetMore() {
  more.innerHTML = '<span class="e">✏️</span>More';
  delete more.dataset.id;
}

function select(id) {
  categoryId = id;
  for (const t of tiles.querySelectorAll(".cat")) t.classList.toggle("on", id !== null && t.dataset.id === String(id));
}

/** Selects a category even if it isn't one of the 7 tiles (it then shows in the More tile). */
function selectCategory(id, emoji, name) {
  const inTiles = tiles.querySelector(`.cat[data-id="${id}"]:not(#more)`);
  if (inTiles) {
    resetMore();
  } else {
    more.dataset.id = String(id);
    more.innerHTML = `<span class="e"></span>`;
    more.firstChild.textContent = emoji;
    more.append(name);
  }
  select(id);
}

function pickFromSheet(btn) {
  selectCategory(Number(btn.dataset.id), btn.dataset.emoji, btn.dataset.name);
  sheet.close();
}

attachKeypad($("#keys"), () => typed, (v) => {
  typed = v;
  render();
});

tiles.addEventListener("click", (ev) => {
  const t = ev.target.closest(".cat");
  if (!t) return;
  if (t === more && !more.dataset.id) {
    $("#newcat").hidden = !navigator.onLine;
    $("#offline-note").hidden = navigator.onLine;
    sheet.showModal();
    return;
  }
  const id = Number(t.dataset.id);
  if (categoryId === id) {
    select(null);
    if (t === more) resetMore();
  } else {
    select(id);
  }
});

$("#all").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".cat");
  if (btn) pickFromSheet(btn);
});
$("#close").addEventListener("click", () => sheet.close());

$("#newcat").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  try {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.get("name"), emoji: f.get("emoji") }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const cat = await res.json();
    let btn = $(`#all .cat[data-id="${cat.id}"]`);
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat";
      Object.assign(btn.dataset, { id: cat.id, name: cat.name, emoji: cat.emoji });
      btn.innerHTML = '<span class="e"></span>';
      btn.firstChild.textContent = cat.emoji;
      btn.append(cat.name);
      $("#all").append(btn);
    }
    ev.target.reset();
    pickFromSheet(btn);
  } catch {
    toast("Couldn't add that category. Try again?");
  }
});

// ---------- note with autocomplete ----------

function renderSuggestions() {
  suggestEl.replaceChildren(
    ...suggest(notes, noteInput.value, 5).map((n) => {
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
  const cat = n.categoryId === null ? null : $(`#all .cat[data-id="${n.categoryId}"]`);
  if (cat) selectCategory(n.categoryId, cat.dataset.emoji, cat.dataset.name);
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

noteToggle.addEventListener("click", openNote);
noteInput.addEventListener("input", renderSuggestions);
noteInput.addEventListener("focus", renderSuggestions);
noteInput.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  if (toCentavos(typed) > 0) onSave();
  else noteInput.blur();
});

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
  $("#sync").textContent = n > 0 ? `${n} waiting to sync` : "";
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
  resetMore();
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

save.addEventListener("click", onSave);
window.addEventListener("online", sync);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") sync();
});
render();
sync();

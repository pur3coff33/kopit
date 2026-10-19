import { attachKeypad, display, toCentavos } from "./keypad.js";
import { count, enqueue, flush } from "./queue.js";

const $ = (sel) => document.querySelector(sel);
const root = $("#add");
const profileId = Number(root.dataset.profileId);
const amt = $("#amt");
const save = $("#save");
const tiles = $("#tiles");
const more = $("#more");
const sheet = $("#sheet");
const toastEl = $("#toast");

let typed = "0";
let categoryId = null;
let toastTimer;

function render() {
  amt.textContent = display(typed);
  save.disabled = toCentavos(typed) === 0;
}

export function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3000);
}

function resetMore() {
  more.innerHTML = '<span class="e">✏️</span>More';
  delete more.dataset.id;
}

function select(id) {
  categoryId = id;
  for (const t of tiles.querySelectorAll(".cat")) t.classList.toggle("on", id !== null && t.dataset.id === String(id));
}

function pickFromSheet(btn) {
  const inTiles = tiles.querySelector(`.cat[data-id="${btn.dataset.id}"]:not(#more)`);
  if (inTiles) {
    resetMore();
  } else {
    more.dataset.id = btn.dataset.id;
    more.innerHTML = `<span class="e"></span>`;
    more.firstChild.textContent = btn.dataset.emoji;
    more.append(btn.dataset.name);
  }
  select(Number(btn.dataset.id));
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

/** Sends one entry; returns the Response, or throws on network failure. */
export function postEntry(entry) {
  return fetch("/api/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
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

async function keepOnPhone(entry) {
  await enqueue(entry);
  toast("Saved on this phone ✓ · will sync when online");
  await showSync();
}

async function onSave() {
  const entry = { id: crypto.randomUUID(), profileId, categoryId, amountCentavos: toCentavos(typed), spentAt: Date.now() };
  if (!entry.amountCentavos) return;
  typed = "0";
  select(null);
  resetMore();
  render();
  let res;
  try {
    res = await postEntry(entry);
  } catch {
    return keepOnPhone(entry); // no signal
  }
  if (res.ok) {
    toast((await res.json()).note);
    sync();
  } else if (res.status === 401 || res.status >= 500) {
    await keepOnPhone(entry);
  } else {
    toast("Couldn't save that one. Try again?");
  }
}

save.addEventListener("click", onSave);
window.addEventListener("online", sync);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") sync();
});
render();
sync();

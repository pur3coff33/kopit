// Every expense waits here (IndexedDB "kopit" / "outbox") until the server confirms it.
import { sendQueued } from "./save.js";

const DB = "kopit";
const STORE = "outbox";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const enqueue = (entry) => run("readwrite", (s) => s.put(entry));
export const count = () => run("readonly", (s) => s.count());
export const remove = (id) => run("readwrite", (s) => s.delete(id));
const all = () => run("readonly", (s) => s.getAll());

let flushing = null;

/** Sends queued entries oldest first; stops at the first one that has to stay queued. */
export function flush(post) {
  flushing ??= (async () => {
    let sent = 0;
    try {
      const pending = (await all()).sort((a, b) => a.spentAt - b.spentAt);
      for (const entry of pending) {
        const r = await sendQueued(entry, { remove, post });
        if (r.status === "queued") break;
        if (r.status === "saved") sent++;
      }
      return { sent, left: await count() };
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

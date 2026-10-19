// Expenses saved while offline wait here (IndexedDB "kopit" / "outbox") until they can be sent.
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
const all = () => run("readonly", (s) => s.getAll());
const remove = (id) => run("readwrite", (s) => s.delete(id));

let flushing = null;

/** Sends queued entries oldest first. Stops at the first network error, 401 or 5xx. */
export function flush(post) {
  flushing ??= (async () => {
    let sent = 0;
    try {
      const pending = (await all()).sort((a, b) => a.spentAt - b.spentAt);
      for (const entry of pending) {
        let res;
        try {
          res = await post(entry);
        } catch {
          break;
        }
        if (res.ok) sent++;
        else if (res.status !== 400) break; // a 400 will never succeed, so drop it
        await remove(entry.id);
      }
      return { sent, left: await count() };
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

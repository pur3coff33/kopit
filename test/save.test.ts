import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { saveEntry } from "../public/js/save.js";

type Entry = { id: string };

function fakeOutbox() {
  const store = new Map<string, Entry>();
  return {
    store,
    enqueue: async (e: Entry) => void store.set(e.id, e),
    remove: async (id: string) => void store.delete(id),
  };
}

const entry = { id: "e1", amountCentavos: 100 };
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe("saveEntry", () => {
  it("keeps the entry on the phone before sending it", async () => {
    const box = fakeOutbox();
    let storedAtSend = false;
    await saveEntry(entry, { ...box, post: async () => ((storedAtSend = box.store.has("e1")), json(201, { note: "n" })) });
    expect(storedAtSend).toBe(true);
  });

  it("clears it once the server has it and returns the note", async () => {
    const box = fakeOutbox();
    const r = await saveEntry(entry, { ...box, post: async () => json(201, { note: "Saved ✓ · Food this week: ₱1" }) });
    expect(r).toEqual({ status: "saved", note: "Saved ✓ · Food this week: ₱1" });
    expect(box.store.size).toBe(0);
  });

  it("keeps it when there is no signal", async () => {
    const box = fakeOutbox();
    const r = await saveEntry(entry, { ...box, post: async () => Promise.reject(new TypeError("offline")) });
    expect(r).toEqual({ status: "queued" });
    expect(box.store.has("e1")).toBe(true);
  });

  it("gives up waiting on a hanging request but keeps the entry", async () => {
    const box = fakeOutbox();
    let aborted = false;
    const post = (_e: Entry, signal: AbortSignal) =>
      new Promise<Response>((_, reject) => signal.addEventListener("abort", () => ((aborted = true), reject(new Error("abort")))));
    const r = await saveEntry(entry, { ...box, post, timeoutMs: 20 });
    expect(r).toEqual({ status: "queued" });
    expect(aborted).toBe(true);
    expect(box.store.has("e1")).toBe(true);
  });

  it("keeps it on any non-400 failure", async () => {
    for (const status of [401, 403, 404, 408, 429, 500, 503]) {
      const box = fakeOutbox();
      expect(await saveEntry(entry, { ...box, post: async () => json(status) }), String(status)).toEqual({ status: "queued" });
      expect(box.store.has("e1")).toBe(true);
    }
  });

  it("drops it when the server says it can never be saved", async () => {
    const box = fakeOutbox();
    expect(await saveEntry(entry, { ...box, post: async () => json(400, { error: "amountCentavos" }) })).toEqual({ status: "rejected" });
    expect(box.store.size).toBe(0);
  });
});

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { entries } from "../src/db/schema";
import { updateEntry } from "../src/lib/entries";
import { authCookie, db, req, seedHousehold } from "./helpers";

function post(cookie: string, body: unknown) {
  return req("/api/entries", { method: "POST", cookie, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function setup() {
  const h = await seedHousehold();
  const cookie = await authCookie(h.householdId, h.profileIds[0]);
  const entry = (over: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    profileId: h.profileIds[0],
    categoryId: h.categoryIds.Groceries,
    amountCentavos: 35000,
    spentAt: Date.now(),
    ...over,
  });
  return { ...h, cookie, entry };
}

describe("POST /api/entries", () => {
  it("saves and returns this week's category total", async () => {
    const { cookie, entry } = await setup();
    const res = await post(cookie, entry());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "created", note: "Saved ✓ · Groceries this week: ₱350" });
    const second = await post(cookie, entry({ amountCentavos: 10050 }));
    expect(((await second.json()) as any).note).toBe("Saved ✓ · Groceries this week: ₱450.50");
  });

  it("leaves last week's spending out of the note", async () => {
    const { cookie, entry } = await setup();
    await post(cookie, entry({ amountCentavos: 99900, spentAt: Date.now() - 8 * 86_400_000 }));
    const res = await post(cookie, entry());
    expect(((await res.json()) as any).note).toBe("Saved ✓ · Groceries this week: ₱350");
  });

  it("totals uncategorized spending on its own", async () => {
    const { cookie, entry } = await setup();
    await post(cookie, entry({ amountCentavos: 50000 }));
    const res = await post(cookie, entry({ categoryId: null, amountCentavos: 12000 }));
    expect(((await res.json()) as any).note).toBe("Saved ✓ · This week: ₱120");
  });

  it("ignores a resend of the same id, even after an edit", async () => {
    const { cookie, entry, householdId } = await setup();
    const e = entry();
    await post(cookie, e);
    await updateEntry(env, householdId, e.id, { amountCentavos: 99900 }, Date.now());
    const again = await post(cookie, e);
    expect(again.status).toBe(201);
    expect(((await again.json()) as any).status).toBe("duplicate");
    const rows = await db().select().from(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCentavos).toBe(99900);
  });

  it("rejects ids from another household", async () => {
    const { cookie, entry } = await setup();
    const other = await seedHousehold();
    const p = await post(cookie, entry({ profileId: other.profileIds[0] }));
    expect(p.status).toBe(400);
    expect(await p.json()).toEqual({ error: "profileId" });
    const c = await post(cookie, entry({ categoryId: other.categoryIds.Food }));
    expect(c.status).toBe(400);
    expect(await c.json()).toEqual({ error: "categoryId" });
    expect(await db().select().from(entries)).toHaveLength(0);
  });

  it("validates fields", async () => {
    const { cookie, entry } = await setup();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ id: "not-a-uuid" }, "id"],
      [{ amountCentavos: 0 }, "amountCentavos"],
      [{ amountCentavos: 12.5 }, "amountCentavos"],
      [{ amountCentavos: 100_000_001 }, "amountCentavos"],
      [{ spentAt: "yesterday" }, "spentAt"],
    ];
    for (const [over, field] of cases) {
      const res = await post(cookie, entry(over));
      expect(res.status, field).toBe(400);
      expect(await res.json()).toEqual({ error: field });
    }
    const bad = await req("/api/entries", { method: "POST", cookie, headers: { "Content-Type": "application/json" }, body: "{" });
    expect(bad.status).toBe(400);
  });
});

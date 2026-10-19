import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { entries } from "../src/db/schema";
import { addEntry, authCookie, db, html, req, seedHousehold } from "./helpers";

describe("add screen notes", () => {
  it("offers a note field with the household's past notes for autocomplete", async () => {
    const h = await seedHousehold();
    const id = await addEntry(h, { amount: 100, at: Date.now(), category: "Food" });
    await db().update(entries).set({ note: `Jollibee "big" <meal>` }).where(eq(entries.id, id));
    const body = await (await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) })).text();
    expect(body).toContain("＋ note");
    expect(body).toContain('id="note"');
    const m = /data-notes="([^"]*)"/.exec(body);
    expect(m).not.toBeNull();
    const json = m![1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    expect(JSON.parse(json)).toEqual([{ note: `Jollibee "big" <meal>`, categoryId: h.categoryIds.Food, count: 1 }]);
  });
});

describe("add screen", () => {
  it("shows the top 7 tiles, More, the full sheet and the keypad", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const res = await req("/", { cookie: await authCookie(householdId, profileIds[1]) });
    expect(res.status).toBe(200);
    const body = await html(res);
    const tiles = body.slice(body.indexOf('id="tiles"'), body.indexOf('id="sheet"'));
    const names = [...tiles.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["Groceries", "Food", "Transport", "Bills", "Home", "Health", "Shopping"]);
    expect(tiles).toContain("More");
    const sheet = body.slice(body.indexOf('id="sheet"'));
    expect([...sheet.matchAll(/data-name="([^"]+)"/g)]).toHaveLength(12);
    expect(body).toContain(`data-profile-id="${profileIds[1]}"`);
    expect(body).toContain("Save it ✓");
    expect(body).toContain('src="/js/add.js"');
    expect(body).toContain("Partner");
  });
});

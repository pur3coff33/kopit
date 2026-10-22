import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { entries } from "../src/db/schema";
import { DAY_MS, dayStart, toDateInput } from "../src/lib/time";
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
  });
});

describe("add screen garden", () => {
  const view = async (h: Awaited<ReturnType<typeof seedHousehold>>) =>
    html(await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) }));

  it("celebrates yesterday's leaf (missions live on the garden screen, not here)", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: dayStart(now) - DAY_MS + 3_600_000 }); // started yesterday
    const body = await view(h);
    expect(body).toContain(`data-day="${toDateInput(now)}"`);
    expect(body).toContain(`data-leaf="${toDateInput(now - DAY_MS)}"`);
    expect(body).toContain("A perfect day! 🌸"); // a quiet day meets every mission
    expect(body).toContain("That's your 1st leaf");
  });

  it("has no leaf to celebrate after a day that broke its missions", async () => {
    const h = await seedHousehold({ createdAt: Date.now() - 3 * DAY_MS });
    const yesterday = dayStart(Date.now()) - DAY_MS;
    const cats = ["Groceries", "Food", "Transport", "Bills", "Home", "Shopping"];
    const amounts = [500_000, 4_000, 90_000, 200_000, 60_000, 120_000];
    for (let i = 0; i < cats.length; i++) await addEntry(h, { amount: amounts[i], at: yesterday + (7 + i * 3) * 3_600_000, category: cats[i] });
    const body = await view(h);
    expect(body).not.toContain("data-leaf=");
    expect(body).not.toContain('id="leaf-sheet"');
  });
});

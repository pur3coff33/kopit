import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { entries } from "../src/db/schema";
import { FIXED } from "../src/lib/categories";
import { DAY_MS, dayStart, toDateInput } from "../src/lib/time";
import { addEntry, authCookie, db, html, req, seedHousehold } from "./helpers";

describe("add screen notes", () => {
  it("offers a note field with the household's past notes for autocomplete", async () => {
    const h = await seedHousehold();
    const id = await addEntry(h, { amount: 100, at: Date.now(), category: "Eating out" });
    await db().update(entries).set({ note: `Jollibee "big" <meal>` }).where(eq(entries.id, id));
    const body = await (await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) })).text();
    expect(body).toContain("＋ note");
    expect(body).toContain('id="note"');
    const m = /data-notes="([^"]*)"/.exec(body);
    expect(m).not.toBeNull();
    const json = m![1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    expect(JSON.parse(json)).toEqual([{ note: `Jollibee "big" <meal>`, categoryId: h.categoryIds["Eating out"], count: 1 }]);
  });
});

describe("add screen", () => {
  it("shows all ten tiles in the fixed order, nothing to add or edit, and the keypad", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const res = await req("/", { cookie: await authCookie(householdId, profileIds[1]) });
    expect(res.status).toBe(200);
    const body = await html(res);
    const names = [...body.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(FIXED.map((c) => c.name));
    expect(body).not.toMatch(/class="cat"[^>]*id="more"/); // no More tile any more
    expect(body).toContain(`data-profile-id="${profileIds[1]}"`);
  });

  it("keeps hidden stand-ins for what an older add.js still in a phone's memory looks up, so its Save keeps working", async () => {
    // Right after an update, a phone can show the new add screen to the add.js it loaded before. That script looks up
    // these elements when it starts (and empties #more on every save); without them it stops before Save is wired up.
    const h = await seedHousehold();
    const body = await html(await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    for (const id of ["more", "sheet", "all", "close", "newcat"]) expect(body, id).toMatch(new RegExp(`id="${id}"`));
    expect(body).toMatch(/<span id="more" hidden=""><\/span>/);
    expect(body).toMatch(/<dialog id="sheet" hidden="">/);
  });

  it("groups the tiles under Needs and Wants, carries each one's presets, and keeps the note sheet closed", async () => {
    const h = await seedHousehold();
    const raw = await (await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) })).text();
    const body = raw.replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const tiles = body.slice(body.indexOf('id="tiles"'));
    expect(tiles.indexOf("Needs")).toBeLessThan(tiles.indexOf('data-name="Groceries"'));
    expect(tiles.indexOf('data-name="Household"')).toBeLessThan(tiles.indexOf("Wants"));
    expect(tiles.indexOf("Wants")).toBeLessThan(tiles.indexOf('data-name="Eating out"'));
    const attr = /data-presets="([^"]*)"/.exec(raw)![1];
    const presets = JSON.parse(attr.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&"));
    expect(presets[h.categoryIds["Eating out"]]).toContain("Jollibee");
    expect(presets[h.categoryIds.Bills]).toContain("Electricity");
    const sheet = body.match(/<dialog[^>]*id="note-sheet"[^>]*>/)![0];
    expect(sheet).not.toContain("open");
    expect(body).toContain('id="note-other"');
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
    const cats = ["Groceries", "Eating out", "Transport", "Bills", "Household", "Shopping"];
    const amounts = [500_000, 4_000, 90_000, 200_000, 60_000, 120_000];
    for (let i = 0; i < cats.length; i++) await addEntry(h, { amount: amounts[i], at: yesterday + (7 + i * 3) * 3_600_000, category: cats[i] });
    const body = await view(h);
    expect(body).not.toContain("data-leaf=");
    expect(body).not.toContain('id="leaf-sheet"');
  });
});

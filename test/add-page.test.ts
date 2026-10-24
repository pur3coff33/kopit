import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { entries } from "../src/db/schema";
import { FIXED } from "../src/lib/categories";
import { DAY_MS, dayStart } from "../src/lib/time";
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
  it("keeps all twelve in the fixed order in the picker, nothing to add or edit, and the keypad", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const res = await req("/", { cookie: await authCookie(householdId, profileIds[1]) });
    expect(res.status).toBe(200);
    const body = await html(res);
    const picker = body.slice(body.indexOf('id="cat-sheet"'));
    const names = [...picker.slice(0, picker.indexOf("</dialog>")).matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]);
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

  it("shows one button that opens every category, and the household's usual ones as chips", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 100, at: Date.now() - DAY_MS, category: "Vices" });
    const body = await html(await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    expect(body).toMatch(/<button[^>]*id="pick"/);
    expect(body).toContain("What was it for?");
    const usual = body.slice(body.indexOf('id="usual"'), body.indexOf('id="cat-sheet"'));
    expect([...usual.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Vices", "Groceries", "Meals", "Transport"]);
    const sheet = body.match(/<dialog[^>]*id="cat-sheet"[^>]*>/)![0];
    expect(sheet).not.toContain("open");
    expect(body).toContain('id="cat-none"');
  });

  it("carries each category's description for its notes sheet, which has a Use button and a Skip button", async () => {
    const h = await seedHousehold();
    const body = await html(await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    const meals = FIXED.find((c) => c.key === "meals")!;
    expect(body).toContain(`data-desc="${meals.description}"`);
    expect(body).toContain('id="note-sheet-desc"');
    expect(body).toMatch(/<button[^>]*id="note-use"[^>]*disabled/);
    expect(body).toMatch(/<button[^>]*class="skip"[^>]*id="note-skip"/);
  });

  it("groups the tiles under Needs and Wants, carries each one's presets, and keeps the note sheet closed", async () => {
    const h = await seedHousehold();
    const raw = await (await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) })).text();
    const body = raw.replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const tiles = body.slice(body.indexOf('id="tiles"'));
    expect(tiles.indexOf("Needs")).toBeLessThan(tiles.indexOf('data-name="Groceries"'));
    expect(tiles.indexOf('data-name="Family & Relationships"')).toBeGreaterThan(0);
    expect(tiles.indexOf('data-name="Family & Relationships"')).toBeLessThan(tiles.indexOf("Wants"));
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

describe("add screen and the day's start", () => {
  it("leaves the morning card to /js/morning.js, which every app screen loads", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: dayStart(now) - DAY_MS + 3_600_000 }); // started yesterday: a leaf is due
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const body = await html(await req("/", { cookie }));
    expect(body).not.toContain('id="morning-card"');
    expect(body).not.toContain("data-leaf=");
    for (const path of ["/", "/spending", "/history", "/settings"]) {
      const page = await html(await req(path, { cookie }));
      expect(page).toContain('<script type="module" src="/js/morning.js">');
      expect(page).toContain('<meta name="kopit-person" content="Jon"/>');
    }
    expect(await html(await req("/login"))).not.toContain("/js/morning.js");
  });
});

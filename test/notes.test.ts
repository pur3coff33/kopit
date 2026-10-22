import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { sheetNotes, suggest, withPresets } from "../public/js/notes.js";
import { entries } from "../src/db/schema";
import { noteSuggestions } from "../src/lib/notes";
import { authCookie, db, seedHousehold } from "./helpers";
import { req } from "./helpers";

async function setup() {
  const h = await seedHousehold();
  const cookie = await authCookie(h.householdId, h.profileIds[0]);
  const post = (over: Record<string, unknown>) =>
    req("/api/entries", {
      method: "POST",
      cookie,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), profileId: h.profileIds[0], categoryId: null, amountCentavos: 100, spentAt: Date.now(), ...over }),
    });
  return { h, post };
}

describe("notes in the category sheet", () => {
  const own = [
    { note: "Meralco", categoryId: 2, count: 5 },
    { note: "Jollibee", categoryId: 7, count: 3 },
    { note: "electricity", categoryId: 2, count: 1 },
  ];

  it("puts the household's own notes for the category first, then presets without repeats", () => {
    expect(sheetNotes(own, 2, ["Electricity", "Water"])).toEqual(["Meralco", "electricity", "Water"]);
  });

  it("filters by what's typed", () => {
    expect(sheetNotes(own, 2, ["Electricity", "Water"], "wa")).toEqual(["Water"]);
    expect(sheetNotes(own, 2, ["Electricity", "Water"], "ELEC")).toEqual(["electricity"]);
  });

  it("works for a category with no presets or own notes", () => {
    expect(sheetNotes(own, 9, undefined)).toEqual([]);
  });

  it("adds every preset to the note box's suggestions, own notes winning", () => {
    expect(withPresets(own, { 7: ["Jollibee", "KFC"] }).map((n: { note: string; categoryId: number }) => [n.note, n.categoryId])).toEqual([
      ["Meralco", 2],
      ["Jollibee", 7],
      ["electricity", 2],
      ["KFC", 7],
    ]);
  });
});

describe("notes on expenses", () => {
  it("stores a trimmed note, and an empty one as none", async () => {
    const { post } = await setup();
    expect((await post({ note: "  Jollibee   with  Ana " })).status).toBe(201);
    expect((await post({ note: "   " })).status).toBe(201);
    expect((await post({})).status).toBe(201);
    const notes = (await db().select().from(entries)).map((e) => e.note).sort();
    expect(notes).toEqual(["Jollibee with Ana", null, null]);
  });

  it("refuses notes over 60 characters or that aren't text", async () => {
    const { post } = await setup();
    for (const note of ["x".repeat(61), 42]) {
      const res = await post({ note });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "note" });
    }
    expect((await post({ note: "x".repeat(60) })).status).toBe(201);
  });
});

describe("noteSuggestions", () => {
  it("ranks notes by use, merges case, and remembers the latest category", async () => {
    const { h, post } = await setup();
    const t = Date.now() - 10_000;
    await post({ note: "Jollibee", categoryId: h.categoryIds["Eating out"], spentAt: t });
    await post({ note: "jollibee", categoryId: h.categoryIds["Fun & outings"], spentAt: t + 1000 });
    await post({ note: "Meralco", categoryId: h.categoryIds.Bills, spentAt: t + 2000 });
    const other = await seedHousehold();
    await db().insert(entries).values({
      id: crypto.randomUUID(), householdId: other.householdId, profileId: other.profileIds[0], categoryId: null,
      amountCentavos: 1, note: "Secret", spentAt: t, createdAt: t, updatedAt: t,
    });
    expect(await noteSuggestions(env, h.householdId)).toEqual([
      { note: "jollibee", categoryId: h.categoryIds["Fun & outings"], count: 2 },
      { note: "Meralco", categoryId: h.categoryIds.Bills, count: 1 },
    ]);
  });
});

describe("suggest (autocomplete)", () => {
  const notes = [
    { note: "Grab to work", count: 9 },
    { note: "Jollibee with Ana", count: 5 },
    { note: "Jollibee", count: 3 },
    { note: "Meralco", count: 2 },
  ];
  const names = (q: string, limit?: number) => suggest(notes, q, limit).map((n: { note: string }) => n.note);

  it("shows the most used when nothing is typed", () => {
    expect(names("", 3)).toEqual(["Grab to work", "Jollibee with Ana", "Jollibee"]);
  });
  it("puts notes starting with the text first, then other matches, ignoring case", () => {
    expect(names("JO")).toEqual(["Jollibee with Ana", "Jollibee"]);
    expect(names("ana")).toEqual(["Jollibee with Ana"]);
    expect(names("wo")).toEqual(["Grab to work"]);
  });
  it("matches the start of any word before the middle of a word", () => {
    expect(names("a", 10)).toEqual(["Jollibee with Ana", "Grab to work", "Meralco"]);
  });
  it("returns nothing when nothing matches", () => {
    expect(names("zzz")).toEqual([]);
  });
});

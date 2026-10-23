import { env } from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories, dayMissions, entries, gardenDays, households } from "../src/db/schema";
import { FIXED, listCategories } from "../src/lib/categories";
import { deleteEntry, getEntry, updateEntry } from "../src/lib/entries";
import { dayResults, freezeResults, missionDays } from "../src/lib/garden";
import { breakdown } from "../src/lib/stats";
import { planSwitch, switchCategories } from "../src/lib/switch";
import { DAY_MS, dayKey } from "../src/lib/time";
import { addEntry, authCookie, db, html, req, seedLegacyHousehold } from "./helpers";

const now = Date.UTC(2026, 9, 21, 4); // Wed Oct 21, 12:00 Manila
const manila = (m: number, d: number, h = 12) => Date.UTC(2026, m, d, h - 8);
const created = manila(9, 1, 9);

describe("planSwitch", () => {
  it("keeps, merges, adds and retires as the spec says", () => {
    const rows = ["Groceries", "Food", "Transport", "Bills", "Home", "Health", "Shopping", "Fun", "Coffee", "Load / Data", "Gifts", "Travel", "Pets"].map(
      (name, i) => ({ id: i + 1, name, emoji: "x", sortOrder: i }),
    );
    const p = planSwitch(rows);
    expect(p.keep).toEqual([
      { id: 1, key: "groceries" },
      { id: 2, key: "eating-out" },
      { id: 3, key: "transport" },
      { id: 4, key: "bills" },
      { id: 5, key: "household" },
      { id: 6, key: "health" },
      { id: 7, key: "shopping" },
      { id: 8, key: "fun" },
      { id: 11, key: "gifts" },
    ]);
    expect(p.add).toEqual(["meals", "school", "vices"]);
    expect(p.retire).toEqual([
      { id: 9, to: "eating-out", note: "Coffee" },
      { id: 10, to: "bills", note: "Mobile load" },
      { id: 12, to: "fun", note: "Travel" },
      { id: 13, to: null, note: "Pets" },
    ]);
  });

  it("takes a household's own 'school' or 'Eating Out' in place", () => {
    const p = planSwitch([
      { id: 1, name: "Food", emoji: "x", sortOrder: 0 },
      { id: 2, name: "Eating Out", emoji: "x", sortOrder: 1 },
      { id: 3, name: "school", emoji: "x", sortOrder: 2 },
    ]);
    expect(p.keep).toEqual([
      { id: 2, key: "eating-out" },
      { id: 3, key: "school" },
    ]);
    expect(p.retire).toEqual([{ id: 1, to: "eating-out", note: null }]);
  });

  it("keeps the exactly named row when two differ only in case", () => {
    const p = planSwitch([
      { id: 1, name: "bills", emoji: "x", sortOrder: 0 },
      { id: 2, name: "Bills", emoji: "x", sortOrder: 1 },
    ]);
    expect(p.keep).toEqual([{ id: 2, key: "bills" }]);
    expect(p.retire).toEqual([{ id: 1, to: "bills", note: null }]);
  });
});

/** A legacy household with three weeks of expenses across old categories, a hidden one and a custom one. */
async function legacy() {
  const h = await seedLegacyHousehold({ createdAt: created, extra: ["Pets", "school"] });
  await db().update(categories).set({ hidden: true }).where(eq(categories.id, h.categoryIds.Shopping));
  const ids: Record<string, string> = {};
  for (let d = 2; d <= 20; d++) {
    await addEntry(h, { amount: 15_000 + d * 1_000, at: manila(9, d, 9), category: "Food" });
    if (d % 2 === 0) await addEntry(h, { amount: 12_000, at: manila(9, d, 15), category: "Coffee" });
    if (d % 3 === 0) await addEntry(h, { amount: 80_000, at: manila(9, d, 18), category: "Groceries" });
    if (d % 5 === 0) await addEntry(h, { amount: 30_000, at: manila(9, d, 20), category: "Shopping" });
  }
  ids.coffee = await addEntry(h, { amount: 9_000, at: manila(9, 19, 16), category: "Coffee" });
  ids.latte = await addEntry(h, { amount: 9_500, at: manila(9, 19, 17), category: "Coffee" });
  await db().update(entries).set({ note: "latte" }).where(eq(entries.id, ids.latte));
  ids.food = await addEntry(h, { amount: 20_000, at: manila(9, 18, 12), category: "Food" });
  ids.load = await addEntry(h, { amount: 10_000, at: manila(9, 17, 12), category: "Load / Data" });
  ids.pets = await addEntry(h, { amount: 50_000, at: manila(9, 16, 12), category: "Pets" });
  ids.school = await addEntry(h, { amount: 70_000, at: manila(9, 15, 12), category: "school" });
  ids.today = await addEntry(h, { amount: 5_000, at: manila(9, 21, 8), category: "Coffee" });
  // The household used the app every day until now: each day's missions (today's too) were drawn on its old
  // categories, the ones it hadn't hidden, and stored then. freezeResults stores them the same way.
  const old = (await db().select().from(categories).where(and(eq(categories.householdId, h.householdId), eq(categories.hidden, false)))).map(
    (c) => ({ id: c.id, name: c.name, emoji: c.emoji }),
  );
  await freezeResults(env, h.householdId, created, now + DAY_MS, old);
  return { h, ids };
}

const pastDays = () => {
  const out: number[] = [];
  for (let d = dayKey(created); d < dayKey(now); d++) out.push(d);
  return out;
};

async function snapshot(householdId: number) {
  const where = <T extends { householdId: unknown }>(t: T) => eq(t.householdId as never, householdId);
  return {
    entries: await db().select().from(entries).where(where(entries)).orderBy(asc(entries.id)),
    categories: await db().select().from(categories).where(where(categories)).orderBy(asc(categories.id)),
    garden: await db().select().from(gardenDays).where(where(gardenDays)).orderBy(asc(gardenDays.day)),
  };
}

describe("switchCategories", () => {
  it("freezes every past day exactly as it was, then moves the expenses", async () => {
    const { h, ids } = await legacy();
    const days = pastDays();
    const beforeHistory = await missionDays(env, h.householdId, created, days, now);
    const beforeResults = await dayResults(env, h.householdId, created, days[0], dayKey(now), now);
    const entryCount = (await snapshot(h.householdId)).entries.length;
    const rowCount = (await snapshot(h.householdId)).categories.length;

    await switchCategories(env, h.householdId, created, now);

    expect((await listCategories(env, h.householdId)).map((c) => c.key)).toEqual(FIXED.map((c) => c.key));
    const [hh] = await db().select().from(households).where(eq(households.id, h.householdId));
    expect(hh.categoriesSet).toBe(2);
    const garden = await db().select().from(gardenDays).where(eq(gardenDays.householdId, h.householdId));
    expect(garden.map((g) => g.day).sort()).toEqual(days);
    expect(garden.every((g) => g.final && g.items !== null)).toBe(true);
    // The test means something only if some past missions were about the categories that moved.
    expect(garden.some((g) => /☕|🍜 Food/.test(g.items ?? ""))).toBe(true);

    expect(await missionDays(env, h.householdId, created, days, now)).toEqual(beforeHistory);
    expect(await dayResults(env, h.householdId, created, days[0], dayKey(now), now)).toEqual(beforeResults);

    const cats = Object.fromEntries((await listCategories(env, h.householdId)).map((c) => [c.key, c.id]));
    const get = (id: string) => getEntry(env, h.householdId, id);
    expect(await get(ids.coffee)).toMatchObject({ categoryId: cats["eating-out"], note: "Coffee" });
    expect(await get(ids.latte)).toMatchObject({ categoryId: cats["eating-out"], note: "latte" });
    expect(await get(ids.food)).toMatchObject({ categoryId: cats["eating-out"], note: null });
    expect(await get(ids.load)).toMatchObject({ categoryId: cats.bills, note: "Mobile load" });
    expect(await get(ids.pets)).toMatchObject({ categoryId: null, note: "Pets" });
    expect(await get(ids.school)).toMatchObject({ categoryId: cats.school, note: null });
    expect(cats.school).toBe(h.categoryIds.school); // the household's own "school" became School in place

    const today = await db()
      .select()
      .from(dayMissions)
      .where(and(eq(dayMissions.householdId, h.householdId), eq(dayMissions.day, dayKey(now))));
    expect(today).toHaveLength(0);
    const after = await snapshot(h.householdId);
    expect(after.entries).toHaveLength(entryCount);
    expect(after.categories).toHaveLength(rowCount + 2); // nothing deleted; School was already there as "school"; Meals and Vices added
  });

  it("does nothing the second time, or when two phones run it at once", async () => {
    const { h } = await legacy();
    const before = (await snapshot(h.householdId)).categories.length;
    await Promise.all([switchCategories(env, h.householdId, created, now), switchCategories(env, h.householdId, created, now)]);
    const once = await snapshot(h.householdId);
    expect(once.categories).toHaveLength(before + 2); // Meals and Vices added, once
    await switchCategories(env, h.householdId, created, now);
    expect(await snapshot(h.householdId)).toEqual(once);
  });

  it("adds the categories a household never had", async () => {
    const h = await seedLegacyHousehold({ createdAt: created });
    await switchCategories(env, h.householdId, created, now);
    const rows = await db().select().from(categories).where(eq(categories.householdId, h.householdId));
    expect(rows).toHaveLength(15); // the old twelve, plus Meals, School and Vices
    expect((await listCategories(env, h.householdId)).map((c) => `${c.emoji} ${c.name}`)).toEqual(FIXED.map((c) => `${c.emoji} ${c.name}`));
  });

  it("keeps frozen days frozen when an old expense is edited or deleted", async () => {
    const { h, ids } = await legacy();
    await switchCategories(env, h.householdId, created, now);
    const days = pastDays();
    const history = await missionDays(env, h.householdId, created, days, now);
    const garden = await db().select().from(gardenDays).where(eq(gardenDays.householdId, h.householdId)).orderBy(asc(gardenDays.day));
    const filter = { householdId: h.householdId, profileId: null, start: created, end: now };
    const total = (await breakdown(env, filter)).total;

    await updateEntry(env, h.householdId, ids.food, { amountCentavos: 200_000 }, now);
    await deleteEntry(env, h.householdId, ids.pets, now);

    expect(await db().select().from(gardenDays).where(eq(gardenDays.householdId, h.householdId)).orderBy(asc(gardenDays.day))).toEqual(garden);
    expect(await missionDays(env, h.householdId, created, days, now)).toEqual(history);
    expect((await breakdown(env, filter)).total).toBe(total + 180_000 - 50_000);
  });

  it("runs on the household's first request", async () => {
    const h = await seedLegacyHousehold();
    const res = await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) });
    expect(res.status).toBe(200);
    expect(await html(res)).toContain('data-name="Eating out"');
    const [hh] = await db().select().from(households).where(eq(households.id, h.householdId));
    expect(hh.categoriesSet).toBe(2);
  });
});

describe("an old category id from an offline phone", () => {
  it("saves into the category it moved to, or none, with the old name as note", async () => {
    const h = await seedLegacyHousehold({ extra: ["Pets"] });
    await switchCategories(env, h.householdId, Date.now(), Date.now());
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const post = async (categoryId: number, note: string | null) => {
      const id = crypto.randomUUID();
      const res = await req("/api/entries", {
        method: "POST",
        cookie,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, profileId: h.profileIds[0], categoryId, amountCentavos: 1000, note, spentAt: Date.now() }),
      });
      expect(res.status).toBe(201);
      return getEntry(env, h.householdId, id);
    };
    const eatingOut = (await listCategories(env, h.householdId)).find((c) => c.key === "eating-out")!.id;
    expect(await post(h.categoryIds.Coffee, null)).toMatchObject({ categoryId: eatingOut, note: "Coffee" });
    expect(await post(h.categoryIds.Coffee, "flat white")).toMatchObject({ categoryId: eatingOut, note: "flat white" });
    expect(await post(h.categoryIds.Pets, null)).toMatchObject({ categoryId: null, note: "Pets" });
  });
});

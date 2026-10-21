import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { breakdown, categoryPace, noSpendDays, noSpendText, pace, paceText, weeklyTotals } from "../src/lib/stats";
import { resolveRange } from "../src/lib/time";
import { addEntry, seedHousehold } from "./helpers";

const now = Date.UTC(2026, 9, 19, 4, 0); // 12:00 Manila Mon Oct 19
const manila = (m: number, d: number, h = 12, min = 0) => Date.UTC(2026, m, d, h - 8, min);

describe("breakdown", () => {
  it("sums by category, largest first, with uncategorized", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 790000, at: manila(9, 3), category: "Groceries" });
    await addEntry(h, { amount: 435000, at: manila(9, 4), category: "Food" });
    await addEntry(h, { amount: 115000, at: manila(9, 5), category: null });
    await addEntry(h, { amount: 999900, at: manila(8, 30), category: "Food" }); // September
    const { start, end } = resolveRange("this", now);
    const b = await breakdown(env, { householdId: h.householdId, profileId: null, start, end });
    expect(b.total).toBe(1340000);
    expect(b.count).toBe(3);
    expect(b.rows.map((r) => [r.name, r.amount])).toEqual([["Groceries", 790000], ["Food", 435000], ["Uncategorized", 115000]]);
    expect(b.rows[2]).toMatchObject({ categoryId: null, emoji: "·", count: 1 });
  });

  it("filters by profile and keeps other households out", async () => {
    const h = await seedHousehold();
    const other = await seedHousehold();
    await addEntry(h, { amount: 1000, at: manila(9, 3), category: "Food", profile: 0 });
    await addEntry(h, { amount: 2000, at: manila(9, 3), category: "Food", profile: 1 });
    await addEntry(other, { amount: 4000, at: manila(9, 3), category: "Food" });
    const { start, end } = resolveRange("this", now);
    expect((await breakdown(env, { householdId: h.householdId, profileId: h.profileIds[1], start, end })).total).toBe(2000);
    expect((await breakdown(env, { householdId: h.householdId, profileId: null, start, end })).total).toBe(3000);
  });

  it("keeps 23:30 on Oct 31 in October", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 500, at: manila(9, 31, 23, 30), category: "Food" });
    const oct = resolveRange("custom", now, "2026-10-01", "2026-10-31");
    const nov = resolveRange("custom", now, "2026-11-01", "2026-11-30");
    expect((await breakdown(env, { householdId: h.householdId, profileId: null, ...oct })).total).toBe(500);
    expect((await breakdown(env, { householdId: h.householdId, profileId: null, ...nov })).total).toBe(0);
  });
});

describe("pace", () => {
  it("compares with the same point last month", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 100000, at: manila(9, 5), category: "Food" });
    await addEntry(h, { amount: 310000, at: manila(8, 10), category: "Food" });
    await addEntry(h, { amount: 500000, at: manila(8, 25), category: "Food" });
    expect(await pace(env, h.householdId, null, now)).toEqual({ diff: -210000 });
    expect(paceText(-210000)).toBe("🌱 ₱2,100 less than this time last month");
    expect(paceText(90000)).toBe("₱900 more than this time last month");
    expect(paceText(0)).toBe("Same as this time last month");
  });

  it("is hidden when last month has nothing", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 100000, at: manila(9, 5), category: "Food" });
    expect(await pace(env, h.householdId, null, now)).toBeNull();
  });

  it("clamps to the end of a shorter last month", async () => {
    const h = await seedHousehold();
    const mar31 = Date.UTC(2026, 2, 31, 4);
    await addEntry(h, { amount: 50000, at: Date.UTC(2026, 1, 28, 4), category: "Food" });
    await addEntry(h, { amount: 20000, at: Date.UTC(2026, 2, 2, 4), category: "Food" });
    expect(await pace(env, h.householdId, null, mar31)).toEqual({ diff: -30000 });
  });
});

describe("no-spend days", () => {
  it("counts elapsed days since the household started with no expenses", async () => {
    const h = await seedHousehold({ createdAt: manila(9, 5, 10) });
    await addEntry(h, { amount: 100, at: manila(9, 6), category: "Food" });
    await addEntry(h, { amount: 100, at: manila(9, 10, 23, 50), category: "Food" });
    await addEntry(h, { amount: 100, at: manila(9, 10, 8), category: "Food" });
    const range = resolveRange("this", now);
    expect(await noSpendDays(env, { householdId: h.householdId, profileId: null, ...range }, manila(9, 5, 10), now)).toBe(12);
  });

  it("words the count", () => {
    expect(noSpendText(0, "this")).toBeNull();
    expect(noSpendText(1, "this")).toBe("1 no-spend day this month");
    expect(noSpendText(6, "last")).toBe("6 no-spend days last month");
    expect(noSpendText(2, "custom")).toBe("2 no-spend days in this range");
  });
});

describe("weeklyTotals", () => {
  it("totals one category per Manila week, Monday start, empty weeks included", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 10000, at: manila(9, 2), category: "Food" });
    await addEntry(h, { amount: 30000, at: manila(9, 14), category: "Food" });
    await addEntry(h, { amount: 99900, at: manila(9, 14), category: "Bills" });
    const oct21 = manila(9, 21);
    const { start, end } = resolveRange("this", oct21);
    const weeks = await weeklyTotals(env, { householdId: h.householdId, profileId: null, start, end }, h.categoryIds.Food, oct21);
    expect(weeks.map((w) => w.total)).toEqual([10000, 0, 30000, 0]);
    expect(weeks[0].start).toBe(manila(8, 28, 0)); // Mon Sep 28
  });
});

describe("categoryPace", () => {
  it("compares one category with last month up to the same point", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 10000, at: manila(8, 3), category: "Food" });
    await addEntry(h, { amount: 30000, at: manila(9, 3), category: "Food" });
    await addEntry(h, { amount: 50000, at: manila(9, 3), category: "Bills" });
    expect(await categoryPace(env, h.householdId, null, h.categoryIds.Food, now)).toEqual({ diff: 20000, prevMonth: "Sep" });
    expect(await categoryPace(env, h.householdId, null, h.categoryIds.Bills, now)).toBeNull(); // no Bills last month
  });
});

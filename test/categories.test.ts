import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { FIXED, listCategories, usualCategories } from "../src/lib/categories";
import { DAY_MS } from "../src/lib/time";
import { addEntry, authCookie, req, seedHousehold } from "./helpers";

describe("FIXED", () => {
  it("has the twelve in order, seven needs then five wants", () => {
    expect(FIXED.map((c) => c.key)).toEqual(["groceries", "meals", "bills", "transport", "health", "school", "household", "eating-out", "shopping", "fun", "gifts", "vices"]);
    expect(FIXED.map((c) => `${c.emoji} ${c.name}`)).toEqual([
      "🛒 Groceries",
      "🍱 Meals",
      "💡 Bills",
      "🚌 Transport",
      "💊 Health",
      "📚 Work & Education",
      "🏠 Family & Others",
      "🍜 Eating out",
      "🛍️ Shopping",
      "🎉 Fun & outings",
      "🎁 Gifts & occasions",
      "🚬 Vices",
    ]);
    expect(FIXED.map((c) => c.group)).toEqual([...Array(7).fill("need"), ...Array(5).fill("want")]);
  });

  it("says in one short line what goes in each", () => {
    for (const c of FIXED) expect(c.description.length, c.key).toBeGreaterThan(10);
    for (const c of FIXED) expect(c.description.length, c.key).toBeLessThanOrEqual(90);
  });

  it("gives every preset one home", () => {
    const all = FIXED.flatMap((c) => c.presets.map((p) => p.toLowerCase()));
    expect(new Set(all).size).toBe(all.length);
    for (const c of FIXED) expect(c.presets.length).toBeGreaterThan(0);
    expect(all.every((p) => p.length <= 60)).toBe(true);
    expect(FIXED.find((c) => c.key === "eating-out")!.presets).toContain("Jollibee");
    expect(FIXED.find((c) => c.key === "bills")!.presets).toContain("Loan payment");
    const vices = FIXED.find((c) => c.key === "vices")!.presets;
    for (const p of ["Beer", "Bar", "Drinks", "Cigarettes", "Vape", "Lotto", "E-sabong"]) expect(vices).toContain(p);
    expect(FIXED.find((c) => c.key === "fun")!.presets).not.toContain("Bar");
    const meals = FIXED.find((c) => c.key === "meals")!.presets;
    for (const p of ["Office lunch", "Lunch", "Dinner", "Carinderia", "Canteen", "Baon", "Food stall"]) expect(meals).toContain(p);
    expect(FIXED.find((c) => c.key === "eating-out")!.presets).not.toContain("Lunch");
    expect(FIXED.find((c) => c.key === "household")!.presets).toContain("Money for family");
  });
});

describe("a new household", () => {
  it("starts on the fixed twelve", async () => {
    const { householdId } = await seedHousehold();
    expect((await listCategories(env, householdId)).map((c) => c.key)).toEqual(FIXED.map((c) => c.key));
  });
});

describe("usualCategories", () => {
  const now = Date.UTC(2026, 9, 21, 4);
  const keys = async (householdId: number) => (await usualCategories(env, householdId, now)).map((c) => c.key);

  it("is the household's four most used of the last 60 days, topped up from the everyday ones", async () => {
    const h = await seedHousehold();
    for (let i = 0; i < 3; i++) await addEntry(h, { amount: 100, at: now - (i + 1) * DAY_MS, category: "Transport" });
    for (let i = 0; i < 2; i++) await addEntry(h, { amount: 100, at: now - (i + 1) * DAY_MS, category: "Eating out" });
    await addEntry(h, { amount: 100, at: now - DAY_MS, category: "Health" });
    for (let i = 0; i < 5; i++) await addEntry(h, { amount: 100, at: now - 61 * DAY_MS, category: "Shopping" }); // too long ago
    await addEntry(h, { amount: 100, at: now - DAY_MS, category: null });
    expect(await keys(h.householdId)).toEqual(["transport", "eating-out", "health", "groceries"]);
  });

  it("starts as Groceries, Meals, Transport and Bills", async () => {
    const h = await seedHousehold();
    expect(await keys(h.householdId)).toEqual(["groceries", "meals", "transport", "bills"]);
  });
});

describe("POST /api/categories", () => {
  it("is gone", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const cookie = await authCookie(householdId, profileIds[0]);
    const res = await req("/api/categories", { method: "POST", cookie, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Pets" }) });
    expect(res.status).toBe(404);
  });
});

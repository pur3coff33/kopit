import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { FIXED, listCategories } from "../src/lib/categories";
import { authCookie, req, seedHousehold } from "./helpers";

describe("FIXED", () => {
  it("has the ten in order, six needs then four wants", () => {
    expect(FIXED.map((c) => c.key)).toEqual(["groceries", "bills", "transport", "health", "school", "household", "eating-out", "shopping", "fun", "gifts"]);
    expect(FIXED.map((c) => `${c.emoji} ${c.name}`)).toEqual([
      "🛒 Groceries",
      "💡 Bills",
      "🚌 Transport",
      "💊 Health",
      "📚 School",
      "🧴 Household",
      "🍜 Eating out",
      "🛍️ Shopping",
      "🎉 Fun & outings",
      "🎁 Gifts & occasions",
    ]);
    expect(FIXED.map((c) => c.group)).toEqual([...Array(6).fill("need"), ...Array(4).fill("want")]);
  });

  it("gives every preset one home", () => {
    const all = FIXED.flatMap((c) => c.presets.map((p) => p.toLowerCase()));
    expect(new Set(all).size).toBe(all.length);
    for (const c of FIXED) expect(c.presets.length).toBeGreaterThan(0);
    expect(all.every((p) => p.length <= 60)).toBe(true);
    expect(FIXED.find((c) => c.key === "eating-out")!.presets).toContain("Jollibee");
    expect(FIXED.find((c) => c.key === "bills")!.presets).toContain("Loan payment");
  });
});

describe("a new household", () => {
  it("starts on the fixed ten", async () => {
    const { householdId } = await seedHousehold();
    expect((await listCategories(env, householdId)).map((c) => c.key)).toEqual(FIXED.map((c) => c.key));
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

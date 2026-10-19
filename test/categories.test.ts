import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { entries } from "../src/db/schema";
import { createCategory, listCategories, renameCategory, setCategoryHidden, topCategories } from "../src/lib/categories";
import { authCookie, db, req, seedHousehold } from "./helpers";

async function spend(householdId: number, profileId: number, categoryId: number, times: number) {
  for (let i = 0; i < times; i++) {
    const now = Date.now();
    await db().insert(entries).values({ id: crypto.randomUUID(), householdId, profileId, categoryId, amountCentavos: 100, spentAt: now, createdAt: now, updatedAt: now });
  }
}

describe("topCategories", () => {
  it("starts in seed order", async () => {
    const { householdId } = await seedHousehold();
    expect((await topCategories(env, householdId)).map((c) => c.name)).toEqual(["Groceries", "Food", "Transport", "Bills", "Home", "Health", "Shopping"]);
  });

  it("puts the most used first and leaves hidden ones out", async () => {
    const { householdId, profileIds, categoryIds } = await seedHousehold();
    await spend(householdId, profileIds[0], categoryIds.Coffee, 3);
    await spend(householdId, profileIds[0], categoryIds.Bills, 1);
    expect((await topCategories(env, householdId)).slice(0, 3).map((c) => c.name)).toEqual(["Coffee", "Bills", "Groceries"]);
    await setCategoryHidden(env, householdId, categoryIds.Coffee, true);
    expect((await topCategories(env, householdId)).map((c) => c.name)).not.toContain("Coffee");
    expect((await listCategories(env, householdId)).map((c) => c.name)).not.toContain("Coffee");
    expect((await listCategories(env, householdId, { includeHidden: true })).map((c) => c.name)).toContain("Coffee");
  });
});

describe("createCategory", () => {
  it("reuses an existing name, case-insensitively, and unhides it", async () => {
    const { householdId, categoryIds } = await seedHousehold();
    await setCategoryHidden(env, householdId, categoryIds.Coffee, true);
    const { cat, created } = (await createCategory(env, householdId, "  coffee ", undefined, Date.now()))!;
    expect(created).toBe(false);
    expect(cat).toMatchObject({ id: categoryIds.Coffee, name: "Coffee", emoji: "☕", hidden: false });
  });

  it("creates a new one at the end with a default emoji", async () => {
    const { householdId } = await seedHousehold();
    const { cat, created } = (await createCategory(env, householdId, "Pets", undefined, Date.now()))!;
    expect(created).toBe(true);
    expect(cat).toMatchObject({ name: "Pets", emoji: "🏷️" });
    expect((await listCategories(env, householdId)).at(-1)?.name).toBe("Pets");
  });

  it("renames, refusing duplicates and other households", async () => {
    const { householdId, categoryIds } = await seedHousehold();
    const other = await seedHousehold();
    expect(await renameCategory(env, householdId, categoryIds.Fun, "Movies", "🎬")).toBe("ok");
    expect(await renameCategory(env, householdId, categoryIds.Fun, "food")).toBe("exists");
    expect(await renameCategory(env, householdId, other.categoryIds.Fun, "Mine")).toBe("not-found");
    expect((await listCategories(env, householdId)).find((c) => c.id === categoryIds.Fun)).toMatchObject({ name: "Movies", emoji: "🎬" });
  });
});

describe("POST /api/categories", () => {
  it("creates and returns the category", async () => {
    const { householdId, profileIds } = await seedHousehold();
    const cookie = await authCookie(householdId, profileIds[0]);
    const send = (body: unknown) =>
      req("/api/categories", { method: "POST", cookie, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const created = await send({ name: "Pets", emoji: "🐶" });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ name: "Pets", emoji: "🐶" });
    const existing = await send({ name: "pets" });
    expect(existing.status).toBe(200);
    expect((await send({ name: "   " })).status).toBe(400);
    expect((await send({ name: "x".repeat(25) })).status).toBe(400);
  });
});

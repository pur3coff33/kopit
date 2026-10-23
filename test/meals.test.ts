import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories } from "../src/db/schema";
import { listCategories } from "../src/lib/categories";
import { db, seedHousehold } from "./helpers";

/** Runs the migration that brought Meals and Family & Others, as it ran on households already on the fixed categories. */
async function migrate() {
  const m = env.TEST_MIGRATIONS.find((x) => x.name.includes("meals"));
  expect(m, "the meals migration").toBeDefined();
  for (const q of m!.queries) await env.DB.prepare(q).run();
}

/** A household as it was before: no Meals, and Household still called that. */
async function before() {
  const h = await seedHousehold();
  await db().delete(categories).where(and(eq(categories.householdId, h.householdId), eq(categories.key, "meals")));
  await db()
    .update(categories)
    .set({ name: "Household", emoji: "🧴" })
    .where(and(eq(categories.householdId, h.householdId), eq(categories.key, "household")));
  await db()
    .update(categories)
    .set({ name: "School" })
    .where(and(eq(categories.householdId, h.householdId), eq(categories.key, "school")));
  return h;
}

describe("Meals and Family & Others for households already on the fixed categories", () => {
  it("adds Meals once and renames Household, keeping its expenses' row", async () => {
    const h = await before();
    const householdId = (await listCategories(env, h.householdId)).find((c) => c.key === "household")!.id;
    await migrate();
    await migrate(); // safe to run again
    const cats = await listCategories(env, h.householdId);
    expect(cats.map((c) => `${c.emoji} ${c.name}`).slice(0, 2)).toEqual(["🛒 Groceries", "🍱 Meals"]);
    expect(cats.filter((c) => c.key === "meals")).toHaveLength(1);
    expect(cats.find((c) => c.key === "household")).toMatchObject({ id: householdId, name: "Family & Others", emoji: "🏠" });
    expect(cats.find((c) => c.key === "school")).toMatchObject({ name: "Work & Education", emoji: "📚" });
  });

  it("brings back a household's own old 'Meals' category instead of clashing with it", async () => {
    const h = await before();
    const [old] = await db()
      .insert(categories)
      .values({ householdId: h.householdId, name: "Meals", emoji: "🏷️", sortOrder: 20, createdAt: 1, movedNote: "Meals" })
      .returning();
    await migrate();
    expect((await listCategories(env, h.householdId)).find((c) => c.key === "meals")).toMatchObject({ id: old.id, name: "Meals", emoji: "🍱" });
  });

  it("leaves Household as it is when the household already has an old row called Family & Others", async () => {
    const h = await before();
    await db().insert(categories).values({ householdId: h.householdId, name: "Family & Others", emoji: "🏷️", sortOrder: 20, createdAt: 1 });
    await migrate(); // doesn't fail on the name clash
    expect((await listCategories(env, h.householdId)).find((c) => c.key === "household")!.name).toBe("Household");
  });
});

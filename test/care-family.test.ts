import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories } from "../src/db/schema";
import { listCategories } from "../src/lib/categories";
import { db, seedHousehold } from "./helpers";

/** Runs the migration that renamed Health and Family & Others, as it ran on households already on the fixed categories. */
async function migrate() {
  const m = env.TEST_MIGRATIONS.find((x) => x.name.includes("care_family"));
  expect(m, "the care_family migration").toBeDefined();
  for (const q of m!.queries) await env.DB.prepare(q).run();
}

/** A household as it was before: Health and Family & Others under their old names. */
async function before() {
  const h = await seedHousehold();
  const set = (key: string, name: string, emoji: string) =>
    db().update(categories).set({ name, emoji }).where(and(eq(categories.householdId, h.householdId), eq(categories.key, key)));
  await set("health", "Health", "💊");
  await set("household", "Family & Others", "🏠");
  return h;
}

describe("Personal care & Health and Family & Relationships for households already on the fixed categories", () => {
  it("renames both, keeping their rows (and so their expenses)", async () => {
    const h = await before();
    const ids = (await listCategories(env, h.householdId)).filter((c) => c.key === "health" || c.key === "household").map((c) => c.id);
    await migrate();
    await migrate(); // safe to run again
    const cats = await listCategories(env, h.householdId);
    expect(cats.find((c) => c.key === "health")).toMatchObject({ id: ids[0], name: "Personal care & Health", emoji: "💊" });
    expect(cats.find((c) => c.key === "household")).toMatchObject({ id: ids[1], name: "Family & Relationships", emoji: "👨‍👩‍👧" });
  });

  it("leaves a category as it is when the household already has an old row with the new name", async () => {
    const h = await before();
    await db().insert(categories).values({ householdId: h.householdId, name: "Family & Relationships", emoji: "🏷️", sortOrder: 20, createdAt: 1 });
    await migrate(); // doesn't fail on the name clash
    const cats = await listCategories(env, h.householdId);
    expect(cats.find((c) => c.key === "household")!.name).toBe("Family & Others");
    expect(cats.find((c) => c.key === "health")!.name).toBe("Personal care & Health");
  });
});

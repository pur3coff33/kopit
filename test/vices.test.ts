import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories } from "../src/db/schema";
import { listCategories } from "../src/lib/categories";
import { db, seedHousehold } from "./helpers";

/** Runs the migration that brought Vices, as it ran on households already on the fixed categories. */
async function migrate() {
  const m = env.TEST_MIGRATIONS.find((x) => x.name.includes("vices"));
  expect(m, "the vices migration").toBeDefined();
  for (const q of m!.queries) await env.DB.prepare(q).run();
}

describe("Vices for households already on the fixed categories", () => {
  it("adds the tile to a household that has the first ten, once", async () => {
    const h = await seedHousehold();
    await db().delete(categories).where(and(eq(categories.householdId, h.householdId), eq(categories.key, "vices")));
    expect((await listCategories(env, h.householdId)).map((c) => c.key)).not.toContain("vices");
    await migrate();
    await migrate(); // safe to run again
    const cats = await listCategories(env, h.householdId);
    expect(cats.map((c) => `${c.emoji} ${c.name}`).at(-1)).toBe("🚬 Vices");
    expect(cats.filter((c) => c.key === "vices")).toHaveLength(1);
  });

  it("brings back a household's own old 'Vices' category instead of clashing with it", async () => {
    const h = await seedHousehold();
    await db().delete(categories).where(and(eq(categories.householdId, h.householdId), eq(categories.key, "vices")));
    const [old] = await db()
      .insert(categories)
      .values({ householdId: h.householdId, name: "Vices", emoji: "🏷️", sortOrder: 20, createdAt: 1, movedNote: "Vices" })
      .returning();
    await migrate();
    const vices = (await listCategories(env, h.householdId)).find((c) => c.key === "vices")!;
    expect(vices).toMatchObject({ id: old.id, name: "Vices", emoji: "🚬" });
  });
});

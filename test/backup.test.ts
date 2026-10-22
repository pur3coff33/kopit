import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dumpToSql, runBackup } from "../src/backup";
import { deleteEntry } from "../src/lib/entries";
import { categories, dayMissions, gardenDays } from "../src/db/schema";
import { hashPin, verifyPin } from "../src/lib/pin";
import { hashPinCore } from "../src/lib/pin-core.js";
// @ts-ignore plain node script module
import { resetSql } from "../scripts/hash-pin-lib.mjs";
import { addEntry, db, seedHousehold } from "./helpers";

const TABLES = ["households", "profiles", "categories", "garden_days", "day_missions", "entries", "deleted_entries"] as const;

async function counts() {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = ((await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>())!).n;
  return out;
}

describe("dumpToSql", () => {
  it("round-trips every table, quotes included", async () => {
    const h = await seedHousehold();
    await db().update(categories).set({ name: "Mom's" }).where(eq(categories.id, h.categoryIds["Gifts & occasions"]));
    await addEntry(h, { amount: 100, at: Date.now(), category: "Gifts & occasions" });
    await addEntry(h, { amount: 250, at: Date.now(), category: null });
    await addEntry(h, { amount: 999, at: Date.now(), category: "Eating out", profile: 1 });
    await deleteEntry(env, h.householdId, await addEntry(h, { amount: 5, at: Date.now(), category: null }));
    // A day kept for good from before the fixed categories, and a day's missions: neither can be rebuilt.
    await db().insert(gardenDays).values({ householdId: h.householdId, day: 20_700, missions: 3, done: 2, doneTypes: "a,b", items: '[{"title":"Skip ☕ Coffee"}]', final: true });
    await db().insert(dayMissions).values({ householdId: h.householdId, day: 20_700, baseline: '{"day":20700}', createdAt: 1 });
    const before = await counts();
    expect(before.garden_days).toBe(1);
    expect(before.deleted_entries).toBe(1);
    const sql = await dumpToSql(env);
    expect(sql.split("\n")[0]).toMatch(/^-- kopit backup \d{4}-\d{2}-\d{2}T/);
    expect(sql).not.toContain("sessions");

    for (const t of [...TABLES].reverse()) await env.DB.prepare(`DELETE FROM ${t}`).run();
    const inserts = sql.split("\n").filter((l) => l.startsWith("INSERT"));
    await env.DB.batch(inserts.map((s) => env.DB.prepare(s)));

    expect(await counts()).toEqual(before);
    const gifts = await env.DB.prepare("SELECT name FROM categories WHERE id = ?").bind(h.categoryIds["Gifts & occasions"]).first<{ name: string }>();
    expect(gifts?.name).toBe("Mom's");
    const nulls = await env.DB.prepare("SELECT count(*) AS n FROM entries WHERE category_id IS NULL").first<{ n: number }>();
    expect(nulls?.n).toBe(1);
  });
});

describe("runBackup", () => {
  it("writes today's dump and keeps only the newest 30", async () => {
    await seedHousehold();
    for (let d = 1; d <= 31; d++) {
      const day = d <= 30 ? `2026-09-${String(d).padStart(2, "0")}` : "2026-10-01";
      await env.BACKUPS.put(`backups/kopit-${day}.sql`, "old");
    }
    const key = await runBackup(env, Date.UTC(2026, 9, 19, 4));
    expect(key).toBe("backups/kopit-2026-10-19.sql");
    const keys = (await env.BACKUPS.list({ prefix: "backups/" })).objects.map((o) => o.key).sort();
    expect(keys).toHaveLength(30);
    expect(keys).not.toContain("backups/kopit-2026-09-01.sql");
    expect(keys).not.toContain("backups/kopit-2026-09-02.sql");
    expect(keys.at(-1)).toBe("backups/kopit-2026-10-19.sql");
    expect(await (await env.BACKUPS.get(key))!.text()).toContain('INSERT INTO "households"');
  });
});

describe("scheduled job", () => {
  it("does nothing when no backup bucket is attached", async () => {
    const worker = (await import("../src/index")).default;
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), { ...env, BACKUPS: undefined }, ctx);
    await waitOnExecutionContext(ctx);
    expect((await env.BACKUPS.list({ prefix: "backups/" })).objects).toHaveLength(0);
  });
});

describe("PIN reset script", () => {
  it("hashes exactly like the app", async () => {
    const { hash, salt } = await hashPin("test-pepper", "123456");
    expect(await hashPinCore("test-pepper", salt, "123456")).toBe(hash);
  });

  it("prints an UPDATE the app accepts", async () => {
    const sql: string = await resetSql("test-pepper", "jon", "246810");
    const m = /pin_hash='([0-9a-f]{64})', pin_salt='([0-9a-f]{32})', failed_attempts=0, locked_until=NULL WHERE username='jon';$/.exec(sql);
    expect(m).not.toBeNull();
    expect(await verifyPin("test-pepper", "246810", m![2], m![1])).toBe(true);
    await expect(resetSql("p", "jon", "12")).rejects.toThrow("6 digits");
    await expect(resetSql("p", "jo'n", "123456")).rejects.toThrow("username");
  });
});

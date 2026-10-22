import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { households } from "../src/db/schema";
import { verifyLogin } from "../src/lib/login";
import { addEntry, authCookie, db, form, html, req, seedHousehold } from "./helpers";

async function setup() {
  const h = await seedHousehold({ username: "jon", pin: "482913" });
  return { h, cookie: await authCookie(h.householdId, h.profileIds[0]) };
}

const TABLES = ["entries", "deleted_entries", "sessions", "garden_days", "day_missions", "categories", "profiles"];

async function rowsOf(householdId: number) {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const r = await env.DB.prepare(`SELECT count(*) AS n FROM ${t} WHERE household_id = ?`).bind(householdId).first<{ n: number }>();
    out[t] = r!.n;
  }
  return out;
}

describe("delete household", () => {
  it("keeps the link last in the garden shed, after logging out", async () => {
    const { cookie } = await setup();
    const body = await html(await req("/settings", { cookie }));
    expect(body.indexOf("/settings/delete")).toBeGreaterThan(body.indexOf("Log out of this phone"));
  });

  it("says what will be erased, and asks for the PIN and DELETE", async () => {
    const { h, cookie } = await setup();
    await addEntry(h, { amount: 1000, at: Date.now() - 60_000, category: "Eating out" });
    const body = await html(await req("/settings/delete", { cookie }));
    expect(body).toContain("Delete the jon household?");
    expect(body).toContain("2 people: Jon, Partner");
    expect(body).toContain("1 expense, with its note");
    expect(body).toContain("This can't be undone in the app.");
    expect(body).toMatch(/name="pin"[^>]*required/);
    expect(body).toMatch(/name="confirm"[^>]*pattern="DELETE"[^>]*required/);
    expect(body).toMatch(/href="\/settings"[^>]*>\s*Keep my household/);
  });

  it("does nothing without DELETE typed, and doesn't use up a PIN try", async () => {
    const { h, cookie } = await setup();
    const res = await req("/settings/delete", { ...form({ pin: "482913", confirm: "delete" }), cookie });
    expect(res.status).toBe(400);
    expect(await html(res)).toContain("Type DELETE in capitals");
    const [row] = await db().select().from(households).where(eq(households.id, h.householdId));
    expect(row.failedAttempts).toBe(0);
  });

  it("does nothing with a wrong PIN, and counts it toward the lockout", async () => {
    const { h, cookie } = await setup();
    const wrong = () => req("/settings/delete", { ...form({ pin: "000000", confirm: "DELETE" }), cookie });
    const res = await wrong();
    expect(res.status).toBe(400);
    expect(await html(res)).toContain("That PIN didn't match");
    for (let i = 0; i < 4; i++) await wrong();
    expect(await html(await req("/settings/delete", { ...form({ pin: "482913", confirm: "DELETE" }), cookie }))).toContain("Too many tries");
    expect(await db().select().from(households).where(eq(households.id, h.householdId))).toHaveLength(1);
  });

  it("erases the household and everything in it, logs out every phone, and leaves others alone", async () => {
    const { h, cookie } = await setup();
    const other = await seedHousehold();
    await addEntry(h, { amount: 1000, at: Date.now() - 2 * 86_400_000, category: "Eating out" });
    await addEntry(other, { amount: 2000, at: Date.now() - 60_000, category: "Eating out" });
    const otherPhone = await authCookie(h.householdId, h.profileIds[1]);
    await req("/spending", { cookie }); // works out the garden, so its tables have rows to erase too
    const before = await rowsOf(h.householdId);
    expect(before.day_missions).toBeGreaterThan(0);

    const res = await req("/settings/delete", { ...form({ pin: "482913", confirm: "DELETE" }), cookie });
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain("Your household was deleted");
    expect(body).toContain('href="/setup"');
    expect(body).toContain("indexedDB.deleteDatabase('kopit')");
    expect(res.headers.get("Set-Cookie")).toMatch(/kopit_session=;/);

    expect(await db().select().from(households).where(eq(households.id, h.householdId))).toHaveLength(0);
    expect(Object.values(await rowsOf(h.householdId)).every((n) => n === 0)).toBe(true);
    for (const c of [cookie, otherPhone]) expect((await req("/spending", { cookie: c })).headers.get("Location")).toBe("/login");
    expect((await rowsOf(other.householdId)).entries).toBe(1);
    expect((await verifyLogin(env, "jon", "482913", Date.now())).ok).toBe(false);
  });
});

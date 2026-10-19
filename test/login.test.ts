import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { households } from "../src/db/schema";
import { normalizeUsername, verifyLogin } from "../src/lib/login";
import { db, seedHousehold } from "./helpers";

const now = Date.UTC(2026, 9, 19, 4);

describe("verifyLogin", () => {
  it("accepts the right PIN", async () => {
    const { householdId } = await seedHousehold({ username: "jon", pin: "482913" });
    expect(await verifyLogin(env, "jon", "482913", now)).toEqual({ ok: true, householdId });
  });
  it("rejects unknown usernames and wrong PINs as invalid", async () => {
    await seedHousehold({ username: "jon", pin: "482913" });
    expect(await verifyLogin(env, "nobody", "482913", now)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyLogin(env, "jon", "000000", now)).toEqual({ ok: false, reason: "invalid" });
  });
  it("resets the counter on success", async () => {
    const { householdId } = await seedHousehold({ username: "jon", pin: "482913" });
    for (let i = 0; i < 4; i++) await verifyLogin(env, "jon", "000000", now);
    expect((await verifyLogin(env, "jon", "482913", now)).ok).toBe(true);
    const [h] = await db().select().from(households).where(eq(households.id, householdId));
    expect(h.failedAttempts).toBe(0);
  });
  it("locks for 15 minutes after 5 failures", async () => {
    await seedHousehold({ username: "jon", pin: "482913" });
    for (let i = 0; i < 4; i++) expect((await verifyLogin(env, "jon", "000000", now)).ok).toBe(false);
    expect(await verifyLogin(env, "jon", "000000", now)).toEqual({ ok: false, reason: "locked", lockedUntil: now + 900_000 });
    expect(await verifyLogin(env, "jon", "482913", now + 899_999)).toEqual({ ok: false, reason: "locked", lockedUntil: now + 900_000 });
    expect((await verifyLogin(env, "jon", "482913", now + 900_000)).ok).toBe(true);
  });
  it("tests at most 5 PINs even when guesses arrive all at once", async () => {
    await seedHousehold({ username: "jon", pin: "482913" });
    const guesses = Array.from({ length: 20 }, (_, i) => String(100000 + i));
    const results = await Promise.all(guesses.map((g) => verifyLogin(env, "jon", g, now)));
    expect(results.filter((r) => !r.ok && r.reason === "invalid").length).toBeLessThanOrEqual(4);
    expect(results.filter((r) => !r.ok && r.reason === "locked").length).toBeGreaterThanOrEqual(16);
    expect((await verifyLogin(env, "jon", "482913", now + 1000)).ok).toBe(false);
  });

  it("normalizes usernames", () => {
    expect(normalizeUsername("  Jon ")).toBe("jon");
    expect(normalizeUsername("ab")).toBeNull();
    expect(normalizeUsername("has space")).toBeNull();
    expect(normalizeUsername("a".repeat(33))).toBeNull();
  });
});

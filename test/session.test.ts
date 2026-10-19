import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sessions } from "../src/db/schema";
import { createSession, deleteSession, lookupSession } from "../src/lib/session";
import { db, seedHousehold } from "./helpers";

describe("sessions", () => {
  it("creates, looks up, expires and deletes", async () => {
    const { householdId } = await seedHousehold();
    const now = Date.UTC(2026, 9, 19);
    const token = await createSession(env, householdId, now);
    expect(await lookupSession(env, token, now + 1000)).toBe(householdId);
    const [row] = await db().select().from(sessions);
    expect(row.tokenHash).not.toBe(token);
    expect(row.expiresAt).toBe(now + 31_536_000_000);
    expect(await lookupSession(env, token, row.expiresAt)).toBeNull();
    await deleteSession(env, token);
    expect(await lookupSession(env, token, now + 1000)).toBeNull();
  });
  it("rejects unknown tokens", async () => {
    expect(await lookupSession(env, "nope", Date.now())).toBeNull();
  });
});

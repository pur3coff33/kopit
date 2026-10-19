import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { households } from "../db/schema";
import type { Env } from "../env";
import { hashPin, verifyPin } from "./pin";

export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;

export type LoginResult =
  | { ok: true; householdId: number }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; lockedUntil: number };

export function normalizeUsername(s: string): string | null {
  const u = s.trim().toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(u) ? u : null;
}

export async function verifyLogin(env: Env, username: string, pin: string, now: number): Promise<LoginResult> {
  const u = normalizeUsername(username);
  const h = u ? await getDb(env).query.households.findFirst({ where: eq(households.username, u) }) : undefined;
  if (!h) {
    await hashPin(env.PIN_PEPPER, pin); // keep timing similar to a real check
    return { ok: false, reason: "invalid" };
  }
  if (h.lockedUntil !== null && now < h.lockedUntil) return { ok: false, reason: "locked", lockedUntil: h.lockedUntil };
  if (await verifyPin(env.PIN_PEPPER, pin, h.pinSalt, h.pinHash)) {
    await recordSuccess(env, h.id);
    return { ok: true, householdId: h.id };
  }
  const lockedUntil = await recordFailure(env, h.id, now);
  return lockedUntil ? { ok: false, reason: "locked", lockedUntil } : { ok: false, reason: "invalid" };
}

/** Counts a failed PIN attempt; returns the lock expiry if this failure triggered a lock. */
export async function recordFailure(env: Env, householdId: number, now: number): Promise<number | null> {
  const [row] = await getDb(env)
    .update(households)
    .set({ failedAttempts: sql`${households.failedAttempts} + 1` })
    .where(eq(households.id, householdId))
    .returning({ failedAttempts: households.failedAttempts });
  if (row.failedAttempts < LOCK_AFTER) return null;
  const lockedUntil = now + LOCK_MS;
  await getDb(env).update(households).set({ failedAttempts: 0, lockedUntil }).where(eq(households.id, householdId));
  return lockedUntil;
}

export async function recordSuccess(env: Env, householdId: number): Promise<void> {
  await getDb(env).update(households).set({ failedAttempts: 0, lockedUntil: null }).where(eq(households.id, householdId));
}

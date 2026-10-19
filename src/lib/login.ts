import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
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

export type Attempt = { ok: true } | { ok: false; lockedUntil: number | null };

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
  const a = await attemptPin(env, h, pin, now);
  if (a.ok) return { ok: true, householdId: h.id };
  return a.lockedUntil ? { ok: false, reason: "locked", lockedUntil: a.lockedUntil } : { ok: false, reason: "invalid" };
}

/**
 * Checks a PIN against the lockout. The attempt is counted atomically *before* the PIN is
 * checked, so parallel guesses can never test more than LOCK_AFTER PINs per lock window.
 * Returns lockedUntil when the household is (now) locked.
 */
export async function attemptPin(
  env: Env,
  h: { id: number; pinSalt: string; pinHash: string },
  pin: string,
  now: number,
): Promise<Attempt> {
  const db = getDb(env);
  const [row] = await db
    .update(households)
    .set({ failedAttempts: sql`${households.failedAttempts} + 1` })
    .where(and(eq(households.id, h.id), or(isNull(households.lockedUntil), lte(households.lockedUntil, now))))
    .returning({ attempts: households.failedAttempts });
  if (!row) {
    const current = await db.query.households.findFirst({ where: eq(households.id, h.id) });
    return { ok: false, lockedUntil: current?.lockedUntil ?? now + LOCK_MS };
  }
  if (row.attempts > LOCK_AFTER) return { ok: false, lockedUntil: await lock(env, h.id, now) };
  if (await verifyPin(env.PIN_PEPPER, pin, h.pinSalt, h.pinHash)) {
    await db.update(households).set({ failedAttempts: 0, lockedUntil: null }).where(eq(households.id, h.id));
    return { ok: true };
  }
  return { ok: false, lockedUntil: row.attempts >= LOCK_AFTER ? await lock(env, h.id, now) : null };
}

async function lock(env: Env, householdId: number, now: number): Promise<number> {
  const lockedUntil = now + LOCK_MS;
  await getDb(env).update(households).set({ failedAttempts: 0, lockedUntil }).where(eq(households.id, householdId));
  return lockedUntil;
}

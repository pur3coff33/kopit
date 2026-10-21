import { count, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, dayMissions, deletedEntries, entries, gardenDays, households, profiles, sessions } from "../db/schema";
import type { Env } from "../env";
import { normalizeUsername } from "./login";
import { hashPin, isValidPin } from "./pin";

export const MAX_HOUSEHOLDS = 15;

export const STARTER_CATEGORIES: ReadonlyArray<{ emoji: string; name: string }> = [
  { emoji: "🛒", name: "Groceries" },
  { emoji: "🍜", name: "Food" },
  { emoji: "🚌", name: "Transport" },
  { emoji: "💡", name: "Bills" },
  { emoji: "🏠", name: "Home" },
  { emoji: "💊", name: "Health" },
  { emoji: "🛍️", name: "Shopping" },
  { emoji: "🎉", name: "Fun" },
  { emoji: "☕", name: "Coffee" },
  { emoji: "📱", name: "Load / Data" },
  { emoji: "🎁", name: "Gifts" },
  { emoji: "✈️", name: "Travel" },
];

export async function isFull(env: Env): Promise<boolean> {
  const [row] = await getDb(env).select({ n: count() }).from(households);
  return row.n >= MAX_HOUSEHOLDS;
}

export async function seedCategories(env: Env, householdId: number, now: number): Promise<void> {
  await getDb(env)
    .insert(categories)
    .values(STARTER_CATEGORIES.map((c, i) => ({ householdId, name: c.name, emoji: c.emoji, sortOrder: i, createdAt: now })));
}

export type CreateResult =
  | { ok: true; householdId: number }
  | { ok: false; reason: "closed" | "taken" | "bad-username" | "bad-pin" | "mismatch" };

export async function createHousehold(
  env: Env,
  input: { username: string; pin: string; pinConfirm: string },
  now: number,
): Promise<CreateResult> {
  if (await isFull(env)) return { ok: false, reason: "closed" };
  const username = normalizeUsername(input.username);
  if (!username) return { ok: false, reason: "bad-username" };
  if (!isValidPin(input.pin)) return { ok: false, reason: "bad-pin" };
  if (input.pin !== input.pinConfirm) return { ok: false, reason: "mismatch" };
  const db = getDb(env);
  if (await db.query.households.findFirst({ where: eq(households.username, username) })) return { ok: false, reason: "taken" };
  const { hash, salt } = await hashPin(env.PIN_PEPPER, input.pin);
  const [h] = await db.insert(households).values({ username, pinHash: hash, pinSalt: salt, createdAt: now }).returning();
  await seedCategories(env, h.id, now);
  return { ok: true, householdId: h.id };
}

/**
 * Erases a household and everything in it, in one transaction: children before parents, so the foreign keys hold.
 * Every phone's login goes with it. Nothing is kept; only the database's own restore history still has it for a while.
 */
export async function deleteHousehold(env: Env, householdId: number): Promise<void> {
  const db = getDb(env);
  await db.batch([
    db.delete(entries).where(eq(entries.householdId, householdId)),
    db.delete(deletedEntries).where(eq(deletedEntries.householdId, householdId)),
    db.delete(sessions).where(eq(sessions.householdId, householdId)),
    db.delete(gardenDays).where(eq(gardenDays.householdId, householdId)),
    db.delete(dayMissions).where(eq(dayMissions.householdId, householdId)),
    db.delete(categories).where(eq(categories.householdId, householdId)),
    db.delete(profiles).where(eq(profiles.householdId, householdId)),
    db.delete(households).where(eq(households.id, householdId)),
  ]);
}

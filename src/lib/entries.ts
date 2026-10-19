import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { deletedEntries, entries } from "../db/schema";
import type { Env } from "../env";

export type NewEntry = {
  id: string;
  profileId: number;
  categoryId: number | null;
  amountCentavos: number;
  note?: string | null;
  spentAt: number;
};

/**
 * Insert-or-ignore on id, so a resent offline save can never overwrite a later edit,
 * and ids that were deleted stay deleted.
 */
export async function insertEntry(env: Env, householdId: number, e: NewEntry, now: number): Promise<"created" | "duplicate"> {
  const db = getDb(env);
  if (await db.query.deletedEntries.findFirst({ where: eq(deletedEntries.id, e.id) })) return "duplicate";
  const result = await db
    .insert(entries)
    .values({ ...e, householdId, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run();
  return result.meta.changes > 0 ? "created" : "duplicate";
}

const scoped = (householdId: number, id: string) => and(eq(entries.id, id), eq(entries.householdId, householdId));

export async function getEntry(env: Env, householdId: number, id: string) {
  return getDb(env).query.entries.findFirst({ where: scoped(householdId, id) });
}

export async function updateEntry(
  env: Env,
  householdId: number,
  id: string,
  patch: { amountCentavos?: number; categoryId?: number | null; note?: string | null; spentAt?: number },
  now: number,
): Promise<boolean> {
  const rows = await getDb(env)
    .update(entries)
    .set({ ...patch, updatedAt: now })
    .where(scoped(householdId, id))
    .returning({ id: entries.id });
  return rows.length > 0;
}

export async function deleteEntry(env: Env, householdId: number, id: string, now = Date.now()): Promise<boolean> {
  const db = getDb(env);
  const rows = await db.delete(entries).where(scoped(householdId, id)).returning({ id: entries.id });
  if (rows.length === 0) return false;
  await db.insert(deletedEntries).values({ id, householdId, deletedAt: now }).onConflictDoNothing();
  return true;
}

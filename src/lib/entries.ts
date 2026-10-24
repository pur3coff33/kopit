import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { deletedEntries, entries } from "../db/schema";
import type { Env } from "../env";
import { forgetNote } from "./daynote";
import { invalidateGarden } from "./garden";

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
  if (result.meta.changes === 0) return "duplicate";
  await changed(env, householdId, e.spentAt);
  return "created";
}

/** An expense on `spentAt` was written or deleted: the garden's results and the day's note it touches are out of date. */
async function changed(env: Env, householdId: number, spentAt: number) {
  await Promise.all([invalidateGarden(env, householdId, spentAt), forgetNote(env, householdId, spentAt)]);
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
  const before = await getEntry(env, householdId, id);
  if (!before) return false;
  const rows = await getDb(env)
    .update(entries)
    .set({ ...patch, updatedAt: now })
    .where(scoped(householdId, id))
    .returning({ spentAt: entries.spentAt });
  if (rows.length === 0) return false;
  await changed(env, householdId, before.spentAt);
  if (rows[0].spentAt !== before.spentAt) await changed(env, householdId, rows[0].spentAt);
  return true;
}

export async function deleteEntry(env: Env, householdId: number, id: string, now = Date.now()): Promise<boolean> {
  const db = getDb(env);
  const rows = await db.delete(entries).where(scoped(householdId, id)).returning({ spentAt: entries.spentAt });
  if (rows.length === 0) return false;
  await changed(env, householdId, rows[0].spentAt);
  await db.insert(deletedEntries).values({ id, householdId, deletedAt: now }).onConflictDoNothing();
  return true;
}

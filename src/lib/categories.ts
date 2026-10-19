import { and, asc, count, desc, eq, max, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, entries } from "../db/schema";
import type { Env } from "../env";

export type Cat = { id: number; name: string; emoji: string; hidden: boolean };

export const DEFAULT_EMOJI = "🏷️";

const pick = { id: categories.id, name: categories.name, emoji: categories.emoji, hidden: categories.hidden };

export function cleanName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, " ");
  return n.length >= 1 && n.length <= 24 ? n : null;
}

function cleanEmoji(emoji: string | undefined): string | null {
  const e = (emoji ?? "").trim();
  return e && e.length <= 8 ? e : null;
}

export async function topCategories(env: Env, householdId: number, limit = 7): Promise<Cat[]> {
  return getDb(env)
    .select(pick)
    .from(categories)
    .leftJoin(entries, eq(entries.categoryId, categories.id))
    .where(and(eq(categories.householdId, householdId), eq(categories.hidden, false)))
    .groupBy(categories.id)
    .orderBy(desc(count(entries.id)), asc(categories.sortOrder))
    .limit(limit);
}

export async function listCategories(env: Env, householdId: number, opts: { includeHidden?: boolean } = {}): Promise<Cat[]> {
  const where = opts.includeHidden
    ? eq(categories.householdId, householdId)
    : and(eq(categories.householdId, householdId), eq(categories.hidden, false));
  return getDb(env).select(pick).from(categories).where(where).orderBy(asc(categories.sortOrder));
}

export async function getCategory(env: Env, householdId: number, id: number): Promise<Cat | undefined> {
  const [cat] = await getDb(env)
    .select(pick)
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)));
  return cat;
}

function findByName(env: Env, householdId: number, name: string) {
  return getDb(env)
    .select(pick)
    .from(categories)
    .where(and(eq(categories.householdId, householdId), sql`lower(${categories.name}) = lower(${name})`));
}

/** Returns null when the name is not 1–24 characters. */
export async function createCategory(
  env: Env,
  householdId: number,
  name: string,
  emoji: string | undefined,
  now: number,
): Promise<{ cat: Cat; created: boolean } | null> {
  const clean = cleanName(name);
  if (!clean) return null;
  const db = getDb(env);
  const [existing] = await findByName(env, householdId, clean);
  if (existing) {
    if (existing.hidden) await db.update(categories).set({ hidden: false }).where(eq(categories.id, existing.id));
    return { cat: { ...existing, hidden: false }, created: false };
  }
  const [{ last }] = await db.select({ last: max(categories.sortOrder) }).from(categories).where(eq(categories.householdId, householdId));
  const [cat] = await db
    .insert(categories)
    .values({ householdId, name: clean, emoji: cleanEmoji(emoji) ?? DEFAULT_EMOJI, sortOrder: (last ?? -1) + 1, createdAt: now })
    .returning(pick);
  return { cat, created: true };
}

export async function renameCategory(
  env: Env,
  householdId: number,
  id: number,
  name: string,
  emoji?: string,
): Promise<"ok" | "exists" | "not-found" | "invalid"> {
  const clean = cleanName(name);
  if (!clean) return "invalid";
  if (!(await getCategory(env, householdId, id))) return "not-found";
  const [clash] = await getDb(env)
    .select(pick)
    .from(categories)
    .where(and(eq(categories.householdId, householdId), sql`lower(${categories.name}) = lower(${clean})`, ne(categories.id, id)));
  if (clash) return "exists";
  const e = cleanEmoji(emoji);
  await getDb(env)
    .update(categories)
    .set(e ? { name: clean, emoji: e } : { name: clean })
    .where(eq(categories.id, id));
  return "ok";
}

/** Returns false when the category is not in this household. */
export async function setCategoryHidden(env: Env, householdId: number, id: number, hidden: boolean): Promise<boolean> {
  const rows = await getDb(env)
    .update(categories)
    .set({ hidden })
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
    .returning({ id: categories.id });
  return rows.length > 0;
}

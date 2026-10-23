// The one-time move of a household from its own old categories to the fixed twelve (categories.ts). It runs on the
// household's first visit after the update (requireSession), once, in one database transaction:
//
//   1. every past day's missions and leaf are kept for good (final garden days), judged on the old categories;
//   2. old rows become the fixed twelve where they match (Food → Eating out, Home → Household, …), the missing ones are
//      added, and the rest retire: Coffee, Load / Data, Travel and a household's own categories;
//   3. expenses in a retired row move to where it went, with its old name as the note if they had none;
//   4. today's missions are drawn again, on the new categories.
//
// Rows are never deleted, so a phone that saved an expense offline with an old id still finds where it went
// (resolveCategory). Every statement checks the household hasn't been switched yet, so two phones opening at once,
// or a second run, change nothing.
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories } from "../db/schema";
import type { Env } from "../env";
import { FIXED, type CategoryKey } from "./categories";
import { freezeResults } from "./garden";
import { dayKey } from "./time";

export type OldRow = { id: number; name: string; emoji: string; sortOrder: number };

/**
 * What each old starter became, and a household's own row named like a fixed one was at first. Anything else that isn't
 * named like one of the fixed ones retires to no category.
 */
const LEGACY: Readonly<Record<string, CategoryKey>> = {
  groceries: "groceries",
  food: "eating-out",
  coffee: "eating-out",
  transport: "transport",
  bills: "bills",
  "load / data": "bills",
  home: "household",
  household: "household",
  school: "school",
  health: "health",
  shopping: "shopping",
  fun: "fun",
  travel: "fun",
  gifts: "gifts",
};
/** Old starters that fold into a broader category keep their name on their expenses, as the note. */
const LEGACY_NOTE: Readonly<Record<string, string>> = { coffee: "Coffee", "load / data": "Mobile load", travel: "Travel" };

const BY_NAME = new Map(FIXED.map((c) => [c.name.toLowerCase(), c]));

/** Which old row becomes each of the ten, which keys are new, and where the rest retire to. Pure. */
export function planSwitch(rows: OldRow[]) {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const target = (r: OldRow) => BY_NAME.get(r.name.toLowerCase())?.key ?? LEGACY[r.name.toLowerCase()] ?? null;
  const note = (r: OldRow) => (target(r) === null ? r.name : (LEGACY_NOTE[r.name.toLowerCase()] ?? null));
  const kept = new Map<CategoryKey, OldRow>();
  for (const c of FIXED) {
    const mine = sorted.filter((r) => target(r) === c.key);
    const pick = mine.find((r) => r.name === c.name) ?? mine.find((r) => r.name.toLowerCase() === c.name.toLowerCase()) ?? mine.find((r) => note(r) === null);
    if (pick) kept.set(c.key, pick);
  }
  const keptIds = new Set([...kept.values()].map((r) => r.id));
  return {
    keep: FIXED.filter((c) => kept.has(c.key))
      .map((c) => ({ id: kept.get(c.key)!.id, key: c.key }))
      .sort((a, b) => a.id - b.id),
    add: FIXED.filter((c) => !kept.has(c.key)).map((c) => c.key),
    retire: sorted.filter((r) => !keptIds.has(r.id)).map((r) => ({ id: r.id, to: target(r), note: note(r) })),
  };
}

/** Moves the household to the fixed twelve, keeping its past days as they were. Safe to run twice, or at once. */
export async function switchCategories(env: Env, householdId: number, createdAt: number, now: number): Promise<void> {
  const rows = await getDb(env)
    .select({ id: categories.id, name: categories.name, emoji: categories.emoji, sortOrder: categories.sortOrder, hidden: categories.hidden })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  // Judged with the categories its missions came from until now: the ones it hadn't hidden.
  const frozen = await freezeResults(env, householdId, createdAt, now, rows.filter((r) => !r.hidden));
  const plan = planSwitch(rows);
  const guard = "EXISTS (SELECT 1 FROM households WHERE id = ? AND categories_set = 1)";
  const db = env.DB;
  const keyId = "(SELECT id FROM categories WHERE household_id = ? AND key = ?)";
  const fixed = new Map(FIXED.map((c, i) => [c.key, { ...c, sortOrder: i }]));
  await db.batch([
    ...frozen.map((f) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO garden_days (household_id, day, missions, done, done_types, items, final)
           SELECT ?, ?, ?, ?, ?, ?, 1 WHERE ${guard}`,
        )
        .bind(householdId, f.day, f.missions, f.done, f.doneTypes.join(","), JSON.stringify(f.items), householdId),
    ),
    ...plan.keep.map((k) => {
      const c = fixed.get(k.key)!;
      return db
        .prepare(`UPDATE categories SET key = ?, name = ?, emoji = ?, sort_order = ?, hidden = 0 WHERE id = ? AND ${guard}`)
        .bind(k.key, c.name, c.emoji, c.sortOrder, k.id, householdId);
    }),
    ...plan.add.map((key) => {
      const c = fixed.get(key)!;
      return db
        .prepare(`INSERT INTO categories (household_id, key, name, emoji, sort_order, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`)
        .bind(householdId, key, c.name, c.emoji, c.sortOrder, now, householdId);
    }),
    ...plan.retire.map((r) =>
      db
        .prepare(`UPDATE categories SET key = NULL, moved_to = ${r.to === null ? "NULL" : keyId}, moved_note = ? WHERE id = ? AND ${guard}`)
        .bind(...(r.to === null ? [] : [householdId, r.to]), r.note, r.id, householdId),
    ),
    ...plan.retire.map((r) =>
      db
        .prepare(
          `UPDATE entries SET category_id = (SELECT moved_to FROM categories WHERE id = ?), note = coalesce(note, ?)
           WHERE household_id = ? AND category_id = ? AND ${guard}`,
        )
        .bind(r.id, r.note, householdId, r.id, householdId),
    ),
    db.prepare(`DELETE FROM day_missions WHERE household_id = ? AND day >= ? AND ${guard}`).bind(householdId, dayKey(now), householdId),
    db.prepare("UPDATE households SET categories_set = 2 WHERE id = ? AND categories_set = 1").bind(householdId),
  ]);
}

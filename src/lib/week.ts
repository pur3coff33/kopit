// A finished week (Monday to Sunday, Manila) of the household, for its recap: what was spent against the week
// before, needs against wants, where it went, and the garden's days. Worked out when asked, like a month's Wrapped.
import { and, count, desc, eq, gte, isNotNull, lt, sql, sum } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, entries } from "../db/schema";
import type { Env } from "../env";
import { WANTS, type CategoryKey } from "./categories";
import { dayResults, isGood, isPerfect } from "./garden";
import { DAY_MS, dayKey, fromDateInput, weekStart } from "./time";

export const WEEK_MS = 7 * DAY_MS;

export type WeekRecap = {
  start: number;
  total: number;
  /** The week before's total; null when nothing was spent then. */
  prevTotal: number | null;
  count: number;
  /** Days of the week with no spending, counting only days the household existed. */
  noSpendDays: number;
  needs: number;
  wants: number;
  /** The three categories that took the most, each with its most used notes (up to two). */
  top: Array<{ key: CategoryKey; name: string; emoji: string; total: number; notes: string[] }>;
  /** Monday to Sunday. */
  days: Array<"perfect" | "good" | "none">;
  goodDays: number;
  perfectDays: number;
  missionsDone: number;
};

/** The Monday "YYYY-MM-DD" names, if it starts a week that's over and ended after the household began. */
export function finishedWeek(raw: string, createdAt: number, now: number): number | null {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? fromDateInput(raw) : null;
  if (start === null || weekStart(start) !== start) return null;
  if (start + WEEK_MS > weekStart(now) || start + WEEK_MS <= createdAt) return null;
  return start;
}

export async function weekRecap(env: Env, householdId: number, start: number, createdAt: number, now: number): Promise<WeekRecap> {
  const db = getDb(env);
  const end = start + WEEK_MS;
  const inWeek = and(eq(entries.householdId, householdId), gte(entries.spentAt, start), lt(entries.spentAt, end));
  const dayOf = sql<number>`(${entries.spentAt} + 28800000) / 86400000`;
  const [[prev], [all], spendDays, byCategory, results] = await Promise.all([
    db
      .select({ total: sum(entries.amountCentavos), n: count() })
      .from(entries)
      .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, start - WEEK_MS), lt(entries.spentAt, start))),
    db.select({ total: sum(entries.amountCentavos), n: count() }).from(entries).where(inWeek),
    db.selectDistinct({ day: dayOf }).from(entries).where(inWeek),
    db
      .select({ id: categories.id, key: categories.key, name: categories.name, emoji: categories.emoji, total: sum(entries.amountCentavos) })
      .from(entries)
      .innerJoin(categories, eq(categories.id, entries.categoryId))
      .where(and(inWeek, isNotNull(categories.key)))
      .groupBy(categories.id)
      .orderBy(desc(sum(entries.amountCentavos))),
    dayResults(env, householdId, createdAt, dayKey(start), dayKey(end), now),
  ]);
  const cats = byCategory.map((c) => ({ ...c, key: c.key as CategoryKey, total: Number(c.total ?? 0) }));
  const top = await Promise.all(
    cats.slice(0, 3).map(async (c) => {
      const notes = await db
        .select({ note: sql<string>`min(${entries.note})` })
        .from(entries)
        .where(and(inWeek, eq(entries.categoryId, c.id), isNotNull(entries.note)))
        .groupBy(sql`lower(${entries.note})`)
        .orderBy(desc(count()), desc(sql`max(${entries.spentAt})`))
        .limit(2);
      return { key: c.key, name: c.name, emoji: c.emoji, total: c.total, notes: notes.map((n) => n.note) };
    }),
  );
  const days: WeekRecap["days"] = [];
  let missionsDone = 0;
  for (let d = dayKey(start); d < dayKey(end); d++) {
    const r = results.get(d);
    days.push(r && isPerfect(r) ? "perfect" : r && isGood(r) ? "good" : "none");
    missionsDone += r?.done ?? 0;
  }
  const lived = Math.min(7, dayKey(end) - Math.max(dayKey(start), dayKey(createdAt)));
  return {
    start,
    total: Number(all?.total ?? 0),
    prevTotal: (prev?.n ?? 0) > 0 ? Number(prev.total ?? 0) : null,
    count: all?.n ?? 0,
    noSpendDays: Math.max(0, lived - spendDays.length),
    needs: cats.filter((c) => !WANTS.has(c.key)).reduce((s, c) => s + c.total, 0),
    wants: cats.filter((c) => WANTS.has(c.key)).reduce((s, c) => s + c.total, 0),
    top,
    days,
    goodDays: days.filter((d) => d !== "none").length,
    perfectDays: days.filter((d) => d === "perfect").length,
    missionsDone,
  };
}

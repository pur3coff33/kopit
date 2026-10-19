import { and, eq, gte, isNull, lt, sum } from "drizzle-orm";
import { getDb } from "../db/client";
import { entries } from "../db/schema";
import type { Env } from "../env";
import { DAY_MS, weekStart } from "./time";

/** Whole household's spend in one category (null = uncategorized) for the current Manila week. */
export async function weekCategoryTotal(env: Env, householdId: number, categoryId: number | null, now: number): Promise<number> {
  const start = weekStart(now);
  const [row] = await getDb(env)
    .select({ total: sum(entries.amountCentavos) })
    .from(entries)
    .where(
      and(
        eq(entries.householdId, householdId),
        categoryId === null ? isNull(entries.categoryId) : eq(entries.categoryId, categoryId),
        gte(entries.spentAt, start),
        lt(entries.spentAt, start + 7 * DAY_MS),
      ),
    );
  return Number(row.total ?? 0);
}

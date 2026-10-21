import { and, count, desc, eq, gte, isNull, lt, sql, sum, type SQL } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, entries } from "../db/schema";
import type { Env } from "../env";
import { formatPeso } from "./money";
import { DAY_MS, addMonths, dayStart, monthStart, weekStart, type RangeKind } from "./time";

export type Filter = { householdId: number; profileId: number | null; start: number; end: number };

function where(householdId: number, profileId: number | null, start: number, end: number, ...extra: SQL[]) {
  return and(
    eq(entries.householdId, householdId),
    profileId === null ? undefined : eq(entries.profileId, profileId),
    gte(entries.spentAt, start),
    lt(entries.spentAt, end),
    ...extra,
  );
}

async function total(env: Env, householdId: number, profileId: number | null, start: number, end: number, ...extra: SQL[]) {
  const [row] = await getDb(env)
    .select({ total: sum(entries.amountCentavos), n: count() })
    .from(entries)
    .where(where(householdId, profileId, start, end, ...extra));
  return { total: Number(row.total ?? 0), count: row.n };
}

/** Whole household's spend in one category (null = uncategorized) for the current Manila week. */
export async function weekCategoryTotal(env: Env, householdId: number, categoryId: number | null, now: number): Promise<number> {
  const start = weekStart(now);
  const cat = categoryId === null ? isNull(entries.categoryId) : eq(entries.categoryId, categoryId);
  return (await total(env, householdId, null, start, start + 7 * DAY_MS, cat)).total;
}

export type BreakdownRow = { categoryId: number | null; name: string; emoji: string; amount: number; count: number };

export async function breakdown(env: Env, f: Filter): Promise<{ total: number; count: number; rows: BreakdownRow[] }> {
  const amount = sum(entries.amountCentavos);
  const rows = await getDb(env)
    .select({ categoryId: entries.categoryId, name: categories.name, emoji: categories.emoji, amount, count: count() })
    .from(entries)
    .leftJoin(categories, eq(categories.id, entries.categoryId))
    .where(where(f.householdId, f.profileId, f.start, f.end))
    .groupBy(entries.categoryId)
    .orderBy(desc(amount));
  const out = rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.categoryId === null ? "Uncategorized" : (r.name ?? "?"),
    emoji: r.categoryId === null ? "·" : (r.emoji ?? "·"),
    amount: Number(r.amount ?? 0),
    count: r.count,
  }));
  return { total: out.reduce((s, r) => s + r.amount, 0), count: out.reduce((s, r) => s + r.count, 0), rows: out };
}

/** This month so far vs last month up to the same point (clamped to last month's end). Null if last month is empty. */
export async function pace(env: Env, householdId: number, profileId: number | null, now: number): Promise<{ diff: number } | null> {
  const thisStart = monthStart(now);
  const prevStart = addMonths(now, -1);
  const lastEnd = Math.min(prevStart + (now - thisStart), thisStart);
  // All three at once: each query is a round trip to the database.
  const [lastWhole, thisSoFar, lastSoFar] = await Promise.all([
    total(env, householdId, profileId, prevStart, thisStart),
    total(env, householdId, profileId, thisStart, now),
    total(env, householdId, profileId, prevStart, lastEnd),
  ]);
  if (lastWhole.count === 0) return null;
  return { diff: thisSoFar.total - lastSoFar.total };
}

export function paceText(diff: number): string {
  if (diff < 0) return `🌱 ${formatPeso(-diff)} less than this time last month`;
  if (diff > 0) return `${formatPeso(diff)} more than this time last month`;
  return "Same as this time last month";
}

/** Fully elapsed Manila days in the range (and since the household began) with no expenses. */
export async function noSpendDays(env: Env, f: Filter, householdCreatedAt: number, now: number): Promise<number> {
  const from = Math.max(f.start, dayStart(householdCreatedAt));
  const to = Math.min(f.end, dayStart(now));
  if (to <= from) return 0;
  const [row] = await getDb(env)
    .select({ days: sql<number>`count(distinct (${entries.spentAt} + 28800000) / 86400000)` })
    .from(entries)
    .where(where(f.householdId, f.profileId, from, to));
  return Math.round((to - from) / DAY_MS) - Number(row.days);
}

export function noSpendText(n: number, kind: RangeKind): string | null {
  if (n === 0) return null;
  const when = kind === "this" ? "this month" : kind === "last" ? "last month" : "in this range";
  return `${n} no-spend day${n === 1 ? "" : "s"} ${when}`;
}

/** Total spent in a range (same filter as the breakdown). */
export async function rangeTotal(env: Env, f: Filter): Promise<number> {
  return (await total(env, f.householdId, f.profileId, f.start, f.end)).total;
}

const categoryIs = (categoryId: number | null) => (categoryId === null ? isNull(entries.categoryId) : eq(entries.categoryId, categoryId));

/** One category per Manila week (Monday start) across the range up to now: the newest 6 weeks, oldest first, empty ones included. */
export async function weeklyTotals(env: Env, f: Filter, categoryId: number | null, now: number): Promise<Array<{ start: number; total: number }>> {
  const end = Math.min(f.end, now);
  if (end <= f.start) return [];
  const day = sql<number>`(${entries.spentAt} + 28800000) / 86400000`;
  const rows = await getDb(env)
    .select({ day, total: sum(entries.amountCentavos) })
    .from(entries)
    .where(where(f.householdId, f.profileId, f.start, end, categoryIs(categoryId)))
    .groupBy(day);
  const weeks = new Map<number, number>();
  for (let w = weekStart(f.start); w < end; w += 7 * DAY_MS) weeks.set(w, 0);
  for (const r of rows) {
    const w = weekStart(Number(r.day) * DAY_MS);
    weeks.set(w, (weeks.get(w) ?? 0) + Number(r.total ?? 0));
  }
  return [...weeks].map(([start, t]) => ({ start, total: t })).slice(-6);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `pace` for one category: this month so far against last month up to the same point. Null if last month had none. */
export async function categoryPace(
  env: Env,
  householdId: number,
  profileId: number | null,
  categoryId: number | null,
  now: number,
): Promise<{ diff: number; prevMonth: string } | null> {
  const thisStart = monthStart(now);
  const prevStart = addMonths(now, -1);
  const lastEnd = Math.min(prevStart + (now - thisStart), thisStart);
  const cat = categoryIs(categoryId);
  const [lastWhole, thisSoFar, lastSoFar] = await Promise.all([
    total(env, householdId, profileId, prevStart, thisStart, cat),
    total(env, householdId, profileId, thisStart, now, cat),
    total(env, householdId, profileId, prevStart, lastEnd, cat),
  ]);
  if (lastWhole.count === 0) return null;
  const prevMonth = SHORT_MONTHS[new Date(prevStart + 8 * 3_600_000).getUTCMonth()];
  return { diff: thisSoFar.total - lastSoFar.total, prevMonth };
}

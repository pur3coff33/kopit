// The money garden. Every day the household gets 3–5 "spend less" missions (missions.ts); a day with at least half
// of them done grows a leaf, a day with all done adds a small flower, and a month that ends lower than the one before
// blooms on top. Always the whole household's, whatever person filter a screen has on.
//
// A day's missions are fixed the first time they're needed (day_missions, see frozenBaselines). Finished days'
// results are cached in garden_days (working one out means reading up to 28 earlier days of expenses); today is
// always judged live.
import { and, count, eq, gte, inArray, lt, sql, sum } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories, entries, gardenDays } from "../db/schema";
import type { Env } from "../env";
import { TYPE_NAMES, baseline, judgeDay, missionsFor, type Baseline, type CatInfo, type DayExpense, type DayFacts } from "./missions";
import { DAY_MS, MANILA_OFFSET_MS, addMonths, dayKey, dayStart, monthStart, toDateInput, type Range } from "./time";

export const MONTH_NAMES: readonly string[] = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];

/** Month name of the Manila date `ms` falls on. */
export function monthName(ms: number): string {
  return MONTH_NAMES[Number(toDateInput(ms).slice(5, 7)) - 1];
}

const BASELINE_DAYS = 28;
/** New days worked out per request at most (about a month: a few ms of CPU), so a long history fills in over a few visits. */
const MAX_NEW_DAYS = 31;
/** How long after an expense write a day's result isn't cached yet (covers a write racing the calculation). */
const SETTLE_MS = 60_000;

export type DayResult = { missions: number; done: number; doneTypes: string[] };
export const isGood = (r: DayResult) => r.missions > 0 && r.done * 2 >= r.missions;
export const isPerfect = (r: DayResult) => r.missions > 0 && r.done === r.missions;

const startOf = (day: number) => day * DAY_MS - MANILA_OFFSET_MS;

async function expensesBetween(env: Env, householdId: number, fromDay: number, toDay: number): Promise<DayExpense[]> {
  return getDb(env)
    .select({ amount: entries.amountCentavos, categoryId: entries.categoryId, profileId: entries.profileId, spentAt: entries.spentAt })
    .from(entries)
    .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, startOf(fromDay)), lt(entries.spentAt, startOf(toDay))));
}

async function visibleCats(env: Env, householdId: number): Promise<CatInfo[]> {
  return getDb(env)
    .select({ id: categories.id, name: categories.name, emoji: categories.emoji })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.hidden, false)));
}

/** Expenses sorted into Manila days once, so each day reads only its own 28 days instead of the whole span. */
function byDay(all: DayExpense[]): (day: number) => DayExpense[] {
  const days = new Map<number, DayExpense[]>();
  for (const e of all) {
    const d = dayKey(e.spentAt);
    const list = days.get(d);
    if (list) list.push(e);
    else days.set(d, [e]);
  }
  return (day) => days.get(day) ?? [];
}

function factsOn(on: (day: number) => DayExpense[], day: number): DayFacts {
  return { expenses: on(day), yesterday: on(day - 1), lastWeek: on(day - 7) };
}

function historyBefore(on: (day: number) => DayExpense[], day: number): DayExpense[] {
  const out: DayExpense[] = [];
  for (let k = 1; k <= BASELINE_DAYS; k++) out.push(...on(day - k));
  return out;
}

/**
 * Each of `days`' baseline (what its missions are drawn from), fixed the first time it's needed: normally the
 * household's first open that day. `make` works out the ones not stored yet. Two phones opening at once both keep
 * whichever copy was stored first: the inserts are INSERT OR IGNORE, read back in the same transaction.
 */
export async function frozenBaselines(env: Env, householdId: number, days: number[], make: (day: number) => Baseline) {
  const out = new Map<number, Baseline>();
  if (days.length === 0) return out;
  const wanted = new Set(days);
  const read = env.DB.prepare("SELECT day, baseline FROM day_missions WHERE household_id = ? AND day >= ? AND day <= ?").bind(
    householdId,
    Math.min(...days),
    Math.max(...days),
  );
  const keep = (rows: { day: number; baseline: string }[]) => {
    for (const r of rows) if (wanted.has(r.day)) out.set(r.day, JSON.parse(r.baseline) as Baseline);
  };
  keep((await read.all<{ day: number; baseline: string }>()).results);
  const missing = days.filter((d) => !out.has(d));
  if (missing.length === 0) return out;
  const put = env.DB.prepare("INSERT OR IGNORE INTO day_missions (household_id, day, baseline, created_at) VALUES (?, ?, ?, ?)");
  const createdAt = Date.now();
  const results = await env.DB.batch<{ day: number; baseline: string }>([
    ...missing.map((d) => put.bind(householdId, d, JSON.stringify(make(d)), createdAt)),
    read,
  ]);
  keep(results[results.length - 1].results);
  return out;
}

/** The fixed baselines for `days`, working out any not stored yet from `on` (expenses by day) and `cats`. */
function baselinesFor(env: Env, householdId: number, days: number[], on: (day: number) => DayExpense[], cats: CatInfo[]) {
  return frozenBaselines(env, householdId, days, (day) => baseline(historyBefore(on, day), day, cats));
}

/** How each of `days` went on its fixed missions. Pure. */
export function judgeDays(householdId: number, days: number[], on: (day: number) => DayExpense[], baselines: Map<number, Baseline>) {
  const out = new Map<number, DayResult>();
  for (const day of days) out.set(day, judgeDay(missionsFor(householdId, day, baselines.get(day)!), factsOn(on, day)));
  return out;
}

/**
 * How each finished day in [fromDay, toDay) went, from the household's first day up to yesterday. Cached days are
 * read; up to 31 missing ones (newest first) are worked out and stored; any left over are missing from the result.
 */
export async function dayResults(env: Env, householdId: number, createdAt: number, fromDay: number, toDay: number, now: number) {
  const out = new Map<number, DayResult>();
  const lo = Math.max(fromDay, dayKey(createdAt));
  const hi = Math.min(toDay, dayKey(now));
  if (lo >= hi) return out;
  const db = getDb(env);
  const rows = await db
    .select()
    .from(gardenDays)
    .where(and(eq(gardenDays.householdId, householdId), gte(gardenDays.day, lo), lt(gardenDays.day, hi)));
  for (const r of rows) out.set(r.day, { missions: r.missions, done: r.done, doneTypes: r.doneTypes ? r.doneTypes.split(",") : [] });

  const missing: number[] = [];
  for (let d = hi - 1; d >= lo && missing.length < MAX_NEW_DAYS; d--) if (!out.has(d)) missing.push(d);
  if (missing.length === 0) return out;

  const first = Math.min(...missing);
  const last = Math.max(...missing);
  const [all, cats] = await Promise.all([expensesBetween(env, householdId, first - BASELINE_DAYS, last + 1), visibleCats(env, householdId)]);
  const on = byDay(all);
  const judged = judgeDays(householdId, missing, on, await baselinesFor(env, householdId, missing, on, cats));
  const fresh = missing.map((day) => {
    const r = judged.get(day)!;
    out.set(day, r);
    return { householdId, day, missions: r.missions, done: r.done, doneTypes: r.doneTypes.join(",") };
  });
  // Keep them, unless an expense was written or deleted just now: it may have landed between reading the expenses and
  // this write, and a day cached from the old data would never be cleared again. Each insert checks that itself, in
  // the same transaction, so nothing can slip in between; skipped days are simply worked out again next time.
  const settled = Date.now() - SETTLE_MS;
  const keep = env.DB.prepare(
    `INSERT OR IGNORE INTO garden_days (household_id, day, missions, done, done_types)
     SELECT ?1, ?2, ?3, ?4, ?5
     WHERE NOT EXISTS (SELECT 1 FROM entries WHERE household_id = ?1 AND updated_at >= ?6)
       AND NOT EXISTS (SELECT 1 FROM deleted_entries WHERE household_id = ?1 AND deleted_at >= ?6)`,
  );
  await env.DB.batch(fresh.map((r) => keep.bind(r.householdId, r.day, r.missions, r.done, r.doneTypes, settled)));
  return out;
}

/**
 * An expense on `spentAt` changed: forget that day's result and the two that compare with it ("less than yesterday"
 * the day after, "less than last week" a week later). Missions themselves are fixed, so no other day can change.
 */
export async function invalidateGarden(env: Env, householdId: number, spentAt: number): Promise<void> {
  const d = dayKey(spentAt);
  await getDb(env)
    .delete(gardenDays)
    .where(and(eq(gardenDays.householdId, householdId), inArray(gardenDays.day, [d, d + 1, d + 7])));
}

export type MonthGarden = {
  start: number;
  end: number;
  total: number;
  prevTotal: number | null;
  goodDays: number;
  perfectDays: number;
  missionsDone: number;
  bloomed: boolean;
  /** The mission type met most often this month, how often, and its friendly name. */
  topType: string | null;
  topCount: number;
  topTitle: string | null;
};

const monthKey = (ms: number) => toDateInput(ms).slice(0, 7);

/** Month gardens for the given month starts: one grouped totals query and one day-results lookup for all of them. */
async function buildMonths(env: Env, householdId: number, createdAt: number, now: number, starts: number[]): Promise<MonthGarden[]> {
  if (starts.length === 0) return [];
  const from = addMonths(starts[0], -1); // the month before the first, for its bloom
  const to = addMonths(starts[starts.length - 1], 1);
  const month = sql<string>`strftime('%Y-%m', (${entries.spentAt} + 28800000) / 1000, 'unixepoch')`;
  const [totals, days] = await Promise.all([
    getDb(env)
      .select({ month, total: sum(entries.amountCentavos), n: count() })
      .from(entries)
      .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, from), lt(entries.spentAt, to)))
      .groupBy(month),
    dayResults(env, householdId, createdAt, dayKey(starts[0]), dayKey(to), now),
  ]);
  const byMonth = new Map(totals.map((t) => [t.month, { total: Number(t.total ?? 0), n: t.n }]));
  return starts.map((start) => {
    const end = addMonths(start, 1);
    const mine = byMonth.get(monthKey(start));
    const prev = byMonth.get(monthKey(addMonths(start, -1)));
    const prevTotal = prev && prev.n > 0 ? prev.total : null;
    const total = mine?.total ?? 0;
    let goodDays = 0;
    let perfectDays = 0;
    let missionsDone = 0;
    const typeCounts = new Map<string, number>();
    for (let d = dayKey(start); d < dayKey(end); d++) {
      const r = days.get(d);
      if (!r) continue;
      if (isGood(r)) goodDays++;
      if (isPerfect(r)) perfectDays++;
      missionsDone += r.done;
      for (const t of r.doneTypes) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    const [topType, topCount] = [...typeCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null, 0];
    return {
      start,
      end,
      total,
      prevTotal,
      goodDays,
      perfectDays,
      missionsDone,
      bloomed: end <= now && prevTotal !== null && total < prevTotal,
      topType,
      topCount,
      topTitle: topType ? (TYPE_NAMES[topType] ?? null) : null,
    };
  });
}

/** One month of the household's garden. `start` is the Manila start of the month. */
export async function monthGarden(env: Env, householdId: number, start: number, createdAt: number, now: number): Promise<MonthGarden> {
  return (await buildMonths(env, householdId, createdAt, now, [start]))[0];
}

/** Every month since the household began, oldest first, this month (still growing) last. */
export async function gardenMonths(env: Env, householdId: number, createdAt: number, now: number): Promise<MonthGarden[]> {
  const starts: number[] = [];
  for (let m = monthStart(createdAt); m <= monthStart(now); m = addMonths(m, 1)) starts.push(m);
  return buildMonths(env, householdId, createdAt, now, starts);
}

/** Good and perfect days in [start, end), as far as they're known (finished days only). */
export async function rangeDays(env: Env, householdId: number, createdAt: number, start: number, end: number, now: number) {
  const days = await dayResults(env, householdId, createdAt, dayKey(start), dayKey(end), now);
  let goodDays = 0;
  let perfectDays = 0;
  for (const r of days.values()) {
    if (isGood(r)) goodDays++;
    if (isPerfect(r)) perfectDays++;
  }
  return { goodDays, perfectDays };
}

/** The month's start when `range` is exactly one calendar month that has already ended; otherwise null. */
export function wholePastMonth(range: Range, now: number): number | null {
  const whole = range.start === monthStart(range.start) && range.end === addMonths(range.start, 1);
  return whole && range.end <= now ? range.start : null;
}

export type TodayMission = { title: string; level: 1 | 2; status: "track" | "missed"; note: string };

/** Today's missions, judged live: on track while still met, "not today" once broken (more spending can't undo that). */
export async function todayMissions(env: Env, householdId: number, now: number) {
  const today = dayKey(now);
  const [all, cats] = await Promise.all([expensesBetween(env, householdId, today - BASELINE_DAYS, today + 1), visibleCats(env, householdId)]);
  const on = byDay(all);
  const facts = factsOn(on, today);
  const fixed = (await baselinesFor(env, householdId, [today], on, cats)).get(today)!;
  const items: TodayMission[] = missionsFor(householdId, today, fixed).map((m) => {
    const r = m.check(facts);
    return { title: m.title, level: m.level, status: r.ok ? "track" : "missed", note: r.note };
  });
  return { today: toDateInput(now), items, onTrack: items.filter((m) => m.status === "track").length };
}

export type TodayGarden = {
  today: string;
  /** Yesterday's date when it was a good day (it grew a leaf); null otherwise. */
  leafDay: string | null;
  leafDone: number;
  leafMissions: number;
  perfect: boolean;
  /** Good days in yesterday's month up to and including yesterday. */
  leafNumber: number;
  leafMonth: string;
  leafMonthIsCurrent: boolean;
  /** "YYYY-MM" of last month when its Wrapped is due: it ended after the household began and had expenses. */
  wrappedMonth: string | null;
};

/** What the add screen needs: yesterday's leaf, and whether last month's Wrapped is due. */
export async function todayGarden(env: Env, householdId: number, createdAt: number, now: number): Promise<TodayGarden> {
  const today = dayKey(now);
  const yesterdayMs = dayStart(now) - DAY_MS;
  const monthOfYesterday = monthStart(yesterdayMs);
  const lastMonth = addMonths(now, -1);
  const [days, lastMonthCount] = await Promise.all([
    dayResults(env, householdId, createdAt, dayKey(monthOfYesterday), today, now),
    getDb(env)
      .select({ n: count() })
      .from(entries)
      .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, lastMonth), lt(entries.spentAt, monthStart(now)))),
  ]);
  const y = days.get(today - 1);
  const good = !!y && isGood(y);
  let leafNumber = 0;
  if (good) for (const r of days.values()) if (isGood(r)) leafNumber++;
  return {
    today: toDateInput(now),
    leafDay: good ? toDateInput(yesterdayMs) : null,
    leafDone: y?.done ?? 0,
    leafMissions: y?.missions ?? 0,
    perfect: !!y && isPerfect(y),
    leafNumber,
    leafMonth: monthName(yesterdayMs),
    leafMonthIsCurrent: monthOfYesterday === monthStart(now),
    wrappedMonth: monthStart(now) > createdAt && (lastMonthCount[0]?.n ?? 0) > 0 ? monthKey(lastMonth) : null,
  };
}

/** Said in place of a worse number when a month went up. Never a scolding, never the number. */
const AFFIRMATIONS: ReadonlyArray<(next: string) => string> = [
  (next) => `Every peso you logged counts. ${next}'s garden starts today 🌱`,
  () => "Noticing is the first step. You kept watching where it went 🌿",
  (next) => `Some months cost more. ${next} is a fresh patch of soil 🌱`,
  () => "Your garden kept growing, one good day at a time 🍃",
  (next) => `Logging it all is the hard part, and you did it. On to ${next} 🌼`,
];

/** The affirmation for a month that didn't come in lower, picked by the month so it stays the same on replay. */
export function affirmation(monthStartMs: number): string {
  const [y, m] = toDateInput(monthStartMs).split("-").map(Number);
  return AFFIRMATIONS[(y * 12 + m) % AFFIRMATIONS.length](monthName(addMonths(monthStartMs, 1)));
}

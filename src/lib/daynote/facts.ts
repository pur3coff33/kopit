// Everything a note may say about a day, worked out by kop.it itself. The AI never does a sum: it's handed these.
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../../db/client";
import { categories, entries, profiles } from "../../db/schema";
import type { Env } from "../../env";
import { FIXED, type CategoryKey, type Group } from "../categories";
import { missionDays } from "../garden";
import { DAY_MS, MANILA_OFFSET_MS, clockTime, dayKey, weekStart } from "../time";

/**
 * The average Filipino family's spending in a day: ₱258,050 a year (PSA, 2023 Family Income and Expenditure Survey,
 * preliminary results released Aug 2024) over 365 days. In centavos.
 */
export const PH_FAMILY_DAY = 70_700;

/** Days of history a usual day is the average of. */
const USUAL_DAYS = 28;
/** Fewer days of history than this and there's no usual day yet: too few to call anything usual. */
const MIN_USUAL_DAYS = 7;

export type NoteFacts = {
  /** "Wednesday, October 21" */
  date: string;
  /** "Thursday" */
  next: string;
  total: number;
  needs: number;
  wants: number;
  /** Expenses without a category. */
  other: number;
  usual: number | null;
  items: Array<{ what: string; category: string | null; group: Group | null; who: string; amount: number; time: string }>;
  /** Each category the day had: its usual day, and the week so far (Monday up to and including this day). */
  cats: Array<{
    key: CategoryKey;
    name: string;
    emoji: string;
    group: Group;
    amount: number;
    usual: number | null;
    daysThisWeek: number;
    week: number;
  }>;
  missions: { met: string[]; missed: string[] } | null;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** When Manila day `day` starts (ms). */
export const startOf = (day: number) => day * DAY_MS - MANILA_OFFSET_MS;
const groupOf = (key: string | null): Group | null => FIXED.find((f) => f.key === (key as CategoryKey))?.group ?? null;

function longDate(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** A want that ran at least twice its usual day (and ₱100 over it): one the note should point out. */
export const ranHigh = (c: NoteFacts["cats"][number]) => c.group === "want" && c.usual !== null && c.amount >= 2 * c.usual && c.amount - c.usual >= 10_000;

/** Everything the note may say about `day`; null when nothing was spent that day. */
export async function noteFacts(env: Env, householdId: number, createdAt: number, day: number, now: number): Promise<NoteFacts | null> {
  const db = getDb(env);
  const firstDay = Math.max(day - USUAL_DAYS, dayKey(createdAt));
  const historyDays = day - firstDay;
  const weekFirst = dayKey(weekStart(startOf(day)));
  const [rows, past, missions] = await Promise.all([
    // The day's own expenses, with who and what.
    db
      .select({
        amount: entries.amountCentavos,
        note: entries.note,
        spentAt: entries.spentAt,
        who: profiles.name,
        categoryId: entries.categoryId,
        key: categories.key,
        name: categories.name,
        emoji: categories.emoji,
      })
      .from(entries)
      .innerJoin(profiles, eq(profiles.id, entries.profileId))
      .leftJoin(categories, eq(categories.id, entries.categoryId))
      .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, startOf(day)), lt(entries.spentAt, startOf(day + 1))))
      .orderBy(asc(entries.spentAt)),
    // Before it: the 4 weeks a usual day is drawn from, and the week so far.
    db
      .select({ amount: entries.amountCentavos, spentAt: entries.spentAt, categoryId: entries.categoryId })
      .from(entries)
      .where(and(eq(entries.householdId, householdId), gte(entries.spentAt, startOf(Math.min(firstDay, weekFirst))), lt(entries.spentAt, startOf(day)))),
    missionDays(env, householdId, createdAt, [day], now),
  ]);
  if (rows.length === 0) return null;

  const inWindow = past.filter((e) => dayKey(e.spentAt) >= firstDay);
  const avg = (sum: number) => (historyDays >= MIN_USUAL_DAYS ? Math.round(sum / historyDays) : null);
  const sumOf = (g: Group | null) => rows.filter((r) => groupOf(r.key) === g).reduce((s, r) => s + r.amount, 0);

  const cats = new Map<number, NoteFacts["cats"][number]>();
  for (const r of rows) {
    const group = groupOf(r.key);
    if (r.categoryId === null || !group) continue;
    const known = cats.get(r.categoryId);
    if (known) {
      known.amount += r.amount;
      known.week += r.amount;
      continue;
    }
    const thisWeek = past.filter((e) => e.categoryId === r.categoryId && dayKey(e.spentAt) >= weekFirst);
    const before = inWindow.filter((e) => e.categoryId === r.categoryId).reduce((s, e) => s + e.amount, 0);
    cats.set(r.categoryId, {
      key: r.key as CategoryKey,
      name: r.name!,
      emoji: r.emoji!,
      group,
      amount: r.amount,
      usual: avg(before),
      daysThisWeek: new Set(thisWeek.map((e) => dayKey(e.spentAt))).size + 1,
      week: thisWeek.reduce((s, e) => s + e.amount, 0) + r.amount,
    });
  }

  const m = missions.get(day);
  return {
    date: longDate(day),
    next: WEEKDAYS[new Date((day + 1) * DAY_MS).getUTCDay()],
    total: rows.reduce((s, r) => s + r.amount, 0),
    needs: sumOf("need"),
    wants: sumOf("want"),
    other: sumOf(null),
    usual: avg(inWindow.reduce((s, e) => s + e.amount, 0)),
    items: rows.map((r) => ({
      what: r.note ?? r.name ?? "Something",
      category: r.note && r.name ? r.name : null,
      group: groupOf(r.key),
      who: r.who,
      amount: r.amount,
      time: clockTime(r.spentAt),
    })),
    cats: [...cats.values()].sort((a, b) => b.amount - a.amount),
    missions: m ? { met: m.items.filter((i) => i.ok).map((i) => i.title), missed: m.items.filter((i) => !i.ok).map((i) => i.title) } : null,
  };
}

// Rule set 3: missions aligned with the household. Every goal (an amount, an hour, a count, a category) is picked from
// the household's own last 28 days, then tried on those days: an easy mission would have been met on about 7 of 10 of
// them, a medium one on about 4 of 10. Missions that would almost never (or almost always) have been met aren't given.
//
// Same two promises as every mission: a day with no spending meets it, and more spending can only break it.
// Adding a mission: add one entry to ALIGNED. Its variants() are the settings worth trying; the test picks among them.
import type { CatInfo, DayExpense, DayFacts, Mission } from "./missions";
import { formatPeso } from "./money";
import { DAY_MS, MANILA_OFFSET_MS } from "./time";

/** One setting of a mission: whatever it needs to say and check itself. Stored in the day's baseline. */
export type Params = { cat?: CatInfo; cat2?: CatInfo; cats?: CatInfo[]; amount?: number; n?: number; hour?: number; day?: number };

/**
 * A mission the household's days passed: its setting, level, and how often it would have been met. Set 4 also keeps
 * starters, given only when the tried missions run short (see gentle.ts).
 */
export type Aligned = { type: string; level: 1 | 2; params: Params; rate: number; starter?: true };

export type AlignedDef = {
  type: string;
  name: string;
  /** Missions that say nearly the same thing (before 8 am and before noon): at most one a day. */
  family?: string;
  /** The settings to try, from the household's days. Settings of one category (or none) compete with each other. */
  variants(ctx: Ctx): Params[];
  build(p: Params): Omit<Mission, "level">;
  /** Days this mission would have been given (a comparison needs a day to compare with). Default: every day. */
  appliesOn?(f: DayFacts, p: Params): boolean;
  /** Tried days it needs (default 7): fewer for a mission that only applies on some days, like weekends. */
  minTried?: number;
  /** A setting for the guide's made-up household. */
  demo: Params;
};

export type Ctx = {
  /** The tried days: each day in the last 28 with spending, with its yesterday and last week. */
  days: DayFacts[];
  /** Visible categories used in the tried days, most days first. */
  cats: { cat: CatInfo; days: number }[];
  people: number;
  /** The day the missions are for, and what it can compare with. */
  day: number;
  yesterday: DayExpense[];
  lastWeek: DayExpense[];
  /** Spent this week (from Monday) before the day. */
  weekBefore: number;
};

export type Bands = Record<1 | 2, { target: number; lo: number; hi: number }>;

const BANDS: Bands = {
  1: { target: 0.7, lo: 0.6, hi: 0.85 },
  2: { target: 0.4, lo: 0.3, hi: 0.55 },
};
/** Fewer spending days than this in the last 28 and the household gets the starter missions instead. */
export const MIN_SPENDING_DAYS = 10;
/** A mission needs this many days to be tried on. */
const MIN_TRIED = 7;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const sum = (xs: DayExpense[]) => xs.reduce((s, e) => s + e.amount, 0);
export const inCat = (xs: DayExpense[], id: number) => xs.filter((e) => e.categoryId === id);
/** The Manila hour of `ms`, by arithmetic: a Date per expense per try was most of the CPU time of align(). */
export const hour = (ms: number) => Math.floor((((ms + MANILA_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / 3_600_000);
export const label = (c: CatInfo) => `${c.emoji} ${c.name}`;
export const peso = formatPeso;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "8 am", "12 noon", "9 pm". */
export function clock(h: number): string {
  if (h === 0 || h === 24) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

/** Round up to a friendly amount: ₱10 steps under ₱200, ₱50 under ₱1,000, ₱100 above. */
export function friendlyUp(centavos: number): number {
  const step = centavos < 20_000 ? 1_000 : centavos < 100_000 ? 5_000 : 10_000;
  return Math.max(1_000, Math.ceil(centavos / step) * step);
}

/** Round down the same way, never below ₱10. */
export function friendlyDown(centavos: number): number {
  const step = centavos < 20_000 ? 1_000 : centavos < 100_000 ? 5_000 : 10_000;
  return Math.max(1_000, Math.floor(centavos / step) * step);
}

/** Where an easy or medium limit can land: the days' values at these shares (more would only cost CPU time). */
const QUANTILES = [0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9];

/** "Under ₱L" limits worth trying: just above some tried days' values, so each one lands on a real day's edge. */
export function limits(values: number[], quantiles: readonly number[] = QUANTILES): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [];
  const at = quantiles.map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
  return [...new Set(at.map((x) => friendlyUp(x + 1)))].sort((a, b) => a - b);
}
export const range = (lo: number, hi: number) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);

/** Categories on at least `share` of the tried days: the 6 used most, so a long category list stays quick to try. */
export const usedOn = (ctx: Ctx, share: number) => ctx.cats.filter((c) => c.days >= Math.max(2, share * ctx.days.length)).slice(0, 6);

function amountUnder(
  type: string,
  name: string,
  family: string | undefined,
  of: (xs: DayExpense[]) => DayExpense[],
  title: (amount: number) => string,
  demo: number,
): AlignedDef {
  return {
    type,
    name,
    family,
    variants: (ctx) => limits(ctx.days.map((f) => sum(of(f.expenses)))).map((amount) => ({ amount })),
    build: (p) => ({
      type,
      title: title(p.amount!),
      catIds: [],
      check(f) {
        const t = sum(of(f.expenses));
        return { ok: t < p.amount!, note: t ? `${peso(t)} spent` : "none" };
      },
    }),
    demo: { amount: demo },
  };
}

function quietFrom(type: string, name: string, family: string, catShare: number | null): AlignedDef {
  const before = type.includes("before");
  const bad = (h: number, p: Params) => (before ? h < p.hour! : h >= p.hour!);
  return {
    type,
    name,
    family,
    variants: (ctx) => {
      const hours = before ? range(6, 12) : range(17, 23);
      if (catShare === null) return hours.map((h) => ({ hour: h }));
      return usedOn(ctx, catShare).flatMap((c) => range(15, 23).map((h) => ({ cat: c.cat, hour: h })));
    },
    build: (p) => ({
      type,
      title: p.cat ? `No ${label(p.cat)} after ${clock(p.hour!)}` : `Nothing spent ${before ? "before" : "after"} ${clock(p.hour!)}`,
      catIds: p.cat ? [p.cat.id] : [],
      check(f) {
        const n = (p.cat ? inCat(f.expenses, p.cat.id) : f.expenses).filter((e) => bad(hour(e.spentAt), p)).length;
        return { ok: n === 0, note: n === 0 ? "none" : plural(n, "buy") };
      },
    }),
    demo: catShare === null ? { hour: before ? 9 : 21 } : { cat: { id: 1, name: "Eating out", emoji: "🍜" }, hour: 20 },
  };
}

function countAtMost(type: string, name: string, family: string | undefined, count: (f: DayFacts) => number, title: (n: number) => string, unit: string): AlignedDef {
  return {
    type,
    name,
    family,
    variants: (ctx) => range(1, Math.max(...ctx.days.map(count))).map((n) => ({ n })),
    build: (p) => ({
      type,
      title: title(p.n!),
      catIds: [],
      check(f) {
        const n = count(f);
        return { ok: n <= p.n!, note: plural(n, unit) };
      },
    }),
    demo: { n: 3 },
  };
}

const perCatMost = (xs: DayExpense[]) => {
  const per = new Map<number | null, number>();
  for (const e of xs) per.set(e.categoryId, (per.get(e.categoryId) ?? 0) + 1);
  return Math.max(0, ...per.values());
};

const closestMinutes = (xs: DayExpense[]) => {
  const t = xs.map((e) => e.spentAt).sort((a, b) => a - b);
  let best = Infinity;
  for (let i = 1; i < t.length; i++) best = Math.min(best, (t[i] - t[i - 1]) / 60_000);
  return best;
};

const spreadHours = (xs: DayExpense[]) => {
  if (xs.length < 2) return 0;
  const t = xs.map((e) => e.spentAt);
  return (Math.max(...t) - Math.min(...t)) / 3_600_000;
};

/** Every rule of set 3. New ones go at the end: the draw shuffles them, and stored days must keep their missions. */
export const ALIGNED: ReadonlyArray<AlignedDef> = [
  amountUnder("day-under", "Staying under your kind of day", "day-limit", (xs) => xs, (a) => `Keep today under ${peso(a)}`, 80_000),
  {
    type: "cat-under",
    name: "Keeping a category under budget",
    variants: (ctx) =>
      usedOn(ctx, 0.5).flatMap((c) => limits(ctx.days.map((f) => sum(inCat(f.expenses, c.cat.id)))).map((amount) => ({ cat: c.cat, amount }))),
    build: (p) => ({
      type: "cat-under",
      title: `Keep ${label(p.cat!)} under ${peso(p.amount!)}`,
      catIds: [p.cat!.id],
      check(f) {
        const t = sum(inCat(f.expenses, p.cat!.id));
        return { ok: t < p.amount!, note: t ? `${peso(t)} spent` : "none" };
      },
    }),
    demo: { cat: { id: 1, name: "Eating out", emoji: "🍜" }, amount: 25_000 },
  },
  {
    type: "no-big-buy",
    name: "No big buys",
    family: "big-buy",
    variants: (ctx) => limits(ctx.days.map((f) => Math.max(0, ...f.expenses.map((e) => e.amount)) - 1)).map((amount) => ({ amount })),
    build: (p) => ({
      type: "no-big-buy",
      title: `No single buy over ${peso(p.amount!)}`,
      catIds: [],
      check(f) {
        const top = Math.max(0, ...f.expenses.map((e) => e.amount));
        return { ok: top <= p.amount!, note: top ? `biggest ${peso(top)}` : "none" };
      },
    }),
    demo: { amount: 50_000 },
  },
  {
    type: "cat-no-big-buy",
    name: "No big buys in a category",
    family: "big-buy",
    variants: (ctx) =>
      usedOn(ctx, 0.4).flatMap((c) =>
        limits(ctx.days.map((f) => Math.max(0, ...inCat(f.expenses, c.cat.id).map((e) => e.amount)) - 1)).map((amount) => ({ cat: c.cat, amount })),
      ),
    build: (p) => ({
      type: "cat-no-big-buy",
      title: `No ${label(p.cat!)} buy over ${peso(p.amount!)}`,
      catIds: [p.cat!.id],
      check(f) {
        const top = Math.max(0, ...inCat(f.expenses, p.cat!.id).map((e) => e.amount));
        return { ok: top <= p.amount!, note: top ? `biggest ${peso(top)}` : "none" };
      },
    }),
    demo: { cat: { id: 1, name: "Eating out", emoji: "🍜" }, amount: 20_000 },
  },
  {
    type: "no-small-buys",
    name: "No little extras",
    variants: (ctx) => {
      const mins = ctx.days.map((f) => Math.min(...f.expenses.map((e) => e.amount)));
      return [...new Set(mins.map(friendlyDown))].filter((a) => a >= 2_000 && a <= 10_000).map((amount) => ({ amount }));
    },
    build: (p) => ({
      type: "no-small-buys",
      title: `No little buys under ${peso(p.amount!)}`,
      catIds: [],
      check(f) {
        const n = f.expenses.filter((e) => e.amount < p.amount!).length;
        return { ok: n === 0, note: n === 0 ? "none" : plural(n, "little buy") };
      },
    }),
    demo: { amount: 5_000 },
  },
  countAtMost("few-buys", "Fewer buys", "buys", (f) => f.expenses.length, (n) => (n === 1 ? "Just one buy today" : `At most ${n} buys today`), "buy"),
  {
    type: "cat-few-buys",
    name: "Fewer buys in a category",
    variants: (ctx) => usedOn(ctx, 0.4).flatMap((c) => range(1, 3).map((n) => ({ cat: c.cat, n }))),
    build: (p) => ({
      type: "cat-few-buys",
      title: p.n === 1 ? `Only one ${label(p.cat!)} buy today` : `At most ${p.n} ${label(p.cat!)} buys today`,
      catIds: [p.cat!.id],
      check(f) {
        const n = inCat(f.expenses, p.cat!.id).length;
        return { ok: n <= p.n!, note: plural(n, "buy") };
      },
    }),
    demo: { cat: { id: 1, name: "Eating out", emoji: "🍜" }, n: 2 },
  },
  countAtMost(
    "few-cats",
    "Fewer categories",
    "categories",
    (f) => new Set(f.expenses.map((e) => e.categoryId)).size,
    (n) => (n === 1 ? "Spend in just one category" : `Spend in at most ${n} categories`),
    "category",
  ),
  countAtMost(
    "per-cat-buys",
    "Spread-out buys",
    undefined,
    (f) => perCatMost(f.expenses),
    (n) => (n === 1 ? "No category bought twice" : `No more than ${n} buys in any one category`),
    "buy",
  ),
  {
    type: "spaced-buys",
    name: "Taking a pause between buys",
    variants: () => [15, 30, 60, 90, 120, 180].map((n) => ({ n })),
    build: (p) => ({
      type: "spaced-buys",
      title: p.n! < 60 ? `No two buys within ${p.n} minutes` : p.n === 60 ? "No two buys within an hour" : `No two buys within ${p.n! / 60} hours`,
      catIds: [],
      check(f) {
        const gap = closestMinutes(f.expenses);
        return { ok: gap >= p.n!, note: gap === Infinity ? "no two buys" : `closest ${Math.round(gap)} min apart` };
      },
    }),
    demo: { n: 60 },
  },
  {
    type: "few-people",
    name: "Fewer of you spending",
    variants: (ctx) => range(1, ctx.people - 1).map((n) => ({ n })),
    build: (p) => ({
      type: "few-people",
      title: p.n === 1 ? "Only one of you spends today" : `At most ${p.n} of you spend today`,
      catIds: [],
      check(f) {
        const n = new Set(f.expenses.map((e) => e.profileId)).size;
        return { ok: n <= p.n!, note: plural(n, "person", "people") };
      },
    }),
    demo: { n: 1 },
  },
  quietFrom("quiet-before", "Quiet mornings", "morning", null),
  quietFrom("quiet-after", "Quiet evenings", "evening", null),
  quietFrom("cat-quiet-after", "A category's quiet evening", "evening", 0.4),
  {
    type: "one-window",
    name: "Buys in one stretch",
    variants: () => range(2, 14).map((n) => ({ n })),
    build: (p) => ({
      type: "one-window",
      title: `All of today's buys within ${p.n} hours`,
      catIds: [],
      check(f) {
        const h = spreadHours(f.expenses);
        return { ok: h <= p.n!, note: `over ${Math.round(h * 10) / 10} h` };
      },
    }),
    demo: { n: 6 },
  },
  {
    type: "no-cat",
    name: "Skipping a category for the day",
    variants: (ctx) => usedOn(ctx, 0).map((c) => ({ cat: c.cat })),
    build: (p) => ({
      type: "no-cat",
      title: `No ${label(p.cat!)} today`,
      catIds: [p.cat!.id],
      check(f) {
        const t = sum(inCat(f.expenses, p.cat!.id));
        return { ok: t === 0, note: t ? `${peso(t)} spent` : "none" };
      },
    }),
    demo: { cat: { id: 4, name: "Shopping", emoji: "🛍️" } },
  },
  {
    type: "two-no-cats",
    name: "Skipping two categories",
    variants: (ctx) => {
      const cs = usedOn(ctx, 0).slice(0, 8);
      return cs.flatMap((a, i) => cs.slice(i + 1).map((b) => ({ cat: a.cat, cat2: b.cat })));
    },
    build: (p) => ({
      type: "two-no-cats",
      title: `No ${label(p.cat!)} and no ${label(p.cat2!)} today`,
      catIds: [p.cat!.id, p.cat2!.id],
      check(f) {
        const t = sum(inCat(f.expenses, p.cat!.id)) + sum(inCat(f.expenses, p.cat2!.id));
        return { ok: t === 0, note: t ? `${peso(t)} spent` : "none" };
      },
    }),
    demo: { cat: { id: 4, name: "Shopping", emoji: "🛍️" }, cat2: { id: 3, name: "Gifts & occasions", emoji: "🎁" } },
  },
  {
    type: "less-than-yesterday",
    name: "Beating yesterday",
    family: "day-limit",
    variants: (ctx) => (sum(ctx.yesterday) > 0 ? [{}] : []),
    appliesOn: (f) => sum(f.yesterday) > 0,
    build: () => ({
      type: "less-than-yesterday",
      title: "Spend less than yesterday",
      catIds: [],
      check(f) {
        const t = sum(f.expenses);
        const ref = sum(f.yesterday);
        return { ok: t === 0 || t < ref, note: `${peso(t)} vs ${peso(ref)}` };
      },
    }),
    demo: {},
  },
  {
    type: "less-than-last-week",
    name: "Beating last week",
    family: "day-limit",
    variants: (ctx) => (sum(ctx.lastWeek) > 0 ? [{ day: ctx.day }] : []),
    appliesOn: (f) => sum(f.lastWeek) > 0,
    build: (p) => ({
      type: "less-than-last-week",
      title: `Spend less than last ${WEEKDAYS[new Date(p.day! * DAY_MS).getUTCDay()]}`,
      catIds: [],
      check(f) {
        const t = sum(f.expenses);
        const ref = sum(f.lastWeek);
        return { ok: t === 0 || t < ref, note: `${peso(t)} vs ${peso(ref)}` };
      },
    }),
    demo: { day: 20_382 },
  },
  {
    type: "fewer-buys-than-yesterday",
    name: "Fewer buys than yesterday",
    family: "buys",
    variants: (ctx) => (ctx.yesterday.length >= 2 ? [{}] : []),
    appliesOn: (f) => f.yesterday.length >= 2,
    build: () => ({
      type: "fewer-buys-than-yesterday",
      title: "Fewer buys than yesterday",
      catIds: [],
      check(f) {
        const n = f.expenses.length;
        return { ok: n === 0 || n < f.yesterday.length, note: `${n} vs ${f.yesterday.length}` };
      },
    }),
    demo: {},
  },
  {
    type: "less-cat-than-yesterday",
    name: "A category under yesterday's",
    variants: (ctx) => usedOn(ctx, 0.3).filter((c) => sum(inCat(ctx.yesterday, c.cat.id)) > 0).map((c) => ({ cat: c.cat })),
    appliesOn: (f, p) => sum(inCat(f.yesterday, p.cat!.id)) > 0,
    build: (p) => ({
      type: "less-cat-than-yesterday",
      title: `Less ${label(p.cat!)} than yesterday`,
      catIds: [p.cat!.id],
      check(f) {
        const t = sum(inCat(f.expenses, p.cat!.id));
        const ref = sum(inCat(f.yesterday, p.cat!.id));
        return { ok: t === 0 || t < ref, note: `${peso(t)} vs ${peso(ref)}` };
      },
    }),
    demo: { cat: { id: 1, name: "Eating out", emoji: "🍜" } },
  },
  amountUnder(
    "morning-under",
    "A light morning",
    "morning",
    (xs) => xs.filter((e) => hour(e.spentAt) < 12),
    (a) => `Keep spending before noon under ${peso(a)}`,
    15_000,
  ),
  amountUnder(
    "evening-under",
    "A light evening",
    "evening",
    (xs) => xs.filter((e) => hour(e.spentAt) >= 18),
    (a) => `Keep spending after 6 pm under ${peso(a)}`,
    25_000,
  ),
];

export const ALIGNED_BY_TYPE: ReadonlyMap<string, AlignedDef> = new Map(ALIGNED.map((d) => [d.type, d]));

/** Which settings compete: those of the same category (or categories), so each category can have its own. */
const groupOf = (p: Params) => `${p.cat?.id ?? ""}/${p.cat2?.id ?? ""}`;

/**
 * Tries every mission's settings on the household's days and keeps, per mission and category, the setting closest to
 * "met on about 7 of 10 days" (easy) and to "about 4 of 10" (medium), or to set 4's `bands`. Pure.
 */
export function align(ctx: Ctx, defs: ReadonlyArray<AlignedDef> = ALIGNED, bands: Bands = BANDS): Aligned[] {
  if (ctx.days.length < MIN_SPENDING_DAYS) return [];
  const out: Aligned[] = [];
  for (const def of defs) {
    const groups = new Map<string, { params: Params; rate: number }[]>();
    for (const params of def.variants(ctx)) {
      const mission = def.build(params);
      const tried = ctx.days.filter((f) => def.appliesOn?.(f, params) ?? true);
      if (tried.length < (def.minTried ?? MIN_TRIED)) continue;
      const rate = tried.filter((f) => mission.check(f).ok).length / tried.length;
      const key = groupOf(params);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ params, rate });
    }
    for (const tries of groups.values()) {
      for (const level of [1, 2] as const) {
        const band = bands[level];
        let best: { params: Params; rate: number } | null = null;
        for (const t of tries) {
          if (t.rate < band.lo || t.rate > band.hi) continue;
          if (!best || Math.abs(t.rate - band.target) < Math.abs(best.rate - band.target)) best = t;
        }
        if (best) out.push({ type: def.type, level, params: best.params, rate: Math.round(best.rate * 100) / 100 });
      }
    }
  }
  return out;
}

/** The household's days for align(): `history` holds at least the 35 days before `day` (28 tried, a week to compare). */
export function alignContext(history: DayExpense[], day: number, cats: CatInfo[], dayKey: (ms: number) => number): Ctx {
  const on = new Map<number, DayExpense[]>();
  for (const e of history) {
    const d = dayKey(e.spentAt);
    if (d >= day) continue;
    const list = on.get(d);
    if (list) list.push(e);
    else on.set(d, [e]);
  }
  const get = (d: number) => on.get(d) ?? [];
  const visible = new Map(cats.map((c) => [c.id, c]));
  const days: DayFacts[] = [];
  const catDays = new Map<number, number>();
  const people = new Set<number>();
  let weekBefore = 0;
  for (let d = day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7); d < day; d++) weekBefore += sum(get(d));
  for (let d = day - 28; d < day; d++) {
    const expenses = get(d);
    if (expenses.length === 0) continue;
    days.push({ expenses, yesterday: get(d - 1), lastWeek: get(d - 7) });
    for (const id of new Set(expenses.map((e) => e.categoryId))) if (id !== null && visible.has(id)) catDays.set(id, (catDays.get(id) ?? 0) + 1);
    for (const e of expenses) people.add(e.profileId);
  }
  return {
    days,
    cats: [...catDays].map(([id, n]) => ({ cat: visible.get(id)!, days: n })).sort((a, b) => b.days - a.days || a.cat.id - b.cat.id),
    people: people.size,
    day,
    yesterday: get(day - 1),
    lastWeek: get(day - 7),
    weekBefore,
  };
}

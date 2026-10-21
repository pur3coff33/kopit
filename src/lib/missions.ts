// Daily missions: 3–5 small "spend less" goals a day, checked automatically from what the household logs.
// Pure code (no database): garden.ts feeds it expenses and stores the results.
//
// Adding a mission: add one entry to TEMPLATES. Its make() gets the household's 28-day baseline and returns a
// concrete mission, or null when it doesn't fit (e.g. no category to talk about yet). Every check() must pass on a
// day with no spending, and more spending may only ever make it fail (so "not today" during the day is final).
import { formatPeso } from "./money";
import { DAY_MS, MANILA_OFFSET_MS, dayKey } from "./time";

export type DayExpense = { amount: number; categoryId: number | null; profileId: number; spentAt: number };
export type CatInfo = { id: number; name: string; emoji: string };

export type CatBaseline = { cat: CatInfo; daysWith: number; usualOnDay: number; buysOnDay: number };
export type Baseline = {
  /** The day (Manila day key) this baseline is for. */
  day: number;
  /** Days since the first expense in the last 28 (missions that need a baseline wait for 14). */
  historyDays: number;
  usualDay: number;
  usualCount: number;
  /** A big single buy for this household: the 90th-percentile amount. */
  bigBuy: number;
  yesterdayTotal: number;
  lastWeekTotal: number;
  /** Visible categories used in the last 28 days, most often used first. */
  cats: CatBaseline[];
};

export type DayFacts = { expenses: DayExpense[]; yesterday: DayExpense[]; lastWeek: DayExpense[] };

export type Mission = {
  type: string;
  level: 1 | 2 | 3;
  title: string;
  /** Categories it's about, so one day doesn't get two missions on the same category. */
  catIds: number[];
  /** ok: still met (so far, for today). note: a short progress line. */
  check(f: DayFacts): { ok: boolean; note: string };
};

export type Template = {
  type: string;
  level: 1 | 2 | 3;
  needsHistory: boolean;
  make(b: Baseline, rnd: () => number): Mission | null;
};

const HISTORY_DAYS = 28;
const MIN_HISTORY = 14;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Round down to a friendly amount: ₱10 steps under ₱200, ₱50 under ₱1,000, ₱100 above. Never below ₱10. */
export function friendly(centavos: number): number {
  const step = centavos < 20_000 ? 1_000 : centavos < 100_000 ? 5_000 : 10_000;
  return Math.max(1_000, Math.floor(centavos / step) * step);
}

const sum = (xs: DayExpense[]) => xs.reduce((s, e) => s + e.amount, 0);
const inCat = (xs: DayExpense[], id: number) => xs.filter((e) => e.categoryId === id);
const hour = (ms: number) => new Date(ms + MANILA_OFFSET_MS).getUTCHours();
const peso = formatPeso;
const label = (c: CatInfo) => `${c.emoji} ${c.name}`;

/** The household's last 28 days before `day`, as the yardstick for that day's missions. One pass over `history`. */
export function baseline(history: DayExpense[], day: number, cats: CatInfo[]): Baseline {
  const visible = new Map(cats.map((c) => [c.id, c]));
  const perCat = new Map<number, { days: Set<number>; sum: number; count: number }>();
  const amounts: number[] = [];
  let total = 0;
  let first = day;
  let yesterdayTotal = 0;
  let lastWeekTotal = 0;
  for (const e of history) {
    const d = dayKey(e.spentAt);
    if (d < day - HISTORY_DAYS || d >= day) continue;
    total += e.amount;
    amounts.push(e.amount);
    if (d < first) first = d;
    if (d === day - 1) yesterdayTotal += e.amount;
    if (d === day - 7) lastWeekTotal += e.amount;
    if (e.categoryId !== null && visible.has(e.categoryId)) {
      let c = perCat.get(e.categoryId);
      if (!c) perCat.set(e.categoryId, (c = { days: new Set(), sum: 0, count: 0 }));
      c.days.add(d);
      c.sum += e.amount;
      c.count++;
    }
  }
  const historyDays = Math.min(HISTORY_DAYS, day - first);
  const span = Math.max(1, historyDays);
  amounts.sort((a, b) => a - b);
  return {
    day,
    historyDays,
    usualDay: total / span,
    usualCount: amounts.length / span,
    bigBuy: amounts.length ? amounts[Math.floor(0.9 * (amounts.length - 1))] : 0,
    yesterdayTotal,
    lastWeekTotal,
    cats: [...perCat]
      .map(([id, c]) => ({ cat: visible.get(id)!, daysWith: c.days.size, usualOnDay: c.sum / c.days.size, buysOnDay: c.count / c.days.size }))
      .sort((a, b) => b.daysWith - a.daysWith || a.cat.id - b.cat.id),
  };
}

const pick = <T>(xs: T[], rnd: () => number): T | null => (xs.length ? xs[Math.floor(rnd() * xs.length)] : null);
/** Categories used now and then (not daily): good "skip it today" candidates. */
const occasional = (b: Baseline) => b.cats.filter((c) => c.daysWith >= 2 && c.daysWith <= 20);
/** Categories used regularly enough to have a sensible daily limit. */
const regular = (b: Baseline) => b.cats.filter((c) => c.daysWith >= 5 && c.usualOnDay >= 2_000);

function catLimit(type: string, level: 1 | 2 | 3, share: number): Template {
  return {
    type,
    level,
    needsHistory: true,
    make(b, rnd) {
      const c = pick(regular(b), rnd);
      if (!c) return null;
      const limit = friendly(c.usualOnDay * share);
      return {
        type,
        level,
        title: `Keep ${label(c.cat)} under ${peso(limit)}`,
        catIds: [c.cat.id],
        check(f) {
          const t = sum(inCat(f.expenses, c.cat.id));
          return { ok: t === 0 || t < limit, note: `${peso(t)} so far` };
        },
      };
    },
  };
}

function noCats(type: string, level: 1 | 2 | 3, pickCats: (b: Baseline, rnd: () => number) => CatBaseline[] | null): Template {
  return {
    type,
    level,
    needsHistory: true,
    make(b, rnd) {
      const cs = pickCats(b, rnd);
      if (!cs?.length) return null;
      return {
        type,
        level,
        title: `No ${cs.map((c) => label(c.cat)).join(" and no ")} today`,
        catIds: cs.map((c) => c.cat.id),
        check(f) {
          const t = cs.reduce((s, c) => s + sum(inCat(f.expenses, c.cat.id)), 0);
          return { ok: t === 0, note: t === 0 ? "none yet" : `${peso(t)} spent` };
        },
      };
    },
  };
}

function dayLimit(type: string, level: 1 | 2 | 3, share: number, title: (limit: number) => string): Template {
  return {
    type,
    level,
    needsHistory: true,
    make(b) {
      if (b.usualDay < 2_000) return null;
      const limit = friendly(b.usualDay * share);
      return {
        type,
        level,
        title: title(limit),
        catIds: [],
        check(f) {
          const t = sum(f.expenses);
          return { ok: t === 0 || t < limit, note: `${peso(t)} so far` };
        },
      };
    },
  };
}

function simple(type: string, level: 1 | 2 | 3, title: string, check: Mission["check"]): Template {
  return { type, level, needsHistory: false, make: () => ({ type, level, title, catIds: [], check }) };
}

function noneAt(type: string, level: 1 | 2 | 3, title: string, bad: (h: number) => boolean): Template {
  return simple(type, level, title, (f) => {
    const n = f.expenses.filter((e) => bad(hour(e.spentAt))).length;
    return { ok: n === 0, note: n === 0 ? "so far so good" : `${n} spent` };
  });
}

function lessThan(type: string, level: 1 | 2 | 3, of: "yesterday" | "lastWeek", share: number, title: (b: Baseline) => string): Template {
  return {
    type,
    level,
    needsHistory: false,
    make(b) {
      if ((of === "yesterday" ? b.yesterdayTotal : b.lastWeekTotal) <= 0) return null;
      return {
        type,
        level,
        title: title(b),
        catIds: [],
        check(f) {
          const t = sum(f.expenses);
          const ref = sum(of === "yesterday" ? f.yesterday : f.lastWeek) * share;
          return { ok: t === 0 || t < ref, note: `${peso(t)} vs ${peso(Math.round(ref))}` };
        },
      };
    },
  };
}

/** The rule types. About 20, each with variations from the household's categories and amounts. */
export const TEMPLATES: ReadonlyArray<Template> = [
  // easy
  noCats("no-cat", 1, (b, rnd) => {
    const c = pick(occasional(b), rnd);
    return c ? [c] : null;
  }),
  catLimit("cat-under", 1, 1),
  {
    type: "no-big-buy",
    level: 1,
    needsHistory: false,
    make(b) {
      const limit = b.historyDays >= MIN_HISTORY && b.bigBuy > 0 ? friendly(Math.max(b.bigBuy, 10_000)) : 100_000;
      return {
        type: "no-big-buy",
        level: 1,
        title: `No single buy over ${peso(limit)}`,
        catIds: [],
        check(f) {
          const top = Math.max(0, ...f.expenses.map((e) => e.amount));
          return { ok: top <= limit, note: top ? `biggest ${peso(top)}` : "none yet" };
        },
      };
    },
  },
  {
    type: "few-buys",
    level: 1,
    needsHistory: false,
    make(b) {
      const n = b.historyDays >= MIN_HISTORY ? Math.max(2, Math.round(b.usualCount)) : 4;
      return {
        type: "few-buys",
        level: 1,
        title: `At most ${n} expenses today`,
        catIds: [],
        check: (f) => ({ ok: f.expenses.length <= n, note: `${f.expenses.length} so far` }),
      };
    },
  },
  noneAt("quiet-morning", 1, "Nothing spent before 10 am", (h) => h < 10),
  // medium
  lessThan("less-than-yesterday", 2, "yesterday", 1, () => "Spend less than yesterday"),
  dayLimit("day-under-usual", 2, 1, (limit) => `Keep today under your usual ${peso(limit)}`),
  catLimit("cat-under-tight", 2, 0.7),
  simple("no-small-buys", 2, "No small buys under ₱50", (f) => {
    const n = f.expenses.filter((e) => e.amount < 5_000).length;
    return { ok: n === 0, note: n === 0 ? "none yet" : `${n} so far` };
  }),
  lessThan("less-than-last-week", 2, "lastWeek", 1, (b) => `Spend less than last ${WEEKDAYS[new Date(b.day * DAY_MS).getUTCDay()]}`),
  {
    type: "cat-one-buy",
    level: 2,
    needsHistory: true,
    make(b, rnd) {
      const c = pick(b.cats.filter((x) => x.daysWith >= 5 && x.buysOnDay >= 1.3), rnd);
      if (!c) return null;
      return {
        type: "cat-one-buy",
        level: 2,
        title: `Only one ${label(c.cat)} buy today`,
        catIds: [c.cat.id],
        check(f) {
          const n = inCat(f.expenses, c.cat.id).length;
          return { ok: n <= 1, note: `${n} so far` };
        },
      };
    },
  },
  simple("two-cats", 2, "Spend in at most 2 categories", (f) => {
    const n = new Set(f.expenses.map((e) => e.categoryId)).size;
    return { ok: n <= 2, note: `${n} so far` };
  }),
  noneAt("quiet-evening", 2, "Nothing spent after 8 pm", (h) => h >= 20),
  noCats("two-no-cats", 2, (b, rnd) => {
    const pool = occasional(b);
    if (pool.length < 2) return null;
    const a = pick(pool, rnd)!;
    const rest = pool.filter((c) => c !== a);
    return [a, pick(rest, rnd)!];
  }),
  // hard
  dayLimit("half-day", 3, 0.5, (limit) => `Keep today under ${peso(limit)}, half your usual`),
  simple("no-spend", 3, "A no-spend day", (f) => {
    const t = sum(f.expenses);
    return { ok: t === 0, note: t === 0 ? "nothing yet" : `${peso(t)} spent` };
  }),
  simple("one-buy", 3, "Just one expense today", (f) => ({ ok: f.expenses.length <= 1, note: `${f.expenses.length} so far` })),
  noCats("no-top-cat", 3, (b) => (b.cats[0] ? [b.cats[0]] : null)),
  lessThan("half-of-yesterday", 3, "yesterday", 0.5, () => "Spend less than half of yesterday"),
  catLimit("cat-under-half", 3, 0.5),
];

/** A friendly name per rule type, for "the mission you beat most" in a month's Wrapped. */
export const TYPE_NAMES: Readonly<Record<string, string>> = {
  "no-cat": "Skipping a category for the day",
  "cat-under": "Keeping a category under budget",
  "no-big-buy": "No big buys",
  "few-buys": "Fewer buys",
  "quiet-morning": "Quiet mornings",
  "less-than-yesterday": "Beating yesterday",
  "day-under-usual": "Staying under your usual day",
  "cat-under-tight": "A tighter category budget",
  "no-small-buys": "No little extras",
  "less-than-last-week": "Beating last week",
  "cat-one-buy": "One buy per category",
  "two-cats": "Two categories at most",
  "quiet-evening": "Quiet evenings",
  "two-no-cats": "Skipping two categories",
  "half-day": "Half your usual day",
  "no-spend": "No-spend days",
  "one-buy": "One-buy days",
  "no-top-cat": "Skipping your top category",
  "half-of-yesterday": "Half of yesterday",
  "cat-under-half": "Half a category's budget",
};

/** A small seeded random generator, so every phone draws the same missions for a household and day. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The day's 3–5 missions: at least one easy, at most one hard, no rule or category twice. */
export function missionsFor(householdId: number, day: number, b: Baseline): Mission[] {
  const rnd = mulberry32(Math.imul(householdId, 0x9e3779b1) ^ Math.imul(day, 0x85ebca6b));
  const want = 3 + Math.floor(rnd() * 3);
  const order = TEMPLATES.filter((t) => b.historyDays >= MIN_HISTORY || !t.needsHistory);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const picked: Mission[] = [];
  const usedCats = new Set<number>();
  const take = (t: Template) => {
    if (picked.some((m) => m.type === t.type) || (t.level === 3 && picked.some((m) => m.level === 3))) return false;
    const m = t.make(b, rnd);
    if (!m || m.catIds.some((id) => usedCats.has(id))) return false;
    picked.push(m);
    m.catIds.forEach((id) => usedCats.add(id));
    return true;
  };
  for (const t of order) if (t.level === 1 && take(t)) break; // one easy one, always
  for (const t of order) if (picked.length < want) take(t);
  return picked;
}

/** How a finished (or ongoing) day went: missions met, and which rule types were met. */
export function judgeDay(ms: Mission[], f: DayFacts): { missions: number; done: number; doneTypes: string[] } {
  const doneTypes = ms.filter((m) => m.check(f).ok).map((m) => m.type);
  return { missions: ms.length, done: doneTypes.length, doneTypes };
}

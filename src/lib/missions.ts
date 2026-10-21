// Daily missions: 3–5 small "spend less" goals a day (easy or medium, at least two easy), checked automatically from what the household logs.
// Pure code (no database): garden.ts feeds it expenses and stores the results.
//
// Adding a mission: add one entry to TEMPLATES. Its make() gets the household's 28-day baseline and returns a
// concrete mission, or null when it doesn't fit (e.g. no category to talk about yet). Every check() must pass on a
// day with no spending, and more spending may only ever make it fail (so "not today" during the day is final).
import { ALIGNED, ALIGNED_BY_TYPE, align, alignContext, type Aligned } from "./aligned";
import { formatPeso } from "./money";
import { DAY_MS, MANILA_OFFSET_MS, dayKey } from "./time";

export type DayExpense = { amount: number; categoryId: number | null; profileId: number; spentAt: number };
export type CatInfo = { id: number; name: string; emoji: string };

export type CatBaseline = { cat: CatInfo; daysWith: number; usualOnDay: number; buysOnDay: number };
export type Baseline = {
  /** The day (Manila day key) this baseline is for. */
  day: number;
  /** Which rule set the day draws from (RULES when it was made). Missing on days stored before rule sets: set 1. */
  rules?: number;
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
  /** Rule set 3: the missions tried on the household's own days, with their settings (see aligned.ts). */
  aligned?: Aligned[];
};

export type DayFacts = { expenses: DayExpense[]; yesterday: DayExpense[]; lastWeek: DayExpense[] };

export type Mission = {
  type: string;
  level: 1 | 2;
  title: string;
  /** Categories it's about, so one day doesn't get two missions on the same category. */
  catIds: number[];
  /** ok: still met (so far, for today). note: a short progress line. */
  check(f: DayFacts): { ok: boolean; note: string };
};

export type Template = {
  type: string;
  level: 1 | 2;
  needsHistory: boolean;
  /** The rule set it joined (missing: 1, the original 14). A day only draws from the sets up to its own. */
  since?: number;
  /** Rules that would say nearly the same thing (8 am and 10 am mornings): one per family a day. */
  family?: string;
  make(b: Baseline, rnd: () => number): Mission | null;
};

/**
 * The current rule set. A day's baseline is stored the first time it's needed, and its missions are drawn again from it
 * each time, so adding rules or changing the draw needs a new set, or days already given missions would get new ones.
 * Set 1: the original 14, at least one easy a day. Set 2: six more easy ones, at least two easy a day, one per family.
 * Set 3: missions aligned with the household (aligned.ts), with set 2's no-history rules for households still new.
 */
export const RULES = 3;
/**
 * The first day of set 3 (Manila day key of 2026-10-22). A day before it that was never stored gets set 2, as it would
 * have when it happened, so a past day's leaf can't change. Today is moved up to set 3 (see frozenBaselines).
 */
export const ALIGNED_FROM = 20_748;
const EASY_PER_DAY: Record<number, number> = { 1: 1, 2: 2, 3: 2 };

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

/**
 * The household's last 28 days before `day`, as the yardstick for that day's missions. `history` should reach 35 days
 * back: set 3 tries its missions on each of the 28 days, and some compare with a week before.
 */
export function baseline(history: DayExpense[], day: number, cats: CatInfo[], rules = RULES): Baseline {
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
    rules,
    historyDays,
    usualDay: total / span,
    usualCount: amounts.length / span,
    bigBuy: amounts.length ? amounts[Math.floor(0.9 * (amounts.length - 1))] : 0,
    yesterdayTotal,
    lastWeekTotal,
    cats: [...perCat]
      .map(([id, c]) => ({ cat: visible.get(id)!, daysWith: c.days.size, usualOnDay: c.sum / c.days.size, buysOnDay: c.count / c.days.size }))
      .sort((a, b) => b.daysWith - a.daysWith || a.cat.id - b.cat.id),
    ...(rules >= 3 ? { aligned: align(alignContext(history, day, cats, dayKey)) } : {}),
  };
}

const pick = <T>(xs: T[], rnd: () => number): T | null => (xs.length ? xs[Math.floor(rnd() * xs.length)] : null);
/** Categories used now and then (not daily): good "skip it today" candidates. */
const occasional = (b: Baseline) => b.cats.filter((c) => c.daysWith >= 2 && c.daysWith <= 20);
/** Categories used regularly enough to have a sensible daily limit. */
const regular = (b: Baseline) => b.cats.filter((c) => c.daysWith >= 5 && c.usualOnDay >= 2_000);

function catLimit(type: string, level: 1 | 2, share: number): Template {
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

function noCats(type: string, level: 1 | 2, pickCats: (b: Baseline, rnd: () => number) => CatBaseline[] | null): Template {
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

function dayLimit(type: string, level: 1 | 2, share: number, title: (limit: number) => string): Template {
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

function simple(type: string, level: 1 | 2, title: string, check: Mission["check"]): Template {
  return { type, level, needsHistory: false, make: () => ({ type, level, title, catIds: [], check }) };
}

function atMostCats(type: string, level: 1 | 2, n: number): Template {
  return simple(type, level, `Spend in at most ${n} categories`, (f) => {
    const used = new Set(f.expenses.map((e) => e.categoryId)).size;
    return { ok: used <= n, note: `${used} so far` };
  });
}

function noneAt(type: string, level: 1 | 2, title: string, bad: (h: number) => boolean): Template {
  return simple(type, level, title, (f) => {
    const n = f.expenses.filter((e) => bad(hour(e.spentAt))).length;
    return { ok: n === 0, note: n === 0 ? "so far so good" : `${n} spent` };
  });
}

function lessThan(type: string, level: 1 | 2, of: "yesterday" | "lastWeek", share: number, title: (b: Baseline) => string): Template {
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

const tagged = (t: Template, tags: Pick<Template, "since" | "family">): Template => ({ ...t, ...tags });

/**
 * The rule types, easy and medium only (no hard ones for now). 20, each with variations from the household's categories
 * and amounts. Set 1's order must stay as it is (the draw shuffles it), so new rules go at the end.
 */
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
  tagged(noneAt("quiet-morning", 1, "Nothing spent before 10 am", (h) => h < 10), { family: "morning" }),
  // medium
  lessThan("less-than-yesterday", 2, "yesterday", 1, () => "Spend less than yesterday"),
  tagged(dayLimit("day-under-usual", 2, 1, (limit) => `Keep today under your usual ${peso(limit)}`), { family: "day-limit" }),
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
  tagged(atMostCats("two-cats", 2, 2), { family: "categories" }),
  tagged(noneAt("quiet-evening", 2, "Nothing spent after 8 pm", (h) => h >= 20), { family: "evening" }),
  noCats("two-no-cats", 2, (b, rnd) => {
    const pool = occasional(b);
    if (pool.length < 2) return null;
    const a = pick(pool, rnd)!;
    const rest = pool.filter((c) => c !== a);
    return [a, pick(rest, rnd)!];
  }),
  // easy, set 2: roomier siblings of the rules above, so most good days can come from easy ones alone
  tagged(noneAt("quiet-night", 1, "Nothing spent after 10 pm", (h) => h >= 22), { since: 2, family: "evening" }),
  tagged(noneAt("quiet-early", 1, "Nothing spent before 8 am", (h) => h < 8), { since: 2, family: "morning" }),
  tagged(dayLimit("day-under-roomy", 1, 1.5, (limit) => `Keep today under ${peso(limit)}`), { since: 2, family: "day-limit" }),
  tagged(catLimit("cat-under-roomy", 1, 1.5), { since: 2 }),
  tagged(atMostCats("three-cats", 1, 3), { since: 2, family: "categories" }),
  tagged(
    simple("cat-two-buys", 1, "No more than 2 buys in any one category", (f) => {
      const per = new Map<number | null, number>();
      for (const e of f.expenses) per.set(e.categoryId, (per.get(e.categoryId) ?? 0) + 1);
      const most = Math.max(0, ...per.values());
      return { ok: most <= 2, note: most ? `most in one: ${most}` : "none yet" };
    }),
    { since: 2 },
  ),
];

/** A friendly name per rule type, for "the mission you beat most" in a month's Wrapped. */
const NAMES: Readonly<Record<string, string>> = {
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
  "quiet-night": "Quiet nights",
  "quiet-early": "Quiet early mornings",
  "day-under-roomy": "A roomy day budget",
  "cat-under-roomy": "A roomy category budget",
  "three-cats": "Three categories at most",
  "cat-two-buys": "Two buys per category at most",
  // Retired hard rules: past days' results can still name them in a month's Wrapped.
  "half-day": "Half your usual day",
  "no-spend": "No-spend days",
  "one-buy": "One-buy days",
  "no-top-cat": "Skipping your top category",
  "half-of-yesterday": "Half of yesterday",
  "cat-under-half": "Half a category's budget",
};
/** Set 3's own names for the types it adds; the ones it shares keep their old names. */
export const TYPE_NAMES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(ALIGNED.map((d) => [d.type, d.name])),
  ...NAMES,
};

/** Set 3's missions as templates for the draw: one per mission and level, picking one of its categories by `rnd`. */
function alignedTemplates(b: Baseline): Template[] {
  const groups = new Map<string, Aligned[]>();
  for (const a of b.aligned ?? []) {
    const key = `${a.type}/${a.level}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  const out: Template[] = [];
  for (const def of ALIGNED) {
    for (const level of [1, 2] as const) {
      const picks = groups.get(`${def.type}/${level}`);
      if (!picks) continue;
      out.push({
        type: def.type,
        level,
        needsHistory: false,
        family: def.family,
        make: (_b, rnd) => ({ ...ALIGNED_BY_TYPE.get(def.type)!.build(pick(picks, rnd)!.params), level }),
      });
    }
  }
  return out;
}

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

const shuffle = <T>(xs: T[], rnd: () => number): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
};

/** The day's 3–5 missions from its rule set: at least one easy (two from set 2), no rule, category or family twice. */
export function missionsFor(householdId: number, day: number, b: Baseline): Mission[] {
  const rules = b.rules ?? 1;
  const rnd = mulberry32(Math.imul(householdId, 0x9e3779b1) ^ Math.imul(day, 0x85ebca6b));
  const want = 3 + Math.floor(rnd() * 3);
  if (rules >= 3) return alignedDraw(b, rnd, want);
  const order = shuffle(
    TEMPLATES.filter((t) => (t.since ?? 1) <= rules && (b.historyDays >= MIN_HISTORY || !t.needsHistory)),
    rnd,
  );
  const picked: Mission[] = [];
  const usedCats = new Set<number>();
  const families = new Set<string>();
  const take = (t: Template) => {
    if (picked.some((m) => m.type === t.type) || (t.family && families.has(t.family))) return false;
    const m = t.make(b, rnd);
    if (!m || m.catIds.some((id) => usedCats.has(id))) return false;
    picked.push(m);
    m.catIds.forEach((id) => usedCats.add(id));
    if (t.family) families.add(t.family);
    return true;
  };
  // The easy ones first, then the rest in the shuffled order.
  let easy = 0;
  for (const t of order) if (easy < (EASY_PER_DAY[rules] ?? 2) && t.level === 1 && take(t)) easy++;
  for (const t of order) if (picked.length < want) take(t);
  return picked;
}

/**
 * Set 3's draw: two easy ones first, then the rest, all from the household's aligned missions. Only when those run short
 * (a new household, or one with few spending days) does it fill up to 3 from set 2's no-history rules.
 */
function alignedDraw(b: Baseline, rnd: () => number, want: number): Mission[] {
  const aligned = shuffle(alignedTemplates(b), rnd);
  const starters = shuffle(
    TEMPLATES.filter((t) => !t.needsHistory && (t.since ?? 1) <= 2),
    rnd,
  );
  const picked: Mission[] = [];
  const usedCats = new Set<number>();
  const families = new Set<string>();
  const take = (t: Template) => {
    if (picked.some((m) => m.type === t.type) || (t.family && families.has(t.family))) return false;
    const m = t.make(b, rnd);
    if (!m || m.catIds.some((id) => usedCats.has(id))) return false;
    picked.push(m);
    m.catIds.forEach((id) => usedCats.add(id));
    if (t.family) families.add(t.family);
    return true;
  };
  const easy = () => picked.filter((m) => m.level === 1).length;
  for (const t of aligned) if (easy() < EASY_PER_DAY[3] && t.level === 1) take(t);
  for (const t of aligned) if (picked.length < want) take(t);
  for (const t of starters) if (easy() < EASY_PER_DAY[3] && t.level === 1) take(t);
  for (const t of starters) if (picked.length < 3) take(t);
  return picked;
}

/** How a finished (or ongoing) day went: missions met, and which rule types were met. */
export function judgeDay(ms: Mission[], f: DayFacts): { missions: number; done: number; doneTypes: string[] } {
  const doneTypes = ms.filter((m) => m.check(f).ok).map((m) => m.type);
  return { missions: ms.length, done: doneTypes.length, doneTypes };
}

// Rule set 4: gentle missions. Only about how much is spent: never who buys, when to stop, or how often, and nothing
// close to a no-spend day (a category is only skipped if it's one the household rarely buys anyway). Tried on the
// household's own last 28 days like set 3 (aligned.ts), but roomier: an easy mission would have been met on about 9 of
// 10 of them, a medium one on about 6 of 10. A day gets three: two easy and one medium.
//
// Same two promises as every mission: a day with no spending meets it, and more spending can only break it.
// Adding a mission: add one entry to GENTLE, at the end (stored days keep their settings, the draw shuffles the list).
import {
  MIN_SPENDING_DAYS,
  WEEKDAYS,
  align,
  friendlyUp,
  hour,
  inCat,
  label,
  limits,
  peso,
  range,
  sum,
  usedOn,
  type Aligned,
  type AlignedDef,
  type Bands,
  type Ctx,
  type Params,
} from "./aligned";
import type { CatInfo, DayExpense } from "./missions";
import { DAY_MS, MANILA_OFFSET_MS } from "./time";

const BANDS: Bands = {
  1: { target: 0.9, lo: 0.8, hi: 0.97 },
  2: { target: 0.6, lo: 0.5, hi: 0.72 },
};

/** Set 3's limits stop at 0.9; easy ones here sit near it, so a few roomier shares are tried too. */
const QUANTILES = [0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
const roomy = (values: number[]) => limits(values, QUANTILES);

/** A day this much above the usual one is a big day: "after a big day" and "less than yesterday" only follow one. */
const BIG_DAY = 1.25;
/** A category used on at most this share of the tried days is one the household rarely buys. */
const RARE = 1 / 3;

const LITTLE = 10_000;
const MERIENDA = { from: 14, to: 17 };
const LATE = 21;

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
const dayTotals = (ctx: Ctx) => ctx.days.map((f) => sum(f.expenses));
/** The usual amount on a day with spending in the category. */
const usualCat = (ctx: Ctx, id: number) => median(ctx.days.map((f) => sum(inCat(f.expenses, id))).filter((t) => t > 0));
const rare = (ctx: Ctx) => ctx.cats.filter((c) => c.days >= 2 && c.days <= RARE * ctx.days.length).slice(0, 6);
const weekday = (day: number) => new Date(day * DAY_MS).getUTCDay();
const weekend = (day: number) => weekday(day) === 0 || weekday(day) === 6;
const dayOf = (ms: number) => Math.floor((ms + MANILA_OFFSET_MS) / DAY_MS);
/** The 15th and the month's last day: when most pay comes in. */
const payday = (day: number) => {
  const date = new Date(day * DAY_MS).getUTCDate();
  return date === 15 || new Date((day + 1) * DAY_MS).getUTCDate() === 1;
};
const pairs = <T>(xs: T[]) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b] as const));
const perPersonMost = (xs: DayExpense[]) => {
  const per = new Map<number, number>();
  for (const e of xs) per.set(e.profileId, (per.get(e.profileId) ?? 0) + e.amount);
  return Math.max(0, ...per.values());
};
const FOOD: CatInfo = { id: 1, name: "Food", emoji: "🍜" };
const TRANSPORT: CatInfo = { id: 2, name: "Transport", emoji: "🚌" };
const SHOPPING: CatInfo = { id: 3, name: "Shopping", emoji: "🛍️" };
const FUN: CatInfo = { id: 4, name: "Fun", emoji: "🎮" };

/** "Keep … under ₱X" on part of the day's spending: `of` picks the part. */
function under(
  type: string,
  name: string,
  family: string | undefined,
  of: (xs: DayExpense[], p: Params) => DayExpense[],
  title: (p: Params) => string,
  demo: Params,
  extra: Partial<AlignedDef> = {},
): AlignedDef {
  return {
    type,
    name,
    family,
    variants: (ctx) => roomy(ctx.days.map((f) => sum(of(f.expenses, {})))).map((amount) => ({ amount })),
    build: (p) => ({
      type,
      title: title(p),
      catIds: [...(p.cat ? [p.cat.id] : []), ...(p.cat2 ? [p.cat2.id] : []), ...(p.cats ?? []).map((c) => c.id)],
      check(f) {
        const t = sum(of(f.expenses, p));
        return { ok: t < p.amount!, note: t ? `${peso(t)} spent` : "none" };
      },
    }),
    demo,
    ...extra,
  };
}

/** "Less than yesterday" for the whole day or a category, given only the day after a big one (above `p.amount`). */
function lessThanYesterday(type: string, name: string, family: string | undefined, catShare: number | null): AlignedDef {
  const of = (xs: DayExpense[], p: Params) => (p.cat ? inCat(xs, p.cat.id) : xs);
  return {
    type,
    name,
    family,
    variants: (ctx) => {
      if (catShare === null) {
        const big = median(dayTotals(ctx)) * BIG_DAY;
        return sum(ctx.yesterday) > big ? [{ amount: Math.round(big) }] : [];
      }
      return usedOn(ctx, catShare)
        .map((c) => ({ cat: c.cat, amount: Math.round(usualCat(ctx, c.cat.id) * BIG_DAY) }))
        .filter((p) => sum(inCat(ctx.yesterday, p.cat.id)) > p.amount);
    },
    appliesOn: (f, p) => sum(of(f.yesterday, p)) > p.amount!,
    build: (p) => ({
      type,
      title: p.cat ? `Less ${label(p.cat)} than yesterday` : "Spend less than yesterday",
      catIds: p.cat ? [p.cat.id] : [],
      check(f) {
        const t = sum(of(f.expenses, p));
        const ref = sum(of(f.yesterday, p));
        return { ok: t === 0 || t < ref, note: `${peso(t)} vs ${peso(ref)}` };
      },
    }),
    demo: catShare === null ? { amount: 0 } : { cat: FOOD, amount: 0 },
  };
}

/** Every rule of set 4. New ones go at the end. */
export const GENTLE: ReadonlyArray<AlignedDef> = [
  under("day-under", "Staying under your kind of day", "day-limit", (xs) => xs, (p) => `Keep today under ${peso(p.amount!)}`, { amount: 80_000 }),
  under("calm-after-big", "A calm day after a big one", "day-limit", (xs) => xs, (p) => `After a big day: keep today under ${peso(p.amount!)}`, { amount: 60_000 }, {
    variants: (ctx) =>
      sum(ctx.yesterday) > median(dayTotals(ctx)) * BIG_DAY ? roomy(dayTotals(ctx)).map((amount) => ({ amount })) : [],
  }),
  lessThanYesterday("less-than-yesterday", "Beating yesterday", "day-limit", null),
  under("payday-under", "A steady payday", "day-limit", (xs) => xs, (p) => `Payday: keep today under ${peso(p.amount!)}`, { amount: 120_000 }, {
    variants: (ctx) => (payday(ctx.day) ? roomy(dayTotals(ctx)).map((amount) => ({ amount })) : []),
  }),
  under(
    "weekend-under",
    "A lighter weekend day",
    "day-limit",
    (xs) => xs,
    (p) => `Keep this ${WEEKDAYS[weekday(p.day!)]} under ${peso(p.amount!)}`,
    { amount: 100_000, day: 20_386 },
    {
      variants: (ctx) =>
        weekend(ctx.day)
          ? roomy(ctx.days.filter((f) => weekend(dayOf(f.expenses[0].spentAt))).map((f) => sum(f.expenses))).map((amount) => ({ amount, day: ctx.day }))
          : [],
      appliesOn: (f) => f.expenses.length > 0 && weekend(dayOf(f.expenses[0].spentAt)),
      minTried: 5,
    },
  ),
  {
    type: "week-under",
    name: "Keeping the week in check",
    family: "day-limit",
    // What the week already had is fixed when the day's missions are: only today's spending moves it.
    variants: (ctx) =>
      ctx.weekBefore > 0
        ? [...new Set(roomy(dayTotals(ctx)).map((l) => friendlyUp(ctx.weekBefore + l)))].map((amount) => ({ amount, n: ctx.weekBefore }))
        : [],
    build: (p) => ({
      type: "week-under",
      title: `Keep the week so far under ${peso(p.amount!)}`,
      catIds: [],
      check(f) {
        const t = p.n! + sum(f.expenses);
        return { ok: t < p.amount!, note: `${peso(t)} this week` };
      },
    }),
    demo: { amount: 400_000, n: 250_000 },
  },
  {
    type: "no-big-buy",
    name: "No big buys",
    family: "big-buy",
    variants: (ctx) => roomy(ctx.days.map((f) => Math.max(0, ...f.expenses.map((e) => e.amount)) - 1)).map((amount) => ({ amount })),
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
  under(
    "little-total",
    "Little buys adding up",
    undefined,
    (xs) => xs.filter((e) => e.amount < LITTLE),
    (p) => `Little buys (under ${peso(LITTLE)}) add up to under ${peso(p.amount!)}`,
    { amount: 15_000 },
  ),
  {
    type: "few-buys",
    name: "Fewer buys",
    variants: (ctx) => range(2, Math.max(...ctx.days.map((f) => f.expenses.length))).map((n) => ({ n })),
    build: (p) => ({
      type: "few-buys",
      title: `At most ${p.n} buys today`,
      catIds: [],
      check(f) {
        const n = f.expenses.length;
        return { ok: n <= p.n!, note: `${n} ${n === 1 ? "buy" : "buys"}` };
      },
    }),
    demo: { n: 6 },
  },
  under("cat-under", "Keeping a category under budget", undefined, (xs, p) => inCat(xs, p.cat!.id), (p) => `Keep ${label(p.cat!)} under ${peso(p.amount!)}`, { cat: FOOD, amount: 30_000 }, {
    variants: (ctx) =>
      usedOn(ctx, RARE).flatMap((c) => roomy(ctx.days.map((f) => sum(inCat(f.expenses, c.cat.id)))).map((amount) => ({ cat: c.cat, amount }))),
  }),
  {
    type: "cat-no-big-buy",
    name: "No big buys in a category",
    family: "big-buy",
    variants: (ctx) =>
      usedOn(ctx, RARE).flatMap((c) =>
        roomy(ctx.days.map((f) => Math.max(0, ...inCat(f.expenses, c.cat.id).map((e) => e.amount)) - 1)).map((amount) => ({ cat: c.cat, amount })),
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
    demo: { cat: FOOD, amount: 20_000 },
  },
  lessThanYesterday("less-cat-than-yesterday", "A category under yesterday's", undefined, RARE),
  {
    type: "no-cat",
    name: "Skipping a sometimes category",
    variants: (ctx) => rare(ctx).map((c) => ({ cat: c.cat })),
    build: (p) => ({
      type: "no-cat",
      title: `Skip ${label(p.cat!)} today`,
      catIds: [p.cat!.id],
      check(f) {
        const t = sum(inCat(f.expenses, p.cat!.id));
        return { ok: t === 0, note: t ? `${peso(t)} spent` : "none" };
      },
    }),
    demo: { cat: SHOPPING },
  },
  under("rare-cat-under", "Going easy on a sometimes category", undefined, (xs, p) => inCat(xs, p.cat!.id), (p) => `Keep ${label(p.cat!)} under ${peso(p.amount!)}`, { cat: SHOPPING, amount: 50_000 }, {
    variants: (ctx) => rare(ctx).flatMap((c) => roomy(ctx.days.map((f) => sum(inCat(f.expenses, c.cat.id)))).map((amount) => ({ cat: c.cat, amount }))),
  }),
  {
    type: "skip-either",
    name: "Skipping one of two, your pick",
    variants: (ctx) =>
      pairs(ctx.cats.filter((c) => c.days >= 2 && c.days <= 0.5 * ctx.days.length).slice(0, 5)).map(([a, b]) => ({ cat: a.cat, cat2: b.cat })),
    build: (p) => ({
      type: "skip-either",
      title: `Skip ${label(p.cat!)} or ${label(p.cat2!)} today, your pick`,
      catIds: [p.cat!.id, p.cat2!.id],
      check(f) {
        const a = sum(inCat(f.expenses, p.cat!.id));
        const b = sum(inCat(f.expenses, p.cat2!.id));
        return { ok: a === 0 || b === 0, note: a === 0 || b === 0 ? "one skipped" : "both bought" };
      },
    }),
    demo: { cat: SHOPPING, cat2: FUN },
  },
  under(
    "two-cats-under",
    "Two categories together",
    undefined,
    (xs, p) => xs.filter((e) => e.categoryId === p.cat!.id || e.categoryId === p.cat2!.id),
    (p) => `Keep ${label(p.cat!)} and ${label(p.cat2!)} under ${peso(p.amount!)} together`,
    { cat: FOOD, cat2: TRANSPORT, amount: 40_000 },
    {
      variants: (ctx) =>
        pairs(usedOn(ctx, RARE).slice(0, 4)).flatMap(([a, b]) =>
          roomy(ctx.days.map((f) => sum(inCat(f.expenses, a.cat.id)) + sum(inCat(f.expenses, b.cat.id)))).map((amount) => ({
            cat: a.cat,
            cat2: b.cat,
            amount,
          })),
        ),
    },
  ),
  under(
    "extras-under",
    "Sometimes buys together",
    undefined,
    (xs, p) => xs.filter((e) => p.cats!.some((c) => c.id === e.categoryId)),
    (p) => `Keep ${p.cats!.map((c) => c.emoji).join(" ")} under ${peso(p.amount!)} together`,
    { cats: [SHOPPING, FUN], amount: 50_000 },
    {
      variants: (ctx) => {
        const cats = rare(ctx).map((c) => c.cat);
        if (cats.length < 2) return [];
        const ids = new Set(cats.map((c) => c.id));
        return roomy(ctx.days.map((f) => sum(f.expenses.filter((e) => ids.has(e.categoryId!))))).map((amount) => ({ cats, amount }));
      },
    },
  ),
  {
    type: "person-under",
    name: "Everyone keeping it light",
    variants: (ctx) => (ctx.people >= 2 ? roomy(ctx.days.map((f) => perPersonMost(f.expenses) - 1)).map((amount) => ({ amount })) : []),
    build: (p) => ({
      type: "person-under",
      title: `No one spends over ${peso(p.amount!)} today`,
      catIds: [],
      check(f) {
        const most = perPersonMost(f.expenses);
        return { ok: most <= p.amount!, note: most ? `most ${peso(most)}` : "none" };
      },
    }),
    demo: { amount: 50_000 },
  },
  under(
    "merienda-under",
    "A light merienda",
    undefined,
    (xs) => xs.filter((e) => hour(e.spentAt) >= MERIENDA.from && hour(e.spentAt) < MERIENDA.to),
    (p) => `Keep merienda (2 to 5 pm) under ${peso(p.amount!)}`,
    { amount: 10_000 },
  ),
  under(
    "late-under",
    "A light late night",
    undefined,
    (xs) => xs.filter((e) => hour(e.spentAt) >= LATE),
    (p) => `Keep late night (after 9 pm) under ${peso(p.amount!)}`,
    { amount: 15_000 },
  ),
];

export const GENTLE_BY_TYPE: ReadonlyMap<string, AlignedDef> = new Map(GENTLE.map((d) => [d.type, d]));

/**
 * For a household still new (or one whose days fit too few missions): no big buy, a roomy count, and today under its
 * usual day as the medium one (₱1,500 until there are a few days to go on). Kept in the baseline next to the tried ones.
 */
export function starters(ctx: Ctx): Aligned[] {
  const out: Aligned[] = [
    { type: "no-big-buy", level: 1, params: { amount: 100_000 }, rate: 0, starter: true },
    { type: "few-buys", level: 1, params: { n: 6 }, rate: 0, starter: true },
  ];
  const amount = ctx.days.length >= 3 ? friendlyUp(median(dayTotals(ctx))) : 150_000;
  out.push({ type: "day-under", level: 2, params: { amount }, rate: 0, starter: true });
  return out;
}

/** Set 4's missions for a day: the household's tried ones (none until it has enough days), and the starters. Pure. */
export function alignGentle(ctx: Ctx): Aligned[] {
  return [...(ctx.days.length >= MIN_SPENDING_DAYS ? align(ctx, GENTLE, BANDS) : []), ...starters(ctx)];
}


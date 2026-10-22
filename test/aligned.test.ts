import { describe, expect, it } from "vitest";
import { ALIGNED, ALIGNED_BY_TYPE, MIN_SPENDING_DAYS, align, alignContext, clock, friendlyUp } from "../src/lib/aligned";
import { TEMPLATES, TYPE_NAMES, baseline, judgeDay, missionsFor, type CatInfo, type DayExpense } from "../src/lib/missions";
import { dayKey } from "../src/lib/time";

const DAY = 86_400_000;
const D = 20_382; // a Manila day key (a Wednesday)
const at = (d: number, h = 12, min = 0) => d * DAY - 8 * 3_600_000 + h * 3_600_000 + min * 60_000;
const CATS: CatInfo[] = [
  { id: 1, name: "Groceries", emoji: "🛒" },
  { id: 2, name: "Food", emoji: "🍜" },
  { id: 3, name: "Transport", emoji: "🚌" },
  { id: 4, name: "Shopping", emoji: "🛍️" },
  { id: 5, name: "Coffee", emoji: "☕" },
];
const spend = (d: number, categoryId: number | null, amount: number, h = 12, profileId = 1, min = 0): DayExpense => ({
  amount,
  categoryId,
  profileId,
  spentAt: at(d, h, min),
});

/** 35 days of a household with some day-to-day wobble. `late` moves its meals and coffee to the evening. */
function household(d: number, { late = false, seed = 7 } = {}): DayExpense[] {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: DayExpense[] = [];
  for (let k = 1; k <= 35; k++) {
    const day = d - k;
    if (r() < 0.1) continue; // a quiet day now and then
    out.push(spend(day, 2, 10_000 + Math.round(r() * 20_000), late ? 13 : 12));
    if (r() < 0.6) out.push(spend(day, 2, 8_000 + Math.round(r() * 10_000), late ? 22 : 19, 2));
    if (r() < 0.5) out.push(spend(day, 3, 5_000 + Math.round(r() * 5_000), late ? 10 : 7));
    if (r() < 0.3) out.push(spend(day, 1, 50_000 + Math.round(r() * 100_000), 17, 2));
    if (r() < 0.4) out.push(spend(day, 5, 12_000, late ? 23 : 9));
    if (r() < 0.1) out.push(spend(day, 4, 150_000, 15));
  }
  return out;
}

const ctxOf = (history: DayExpense[], d = D) => alignContext(history, d, CATS, dayKey);

describe("aligned missions", () => {
  it("each have a name for Wrapped and a guide example", () => {
    for (const def of ALIGNED) {
      expect(TYPE_NAMES[def.type], def.type).toBeTruthy();
      expect(def.build(def.demo).title, def.type).toBeTruthy();
    }
    expect(new Set(ALIGNED.map((d) => d.type)).size).toBe(ALIGNED.length);
  });

  it("are met on a day with no spending, whatever their setting", () => {
    const ctx = ctxOf(household(D));
    for (const def of ALIGNED) {
      for (const p of def.variants(ctx)) {
        const m = def.build(p);
        for (const f of ctx.days) expect(m.check({ expenses: [], yesterday: f.yesterday, lastWeek: f.lastWeek }).ok, `${m.title}`).toBe(true);
      }
    }
  });

  it("can only be broken by more spending, never mended by it", () => {
    const ctx = ctxOf(household(D));
    let s = 11;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const extra = () => spend(D, 1 + Math.floor(r() * 5), 1_000 + Math.round(r() * 60_000), Math.floor(r() * 24), 1 + Math.floor(r() * 2), Math.floor(r() * 60));
    for (const def of ALIGNED) {
      for (const p of def.variants(ctx)) {
        const m = def.build(p);
        for (const f of ctx.days.slice(0, 8)) {
          let day: DayExpense[] = [];
          let broken = false;
          for (let i = 0; i < 6; i++) {
            day = [...day, extra()];
            const ok = m.check({ expenses: day, yesterday: f.yesterday, lastWeek: f.lastWeek }).ok;
            if (broken) expect(ok, `${m.title} came back after breaking`).toBe(false);
            if (!ok) broken = true;
          }
        }
      }
    }
  });

  it("pick settings the household's own days meet about 7 of 10 times (easy) or 4 of 10 (medium)", () => {
    const picks = align(ctxOf(household(D)));
    expect(picks.length).toBeGreaterThan(10);
    for (const p of picks) {
      if (p.level === 1) expect(p.rate, p.type).toBeGreaterThanOrEqual(0.6);
      if (p.level === 1) expect(p.rate, p.type).toBeLessThanOrEqual(0.85);
      if (p.level === 2) expect(p.rate, p.type).toBeGreaterThanOrEqual(0.3);
      if (p.level === 2) expect(p.rate, p.type).toBeLessThanOrEqual(0.55);
    }
    // The easy amount is roomier than the medium one.
    const day = (level: number) => picks.find((p) => p.type === "day-under" && p.level === level)?.params.amount;
    if (day(1) && day(2)) expect(day(1)).toBeGreaterThan(day(2)!);
  });

  it("fit the household: a late household gets a later evening hour than an early one", () => {
    const hourFor = (late: boolean) => {
      const picks = align(ctxOf(household(D, { late })));
      return Math.max(...picks.filter((p) => p.type === "quiet-after").map((p) => p.params.hour!));
    };
    expect(hourFor(true)).toBeGreaterThan(hourFor(false));
    const morning = (late: boolean) => {
      const picks = align(ctxOf(household(D, { late })));
      return Math.min(...picks.filter((p) => p.type === "quiet-before").map((p) => p.params.hour!));
    };
    expect(morning(true)).toBeGreaterThan(morning(false));
  });

  it("aren't tried until the household has enough spending days: new ones get the starters", () => {
    const few = Array.from({ length: MIN_SPENDING_DAYS - 1 }, (_, k) => spend(D - 1 - k, 2, 15_000));
    const b = baseline(few, D, CATS, 3);
    expect(b.aligned).toEqual([]);
    const starters = new Set(TEMPLATES.filter((t) => !t.needsHistory).map((t) => t.type));
    for (let h = 1; h <= 30; h++) {
      const ms = missionsFor(h, D, b);
      expect(ms.length).toBeGreaterThanOrEqual(3);
      for (const m of ms) expect(starters.has(m.type)).toBe(true);
    }
  });

  it("make days of 3 to 5, two easy at least, no family or category twice, all from the household's own", () => {
    const families = new Map(ALIGNED.map((d) => [d.type, d.family]));
    for (let h = 1; h <= 30; h++) {
      for (let d = D; d < D + 7; d++) {
        const b = baseline(household(d, { seed: h }), d, CATS, 3);
        const ms = missionsFor(h, d, b);
        expect(ms.length).toBeGreaterThanOrEqual(3);
        expect(ms.length).toBeLessThanOrEqual(5);
        expect(ms.filter((m) => m.level === 1).length).toBeGreaterThanOrEqual(2);
        expect(ms.every((m) => ALIGNED_BY_TYPE.has(m.type))).toBe(true);
        const fams = ms.map((m) => families.get(m.type)).filter(Boolean);
        expect(new Set(fams).size).toBe(fams.length);
        const cats = ms.flatMap((m) => m.catIds);
        expect(new Set(cats).size).toBe(cats.length);
        expect(missionsFor(h, d, b).map((m) => m.title)).toEqual(ms.map((m) => m.title));
      }
    }
  });

  it("give an ordinary day about half its missions or more, and a splurge few", () => {
    const b = baseline(household(D), D, CATS, 3);
    const ms = missionsFor(3, D, b);
    const usual = judgeDay(ms, { expenses: [spend(D, 2, 15_000, 12), spend(D, 3, 6_000, 16)], yesterday: [], lastWeek: [] });
    expect(usual.done * 2).toBeGreaterThanOrEqual(usual.missions);
    const splurge = [spend(D, 4, 900_000, 6), spend(D, 2, 90_000, 13), spend(D, 1, 200_000, 21), spend(D, 5, 4_000, 23), spend(D, 3, 60_000, 13, 2, 5)];
    const big = judgeDay(ms, { expenses: splurge, yesterday: [spend(D - 1, 2, 15_000)], lastWeek: [spend(D - 7, 2, 15_000)] });
    expect(big.done * 2).toBeLessThan(big.missions);
  });
});

describe("helpers", () => {
  it("say hours the way people do", () => {
    expect([7, 12, 18, 23].map(clock)).toEqual(["7 am", "noon", "6 pm", "11 pm"]);
  });

  it("round limits up to friendly amounts", () => {
    expect(friendlyUp(12_340)).toBe(13_000);
    expect(friendlyUp(45_100)).toBe(50_000);
    expect(friendlyUp(123_000)).toBe(130_000);
    expect(friendlyUp(1)).toBe(1_000);
  });
});

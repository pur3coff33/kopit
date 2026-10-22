import { describe, expect, it } from "vitest";
import { alignContext } from "../src/lib/aligned";
import { GENTLE, GENTLE_BY_TYPE, alignGentle } from "../src/lib/gentle";
import { TYPE_NAMES, baseline, judgeDay, missionsFor, type CatInfo, type DayExpense } from "../src/lib/missions";
import { dayKey } from "../src/lib/time";

const DAY = 86_400_000;
const D = 20_382; // a Manila day key (a Tuesday)
const at = (d: number, h = 12, min = 0) => d * DAY - 8 * 3_600_000 + h * 3_600_000 + min * 60_000;
const CATS: CatInfo[] = [
  { id: 1, name: "Groceries", emoji: "🛒" },
  { id: 2, name: "Food", emoji: "🍜" },
  { id: 3, name: "Transport", emoji: "🚌" },
  { id: 4, name: "Shopping", emoji: "🛍️" },
  { id: 5, name: "Coffee", emoji: "☕" },
  { id: 6, name: "Fun", emoji: "🎮" },
];
const spend = (d: number, categoryId: number | null, amount: number, h = 12, profileId = 1, min = 0): DayExpense => ({
  amount,
  categoryId,
  profileId,
  spentAt: at(d, h, min),
});

/** A two-person household's spending on days [from, to), with day-to-day wobble and a few sometimes categories. */
function household(from: number, to: number, seed = 7): DayExpense[] {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: DayExpense[] = [];
  for (let day = from; day < to; day++) {
    if (r() < 0.1) continue;
    out.push(spend(day, 2, 10_000 + Math.round(r() * 20_000), 12));
    if (r() < 0.6) out.push(spend(day, 2, 8_000 + Math.round(r() * 10_000), 19, 2));
    if (r() < 0.5) out.push(spend(day, 3, 5_000 + Math.round(r() * 5_000), 7));
    if (r() < 0.3) out.push(spend(day, 1, 50_000 + Math.round(r() * 100_000), 17, 2));
    if (r() < 0.4) out.push(spend(day, 5, 12_000, 15));
    if (r() < 0.15) out.push(spend(day, 4, 80_000 + Math.round(r() * 100_000), 15));
    if (r() < 0.12) out.push(spend(day, 6, 30_000 + Math.round(r() * 30_000), 21, 2));
  }
  return out;
}

const ctxOf = (history: DayExpense[], d = D) => alignContext(history, d, CATS, dayKey);
const on = (all: DayExpense[], d: number) => all.filter((e) => dayKey(e.spentAt) === d);

describe("gentle missions (rule set 4)", () => {
  it("each have their own type, a name for Wrapped and a guide example", () => {
    expect(new Set(GENTLE.map((d) => d.type)).size).toBe(GENTLE.length);
    for (const def of GENTLE) {
      expect(TYPE_NAMES[def.type], def.type).toBeTruthy();
      expect(def.build(def.demo).title, def.type).toBeTruthy();
    }
  });

  it("are only about amounts: no time bans, no who-spends, no spacing, no one-buy days", () => {
    const titles = GENTLE.map((d) => d.build(d.demo).title).join("\n");
    for (const pushy of ["Nothing spent", "Only one of you", "within", "Just one", "twice", "categories"]) expect(titles).not.toContain(pushy);
  });

  it("are met on a day with no spending, whatever their setting", () => {
    for (const d of [D, D + 4, D + 5]) {
      const ctx = ctxOf(household(D - 40, d), d);
      for (const def of GENTLE) {
        for (const p of def.variants(ctx)) {
          const m = def.build(p);
          for (const f of ctx.days) expect(m.check({ expenses: [], yesterday: f.yesterday, lastWeek: f.lastWeek }).ok, m.title).toBe(true);
        }
      }
    }
  });

  it("can only be broken by more spending, never mended by it", () => {
    const ctx = ctxOf(household(D - 40, D));
    let s = 11;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const extra = () => spend(D, 1 + Math.floor(r() * 6), 1_000 + Math.round(r() * 60_000), Math.floor(r() * 24), 1 + Math.floor(r() * 2), Math.floor(r() * 60));
    for (const def of GENTLE) {
      for (const p of def.variants(ctx)) {
        const m = def.build(p);
        for (const f of ctx.days.slice(0, 6)) {
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

  it("pick settings the household's own days meet about 9 of 10 times (easy) or 6 of 10 (medium)", () => {
    const picks = alignGentle(ctxOf(household(D - 40, D))).filter((p) => !p.starter);
    expect(picks.length).toBeGreaterThan(10);
    for (const p of picks) {
      if (p.level === 1) expect(p.rate, p.type).toBeGreaterThanOrEqual(0.8);
      if (p.level === 1) expect(p.rate, p.type).toBeLessThanOrEqual(0.97);
      if (p.level === 2) expect(p.rate, p.type).toBeGreaterThanOrEqual(0.5);
      if (p.level === 2) expect(p.rate, p.type).toBeLessThanOrEqual(0.72);
    }
  });

  it("make days of exactly 3, two easy and one medium, no family or category twice, the same on every phone", () => {
    const families = new Map(GENTLE.map((d) => [d.type, d.family]));
    for (let h = 1; h <= 20; h++) {
      const all = household(D - 60, D + 14, h);
      for (let d = D; d < D + 14; d++) {
        const b = baseline(all.filter((e) => dayKey(e.spentAt) < d), d, CATS);
        const ms = missionsFor(h, d, b);
        expect(ms).toHaveLength(3);
        expect(ms.filter((m) => m.level === 1).length).toBeGreaterThanOrEqual(2);
        expect(ms.every((m) => GENTLE_BY_TYPE.has(m.type))).toBe(true);
        const fams = ms.map((m) => families.get(m.type)).filter(Boolean);
        expect(new Set(fams).size).toBe(fams.length);
        const cats = ms.flatMap((m) => m.catIds);
        expect(new Set(cats).size).toBe(cats.length);
        expect(missionsFor(h, d, b).map((m) => m.title)).toEqual(ms.map((m) => m.title));
      }
    }
  });

  it("grow a leaf on most ordinary days, and not on a splurge", () => {
    let good = 0;
    let days = 0;
    for (let h = 1; h <= 10; h++) {
      const all = household(D - 60, D + 30, h);
      for (let d = D; d < D + 30; d++) {
        const r = judgeDay(missionsFor(h, d, baseline(all.filter((e) => dayKey(e.spentAt) < d), d, CATS)), {
          expenses: on(all, d),
          yesterday: on(all, d - 1),
          lastWeek: on(all, d - 7),
        });
        days++;
        if (r.done * 2 >= r.missions) good++;
      }
    }
    expect(good / days).toBeGreaterThan(0.75);

    const all = household(D - 40, D);
    const splurge = [spend(D, 4, 900_000, 15), spend(D, 2, 90_000, 13), spend(D, 1, 200_000, 17, 2), spend(D, 6, 60_000, 22, 2), spend(D, 3, 60_000, 7)];
    for (let h = 1; h <= 10; h++) {
      const big = judgeDay(missionsFor(h, D, baseline(all, D, CATS)), { expenses: splurge, yesterday: on(all, D - 1), lastWeek: on(all, D - 7) });
      expect(big.done * 2, `household ${h}`).toBeLessThan(big.missions);
    }
  });

  it("give a new household the starters: no big buy, a roomy count, and today under ₱1,500", () => {
    const b = baseline([spend(D - 1, 2, 15_000)], D, CATS);
    expect(missionsFor(1, D, b).map((m) => m.title).sort()).toEqual(["At most 6 buys today", "Keep today under ₱1,500", "No single buy over ₱1,000"]);
  });

  it("go by the household's usual day once it has a few", () => {
    const few = [D - 1, D - 2, D - 3, D - 4].map((d) => spend(d, 2, 42_000));
    expect(missionsFor(1, D, baseline(few, D, CATS)).map((m) => m.title)).toContain("Keep today under ₱450");
  });

  it("only skip categories the household buys now and then", () => {
    const ctx = ctxOf(household(D - 40, D));
    const skipped = GENTLE_BY_TYPE.get("no-cat")!.variants(ctx).map((p) => p.cat!.name);
    expect(skipped).not.toContain("Food");
    expect(skipped).toContain("Shopping");
  });

  it("count the week's earlier spending as it was when the day's missions were set", () => {
    const def = GENTLE_BY_TYPE.get("week-under")!;
    const monday = D - 1;
    const ctx = ctxOf(household(D - 40, D));
    expect(ctx.weekBefore).toBe(on(household(D - 40, D), monday).reduce((s, e) => s + e.amount, 0));
    for (const p of def.variants(ctx)) {
      expect(p.n).toBe(ctx.weekBefore);
      const m = def.build(p);
      expect(m.check({ expenses: [spend(D, 2, p.amount! - p.n! - 1)], yesterday: [], lastWeek: [] }).ok).toBe(true);
      expect(m.check({ expenses: [spend(D, 2, p.amount! - p.n!)], yesterday: [], lastWeek: [] }).ok).toBe(false);
    }
    // On a Monday the week hasn't started: it's just "today under", so it isn't given.
    expect(def.variants(ctxOf(household(D - 40, monday), monday))).toEqual([]);
  });

  it("give payday ones only on the 15th and the month's last day, weekend ones only on weekends", () => {
    const has = (type: string, d: number) => GENTLE_BY_TYPE.get(type)!.variants(ctxOf(household(d - 40, d), d)).length > 0;
    const oct = (date: number) => D + (date - 21); // D is 2025-10-21
    expect(has("payday-under", oct(15))).toBe(true);
    expect(has("payday-under", oct(31))).toBe(true);
    expect(has("payday-under", oct(30))).toBe(false);
    expect(has("weekend-under", D + 4)).toBe(true); // Saturday
    expect(has("weekend-under", D + 2)).toBe(false); // Thursday
  });

  it("let either category be the one skipped", () => {
    const m = GENTLE_BY_TYPE.get("skip-either")!.build({ cat: CATS[3], cat2: CATS[5] });
    expect(m.title).toBe("Skip 🛍️ Shopping or 🎮 Fun today, your pick");
    expect(m.check({ expenses: [spend(D, 4, 50_000)], yesterday: [], lastWeek: [] }).ok).toBe(true);
    expect(m.check({ expenses: [spend(D, 6, 50_000)], yesterday: [], lastWeek: [] }).ok).toBe(true);
    expect(m.check({ expenses: [spend(D, 4, 50_000), spend(D, 6, 1_000)], yesterday: [], lastWeek: [] }).ok).toBe(false);
  });
});

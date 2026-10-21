import { describe, expect, it } from "vitest";
import { TEMPLATES, TYPE_NAMES, baseline, friendly, judgeDay, missionsFor, type CatInfo, type DayExpense } from "../src/lib/missions";

const DAY = 86_400_000;
const D = 20_382; // a Manila day key (2025-10-22)
/** Manila hour `h` on day key `d`. */
const at = (d: number, h = 12) => d * DAY - 8 * 3_600_000 + h * 3_600_000;
const CATS: CatInfo[] = [
  { id: 1, name: "Groceries", emoji: "🛒" },
  { id: 2, name: "Food", emoji: "🍜" },
  { id: 3, name: "Transport", emoji: "🚌" },
  { id: 4, name: "Shopping", emoji: "🛍️" },
  { id: 5, name: "Coffee", emoji: "☕" },
  { id: 6, name: "Bills", emoji: "💡" },
];
const spend = (d: number, categoryId: number | null, amount: number, h = 12, profileId = 1): DayExpense => ({ amount, categoryId, profileId, spentAt: at(d, h) });

/** 28 days of a believable household before day `d`. */
function history(d: number): DayExpense[] {
  const out: DayExpense[] = [];
  for (let k = 1; k <= 28; k++) {
    const day = d - k;
    out.push(spend(day, 2, 15_000, 12));
    if (k % 2) out.push(spend(day, 1, 40_000, 18, 2));
    if (k % 3 === 0) out.push(spend(day, 3, 8_000, 8));
    if (k % 5 === 0) out.push(spend(day, 4, 120_000, 15, 2));
    if (k % 4 === 0) out.push(spend(day, 5, 12_000, 9));
    if (k % 10 === 0) out.push(spend(day, 6, 300_000, 10));
  }
  return out;
}

const rich = (d: number, cats = CATS) => baseline(history(d), d, cats);

describe("mission rules", () => {
  it("has 20 rule types, 11 of them easy, easy or medium only, each with its own name", () => {
    expect(TEMPLATES).toHaveLength(20);
    expect(new Set(TEMPLATES.map((t) => t.type)).size).toBe(20);
    expect(TEMPLATES.filter((t) => t.level === 1)).toHaveLength(11);
    for (const t of TEMPLATES) expect(t.level, t.type).toBeLessThanOrEqual(2);
    for (const t of TEMPLATES) expect(TYPE_NAMES[t.type], t.type).toBeTruthy();
  });

  it("rounds amounts to friendly numbers, always down", () => {
    expect(friendly(18_700)).toBe(18_000);
    expect(friendly(73_500)).toBe(70_000);
    expect(friendly(123_400)).toBe(120_000);
    expect(friendly(300)).toBe(1_000); // never below ₱10
  });

  it("keeps a category under a personal limit and says how far along it is", () => {
    const m = TEMPLATES.find((t) => t.type === "cat-under")!.make(rich(D), () => 0)!;
    expect(m.title).toBe("Keep 🍜 Food under ₱150");
    expect(m.check({ expenses: [spend(D, 2, 12_000)], yesterday: [], lastWeek: [] })).toEqual({ ok: true, note: "₱120 so far" });
    expect(m.check({ expenses: [spend(D, 2, 16_000)], yesterday: [], lastWeek: [] }).ok).toBe(false);
  });

  it("has roomier easy versions of the day and category limits", () => {
    const day = TEMPLATES.find((t) => t.type === "day-under-roomy")!.make(rich(D), () => 0)!;
    const usual = TEMPLATES.find((t) => t.type === "day-under-usual")!.make(rich(D), () => 0)!;
    expect(usual.title).toBe("Keep today under your usual ₱800");
    expect(day.title).toBe("Keep today under ₱1,200");
    expect(day.check({ expenses: [spend(D, 2, 110_000)], yesterday: [], lastWeek: [] }).ok).toBe(true);
    expect(day.check({ expenses: [spend(D, 2, 120_000)], yesterday: [], lastWeek: [] }).ok).toBe(false);
    const cat = TEMPLATES.find((t) => t.type === "cat-under-roomy")!.make(rich(D), () => 0)!;
    expect(cat.title).toBe("Keep 🍜 Food under ₱200"); // 1.5 × ₱150, rounded down to a friendly amount
  });

  it("keeps late nights and early mornings quiet", () => {
    const night = TEMPLATES.find((t) => t.type === "quiet-night")!.make(rich(D), () => 0)!;
    const early = TEMPLATES.find((t) => t.type === "quiet-early")!.make(rich(D), () => 0)!;
    expect(night.title).toBe("Nothing spent after 10 pm");
    expect(early.title).toBe("Nothing spent before 8 am");
    const day = (h: number) => ({ expenses: [spend(D, 2, 5_000, h)], yesterday: [], lastWeek: [] });
    expect(night.check(day(21)).ok).toBe(true);
    expect(night.check(day(22)).ok).toBe(false);
    expect(early.check(day(8)).ok).toBe(true);
    expect(early.check(day(7)).ok).toBe(false);
  });

  it("counts categories and buys per category", () => {
    const three = TEMPLATES.find((t) => t.type === "three-cats")!.make(rich(D), () => 0)!;
    const twice = TEMPLATES.find((t) => t.type === "cat-two-buys")!.make(rich(D), () => 0)!;
    const facts = (...cats: (number | null)[]) => ({ expenses: cats.map((c) => spend(D, c, 5_000)), yesterday: [], lastWeek: [] });
    expect(three.check(facts(1, 2, 3, 3)).ok).toBe(true);
    expect(three.check(facts(1, 2, 3, null)).ok).toBe(false);
    expect(twice.check(facts(1, 1, 2, 2))).toEqual({ ok: true, note: "most in one: 2" });
    expect(twice.check(facts(1, 2, 2, 2)).ok).toBe(false);
    expect(twice.check(facts()).note).toBe("none yet");
  });

  it("only compares with yesterday when yesterday had spending", () => {
    const t = TEMPLATES.find((x) => x.type === "less-than-yesterday")!;
    const quietYesterday = baseline(history(D).filter((e) => e.spentAt < at(D - 1, 0)), D, CATS);
    expect(t.make({ ...quietYesterday, yesterdayTotal: 0 }, () => 0)).toBeNull();
  });
});

describe("a day's missions", () => {
  it("are the same on every phone for the same household and day", () => {
    const b = rich(D);
    expect(missionsFor(7, D, b).map((m) => m.title)).toEqual(missionsFor(7, D, b).map((m) => m.title));
  });

  it("number 3 to 5, mix easy and medium (never hard), and never repeat a rule", () => {
    const counts = new Set<number>();
    for (let h = 1; h <= 30; h++) {
      for (let d = D; d < D + 10; d++) {
        const ms = missionsFor(h, d, rich(d));
        counts.add(ms.length);
        expect(ms.length).toBeGreaterThanOrEqual(3);
        expect(ms.length).toBeLessThanOrEqual(5);
        expect(ms.some((m) => m.level === 1)).toBe(true);
        expect(ms.every((m) => m.level <= 2)).toBe(true);
        expect(new Set(ms.map((m) => m.type)).size).toBe(ms.length);
      }
    }
    expect([...counts].sort()).toEqual([3, 4, 5]);
  });

  it("include at least two easy ones, and never two from the same family", () => {
    const family = new Map(TEMPLATES.map((t) => [t.type, t.family]));
    for (let h = 1; h <= 30; h++) {
      for (let d = D; d < D + 10; d++) {
        const ms = missionsFor(h, d, rich(d));
        expect(ms.filter((m) => m.level === 1).length).toBeGreaterThanOrEqual(2);
        const fams = ms.map((m) => family.get(m.type)).filter(Boolean);
        expect(new Set(fams).size).toBe(fams.length);
      }
    }
  });

  it("give a new household only rules that need no history", () => {
    const fresh = baseline([spend(D - 2, 2, 15_000)], D, CATS);
    expect(fresh.historyDays).toBeLessThan(14);
    const allowed = new Set(TEMPLATES.filter((t) => !t.needsHistory).map((t) => t.type));
    for (let h = 1; h <= 40; h++) for (const m of missionsFor(h, D, fresh)) expect(allowed.has(m.type)).toBe(true);
  });

  it("never pick a hidden category", () => {
    const visible = CATS.filter((c) => c.id !== 4);
    for (let h = 1; h <= 40; h++) {
      for (const m of missionsFor(h, D, rich(D, visible))) expect(m.title).not.toContain("Shopping");
    }
  });

  it("are all done on a day with no spending", () => {
    for (let h = 1; h <= 30; h++) {
      for (let d = D; d < D + 10; d++) {
        const ms = missionsFor(h, d, rich(d));
        const r = judgeDay(ms, { expenses: [], yesterday: [spend(d - 1, 2, 15_000)], lastWeek: [spend(d - 7, 2, 15_000)] });
        expect(r.done).toBe(r.missions);
      }
    }
  });

  it("count a big spending day as mostly not done", () => {
    const ms = missionsFor(3, D, rich(D));
    const splurge = [
      spend(D, 4, 900_000, 9),
      spend(D, 2, 90_000, 13),
      spend(D, 1, 200_000, 21),
      spend(D, 5, 4_000, 22),
      spend(D, 3, 60_000, 7),
      spend(D, 6, 500_000, 11),
    ];
    const r = judgeDay(ms, { expenses: splurge, yesterday: [spend(D - 1, 2, 15_000)], lastWeek: [spend(D - 7, 2, 15_000)] });
    expect(r.done * 2).toBeLessThan(r.missions);
  });
});

describe("days stored before the easier set (rule set 1)", () => {
  /** A baseline as stored in day_missions before rule sets existed: no `rules` field. */
  const stored = (d: number) => {
    const { rules: _, ...b } = rich(d) as ReturnType<typeof rich> & { rules?: number };
    return b;
  };

  it("keep exactly the missions they were first given", () => {
    const draw = [1, 2, 3, 7].flatMap((h) => [D, D + 1, D + 2].map((d) => missionsFor(h, d, stored(d)).map((m) => m.title).join(" | ")));
    expect(draw).toMatchInlineSnapshot(`
      [
        "Nothing spent before 10 am | No 💡 Bills and no 🛍️ Shopping today | Keep today under your usual ₱800 | Nothing spent after 8 pm | Spend in at most 2 categories",
        "At most 2 expenses today | Nothing spent before 10 am | No small buys under ₱50 | No single buy over ₱400 | Keep today under your usual ₱800",
        "Nothing spent before 10 am | Spend less than yesterday | No single buy over ₱400",
        "Keep 🚌 Transport under ₱80 | No single buy over ₱400 | At most 2 expenses today | Nothing spent after 8 pm",
        "Nothing spent before 10 am | Spend in at most 2 categories | Keep 🚌 Transport under ₱50 | No 💡 Bills today",
        "Keep ☕ Coffee under ₱120 | Keep today under your usual ₱800 | Spend less than last Thursday | Spend in at most 2 categories | No 💡 Bills today",
        "Keep ☕ Coffee under ₱120 | No single buy over ₱400 | Keep today under your usual ₱800 | Spend less than last Tuesday",
        "No 💡 Bills today | No small buys under ₱50 | Keep 🛒 Groceries under ₱400 | Spend less than yesterday",
        "Keep ☕ Coffee under ₱120 | Keep today under your usual ₱800 | No small buys under ₱50 | Nothing spent after 8 pm",
        "Nothing spent before 10 am | Keep 🛍️ Shopping under ₱800 | Spend less than last Tuesday | Keep today under your usual ₱800",
        "No 🚌 Transport today | Spend less than yesterday | Nothing spent before 10 am | Keep today under your usual ₱800 | Spend less than last Wednesday",
        "At most 2 expenses today | Keep today under your usual ₱800 | Spend less than last Thursday",
      ]
    `);
  });
});

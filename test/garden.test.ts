import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dayMissions, gardenDays } from "../src/db/schema";
import { deleteEntry, insertEntry, updateEntry } from "../src/lib/entries";
import { dayResults, frozenBaselines, gardenMonths, monthGarden, todayGarden, todayMissions, wholePastMonth } from "../src/lib/garden";
import type { Aligned } from "../src/lib/aligned";
import { RULES, baseline } from "../src/lib/missions";
import { dayKey, resolveRange } from "../src/lib/time";
import { addEntry, db, seedHousehold } from "./helpers";

const now = Date.UTC(2026, 9, 21, 4); // Wed Oct 21, 12:00 Manila
const manila = (m: number, d: number, h = 12) => Date.UTC(2026, m, d, h - 8);
const monthOf = (m: number) => manila(m, 1, 0); // Manila midnight on the 1st
const cached = async (householdId: number) =>
  (await db().select().from(gardenDays).where(eq(gardenDays.householdId, householdId))).length;

/** A day that breaks every mission a new household can get: early, late, big, tiny, many buys, many categories. */
async function splurge(h: Awaited<ReturnType<typeof seedHousehold>>, m: number, d: number) {
  const cats = ["Groceries", "Eating out", "Transport", "Bills", "Household", "Shopping"];
  const amounts = [500_000, 4_000, 90_000, 200_000, 60_000, 120_000];
  for (let i = 0; i < cats.length; i++) await addEntry(h, { amount: amounts[i], at: manila(m, d, 7 + i * 3), category: cats[i] });
}

describe("day results", () => {
  it("count a quiet day as perfect and a splurge as not good, and keep them", async () => {
    const created = manila(9, 1, 9);
    const h = await seedHousehold({ createdAt: created });
    await splurge(h, 9, 10);
    const days = await dayResults(env, h.householdId, created, dayKey(monthOf(9)), dayKey(now), now);
    expect(days.size).toBe(20); // Oct 1–20; today isn't over
    const quiet = days.get(dayKey(manila(9, 9)))!;
    expect(quiet.done).toBe(quiet.missions);
    expect(quiet.missions).toBeGreaterThanOrEqual(3);
    expect(days.get(dayKey(manila(9, 10)))!.done).toBe(0);
    expect(await cached(h.householdId)).toBe(20);
  });

  it("are cleared and recomputed when an older expense is added, edited or deleted", async () => {
    const created = manila(9, 1, 9);
    const h = await seedHousehold({ createdAt: created });
    const range = [dayKey(monthOf(9)), dayKey(now)] as const;
    const oct5 = dayKey(manila(9, 5));
    expect((await dayResults(env, h.householdId, created, ...range, now)).get(oct5)!.done).toBeGreaterThan(0);

    const id = crypto.randomUUID();
    await insertEntry(env, h.householdId, { id, profileId: h.profileIds[0], categoryId: null, amountCentavos: 500_000, spentAt: manila(9, 5, 7) }, now);
    const afterInsert = (await dayResults(env, h.householdId, created, ...range, now)).get(oct5)!;
    expect(afterInsert.done).toBeLessThan(afterInsert.missions);

    await updateEntry(env, h.householdId, id, { spentAt: manila(9, 15, 7) }, now);
    const moved = await dayResults(env, h.householdId, created, ...range, now);
    expect(moved.get(oct5)!.done).toBe(moved.get(oct5)!.missions); // Oct 5 is quiet again
    expect(moved.get(dayKey(manila(9, 15)))!.done).toBeLessThan(moved.get(dayKey(manila(9, 15)))!.missions);

    await deleteEntry(env, h.householdId, id, now);
    const oct15 = (await dayResults(env, h.householdId, created, ...range, now)).get(dayKey(manila(9, 15)))!;
    expect(oct15.done).toBe(oct15.missions);
  });

  it("only forget the edited day and the two that compare with it (the next day, a week later)", async () => {
    const created = manila(9, 1, 9);
    const h = await seedHousehold({ createdAt: created });
    await dayResults(env, h.householdId, created, dayKey(monthOf(9)), dayKey(now), now);
    const id = await addEntry(h, { amount: 5_000, at: manila(9, 5), category: "Eating out" });
    await deleteEntry(env, h.householdId, id, now);
    const left = (await db().select().from(gardenDays).where(eq(gardenDays.householdId, h.householdId))).map((r) => r.day);
    const oct = (d: number) => dayKey(manila(9, d));
    expect(left).toHaveLength(17);
    expect(left).not.toContain(oct(5));
    expect(left).not.toContain(oct(6));
    expect(left).not.toContain(oct(12));
  });

  it("aren't cached while an expense was just written, so a write racing the calculation can't leave a stale day", async () => {
    const wallNow = Date.now();
    const created = wallNow - 10 * 86_400_000;
    const h = await seedHousehold({ createdAt: created });
    // An offline expense from last night, synced this very moment (as a phone does when it opens in the morning).
    await insertEntry(env, h.householdId, { id: crypto.randomUUID(), profileId: h.profileIds[0], categoryId: null, amountCentavos: 500_000, spentAt: wallNow - 86_400_000 }, wallNow);
    const days = await dayResults(env, h.householdId, created, dayKey(created), dayKey(wallNow), wallNow);
    expect(days.size).toBe(10); // still worked out and shown...
    expect(await cached(h.householdId)).toBe(0); // ...but not kept until the write has settled
  });

  it("fill in at most 31 new days per request (a month's work keeps well inside the CPU limit)", async () => {
    const created = now - 100 * 86_400_000;
    const h = await seedHousehold({ createdAt: created });
    const from = dayKey(created);
    const sizes = [];
    for (let i = 0; i < 4; i++) sizes.push((await dayResults(env, h.householdId, created, from, dayKey(now), now)).size);
    expect(sizes).toEqual([31, 62, 93, 100]);
    const rows = await db().select().from(gardenDays).where(and(eq(gardenDays.householdId, h.householdId)));
    expect(rows).toHaveLength(100);
  });
});

describe("monthGarden", () => {
  it("counts good and perfect days since the household began", async () => {
    const created = manila(9, 1, 9);
    const h = await seedHousehold({ createdAt: created });
    await splurge(h, 9, 10);
    const g = await monthGarden(env, h.householdId, monthOf(9), created, now);
    expect(g.goodDays).toBe(19);
    expect(g.perfectDays).toBe(19);
    expect(g.missionsDone).toBeGreaterThanOrEqual(19 * 3);
  });

  it("blooms a finished month only when lower than the month before", async () => {
    const created = manila(6, 1);
    const lower = await seedHousehold({ createdAt: created });
    await addEntry(lower, { amount: 50000, at: manila(7, 10), category: "Eating out" });
    await addEntry(lower, { amount: 40000, at: manila(8, 10), category: "Eating out" });
    expect(await monthGarden(env, lower.householdId, monthOf(8), created, now)).toMatchObject({ bloomed: true, prevTotal: 50000, total: 40000 });

    const same = await seedHousehold({ createdAt: created });
    await addEntry(same, { amount: 50000, at: manila(7, 10), category: "Eating out" });
    await addEntry(same, { amount: 50000, at: manila(8, 10), category: "Eating out" });
    expect((await monthGarden(env, same.householdId, monthOf(8), created, now)).bloomed).toBe(false);

    const noAugust = await seedHousehold({ createdAt: created });
    await addEntry(noAugust, { amount: 40000, at: manila(8, 10), category: "Eating out" });
    expect(await monthGarden(env, noAugust.householdId, monthOf(8), created, now)).toMatchObject({ prevTotal: null, bloomed: false });
  });
});

describe("wholePastMonth", () => {
  it("recognises a finished calendar month", () => {
    const september = monthOf(8);
    expect(wholePastMonth(resolveRange("last", now), now)).toBe(september);
    expect(wholePastMonth(resolveRange("custom", now, "2026-09-01", "2026-09-30"), now)).toBe(september);
    expect(wholePastMonth(resolveRange("custom", now, "2026-09-02", "2026-09-30"), now)).toBeNull();
    expect(wholePastMonth(resolveRange("this", now), now)).toBeNull();
  });
});

describe("gardenMonths", () => {
  it("lists every month since the household began, this one last", async () => {
    const created = manila(6, 15);
    const h = await seedHousehold({ createdAt: created });
    const months = await gardenMonths(env, h.householdId, created, now);
    expect(months.map((m) => m.start)).toEqual([monthOf(6), monthOf(7), monthOf(8), monthOf(9)]);
  });
});

describe("today", () => {
  it("never names a need in a mission", async () => {
    const h = await seedHousehold({ createdAt: manila(8, 15) });
    // Three weeks of everyday spending that varies from day to day, so missions can be tried on it.
    for (let d = 1; d <= 20; d++) {
      const k = 5 + ((d * 7) % 11); // 5..15, a different mix each day
      await addEntry(h, { amount: k * 8_000, at: manila(9, d, 9), category: "Groceries" });
      await addEntry(h, { amount: (20 - k) * 9_000, at: manila(9, d, 10), category: "Bills" });
      await addEntry(h, { amount: k * 1_500, at: manila(9, d, 11), category: "Transport" });
      await addEntry(h, { amount: (25 - k) * 2_000, at: manila(9, d, 12), category: "Eating out" });
      if (d % 3 === 0) await addEntry(h, { amount: k * 5_000, at: manila(9, d, 16), category: "Shopping" });
    }
    const { items } = await todayMissions(env, h.householdId, now);
    for (const m of items) for (const e of ["🛒", "💡", "🚌", "💊", "📚", "🧴"]) expect(m.title).not.toContain(e);
    const [row] = await db().select().from(dayMissions).where(and(eq(dayMissions.householdId, h.householdId), eq(dayMissions.day, dayKey(now))));
    const picked = (JSON.parse(row.baseline).gentle as Aligned[]).flatMap((a) => [a.params.cat, a.params.cat2, ...(a.params.cats ?? [])]);
    const ids = picked.filter((c) => c !== undefined).map((c) => c!.id);
    expect(ids.length).toBeGreaterThan(0); // some missions were about a category at all
    const wants = ["Eating out", "Shopping", "Fun & outings", "Gifts & occasions"].map((n) => h.categoryIds[n]);
    expect(ids.every((id) => wants.includes(id))).toBe(true);
  });

  it("lists today's missions, on track until broken", async () => {
    const created = manila(9, 1, 9);
    const h = await seedHousehold({ createdAt: created });
    const quiet = await todayMissions(env, h.householdId, now);
    expect(quiet.items.length).toBeGreaterThanOrEqual(3);
    expect(quiet.items.every((m) => m.status === "track")).toBe(true);
    expect(quiet.onTrack).toBe(quiet.items.length);
    await splurge(h, 9, 21);
    const after = await todayMissions(env, h.householdId, manila(9, 21, 23));
    expect(after.items.some((m) => m.status === "missed")).toBe(true);
  });

  it("are fixed at the day's first open: older expenses changing later don't change them", async () => {
    const h = await seedHousehold({ createdAt: manila(9, 1, 9) });
    const titles = async () => (await todayMissions(env, h.householdId, now)).items.map((m) => m.title);
    const first = await titles();
    // Three weeks of back-dated history arrives after the first open.
    for (let d = 1; d <= 20; d++) await addEntry(h, { amount: 15_000, at: manila(9, d), category: "Eating out" });
    expect(await titles()).toEqual(first);
    // Without the stored copy, today's missions would have come out differently.
    await db().delete(dayMissions).where(eq(dayMissions.householdId, h.householdId));
    expect(await titles()).not.toEqual(first);
  });

  it("move today alone up to the current rule set: past days keep the missions they were given", async () => {
    const h = await seedHousehold({ createdAt: manila(9, 1, 9) });
    const today = dayKey(now);
    const old = (day: number) => ({ ...baseline([], day, []), rules: 2, usualCount: 9 });
    await frozenBaselines(env, h.householdId, [today - 1, today], old);
    await todayMissions(env, h.householdId, now);
    const stored = new Map(
      (await db().select().from(dayMissions).where(eq(dayMissions.householdId, h.householdId))).map((r) => [r.day, JSON.parse(r.baseline)]),
    );
    expect(stored.get(today).rules).toBe(RULES);
    expect(stored.get(today - 1)).toMatchObject({ rules: 2, usualCount: 9 });
    // Only once: a second open reads the upgraded copy back.
    const again = await frozenBaselines(env, h.householdId, [today], () => ({ ...baseline([], today, []), usualCount: 5 }), today);
    expect(again.get(today)).toEqual(stored.get(today));
  });

  it("are the same for two phones opening at once, and stored once", async () => {
    const h = await seedHousehold({ createdAt: manila(9, 1, 9) });
    const today = dayKey(now);
    const make = (usualCount: number) => (day: number) => ({ ...baseline([], day, []), usualCount });
    const [a, b] = await Promise.all([
      frozenBaselines(env, h.householdId, [today], make(1)),
      frozenBaselines(env, h.householdId, [today], make(2)),
    ]);
    expect(a.get(today)).toEqual(b.get(today));
    const [x, y] = await Promise.all([todayMissions(env, h.householdId, now), todayMissions(env, h.householdId, now)]);
    expect(x.items).toEqual(y.items);
    expect(await db().select().from(dayMissions).where(eq(dayMissions.householdId, h.householdId))).toHaveLength(1);
  });

  it("celebrates yesterday's leaf and knows when last month's Wrapped is due", async () => {
    const created = manila(9, 1, 9);
    const h = await seedHousehold({ createdAt: created });
    expect(await todayGarden(env, h.householdId, created, now)).toMatchObject({
      today: "2026-10-21",
      leafDay: "2026-10-20",
      perfect: true,
      leafNumber: 20, // Oct 1–20, all quiet
      leafMonth: "October",
      leafMonthIsCurrent: true,
      wrappedMonth: null, // September was before the household
    });

    const nov1 = Date.UTC(2026, 10, 1, 4);
    await splurge(h, 9, 31);
    expect(await todayGarden(env, h.householdId, created, nov1)).toMatchObject({ leafDay: null, wrappedMonth: "2026-10", leafMonthIsCurrent: false });
  });
});

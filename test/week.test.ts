import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { entries, profiles } from "../src/db/schema";
import { todayGarden } from "../src/lib/garden";
import { DAY_MS, dayKey, monthStart, toDateInput, weekStart } from "../src/lib/time";
import { historyItems, placeRecaps, recapRows } from "../src/routes/history";
import { finishedWeek, weekRecap } from "../src/lib/week";
import { addEntry, authCookie, db, html, req, seedHousehold } from "./helpers";

type H = Awaited<ReturnType<typeof seedHousehold>>;

async function spend(h: H, amount: number, at: number, category: string | null, note?: string) {
  const id = await addEntry(h, { amount, at, category });
  if (note) await db().update(entries).set({ note }).where(eq(entries.id, id));
}

/**
 * A household with the week before last at ₱6,000 and last week (Monday `mon`) at ₱4,170: Groceries ₱1,900 (Wet
 * market), Meals 4 × ₱287.50 (Office lunch), Eating out ₱820 (Jollibee), Bills ₱300, all Monday to Friday.
 */
async function weeks(mon: number) {
  const h = await seedHousehold({ createdAt: mon - 21 * DAY_MS });
  const at = (day: number, hour = 12) => mon + day * DAY_MS + (hour - 8) * 3_600_000 + 8 * 3_600_000;
  await spend(h, 600_000, at(-5), "Groceries");
  await spend(h, 190_000, at(0), "Groceries", "Wet market");
  for (let d = 0; d < 4; d++) await spend(h, 28_750, at(d, 13), "Meals", "Office lunch");
  await spend(h, 82_000, at(2, 19), "Eating out", "Jollibee");
  await spend(h, 30_000, at(4), "Bills");
  return h;
}

describe("weekRecap", () => {
  const now = Date.UTC(2026, 9, 21, 4); // Wed Oct 21, 12:00 Manila
  const mon = weekStart(now) - 7 * DAY_MS; // Mon Oct 12

  it("adds up the week against the one before, needs against wants, and its top three with their notes", async () => {
    const h = await weeks(mon);
    const r = await weekRecap(env, h.householdId, mon, mon - 21 * DAY_MS, now);
    expect(r).toMatchObject({ start: mon, total: 417_000, prevTotal: 600_000, count: 7, noSpendDays: 2, needs: 335_000, wants: 82_000 });
    expect(r.top).toEqual([
      { key: "groceries", name: "Groceries", emoji: "🛒", total: 190_000, notes: ["Wet market"] },
      { key: "meals", name: "Meals", emoji: "🍱", total: 115_000, notes: ["Office lunch"] },
      { key: "eating-out", name: "Eating out", emoji: "🍜", total: 82_000, notes: ["Jollibee"] },
    ]);
    expect(r.days).toHaveLength(7);
    expect(r.goodDays).toBe(r.days.filter((d) => d !== "none").length);
  });

  it("only knows finished weeks that ended after the household began, by their Monday", () => {
    const created = mon - 21 * DAY_MS;
    expect(finishedWeek(toDateInput(mon), created, now)).toBe(mon);
    expect(finishedWeek(toDateInput(mon + 7 * DAY_MS), created, now)).toBeNull(); // this week: not over
    expect(finishedWeek(toDateInput(mon + DAY_MS), created, now)).toBeNull(); // a Tuesday
    expect(finishedWeek(toDateInput(created - 14 * DAY_MS), created, now)).toBeNull(); // before the household
    expect(finishedWeek("2026-13-01", created, now)).toBeNull();
  });
});

describe("the weekly recap", () => {
  const lastMonday = () => weekStart(Date.now()) - 7 * DAY_MS;

  it("plays last week as slides: the plant, what was spent, where it went, the garden, then Done; never Share", async () => {
    const mon = lastMonday();
    const h = await weeks(mon);
    const body = await html(await req(`/week/${toDateInput(mon)}`, { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    expect(body).toContain("Your week");
    expect(body).toContain("₱4,170");
    expect(body).toContain("₱1,830 less than the week before");
    expect(body).toContain("Where it went");
    expect(body).toContain("Office lunch");
    expect(body).toContain("good days in the garden");
    expect(body.match(/<section class="slide/g)!.length).toBe(4);
    expect(body).not.toContain('id="share"');
    expect(body).toMatch(/<a class="save[^"]*" href="\/">\s*Done/);
    expect(body).not.toContain('<nav class="nav">');
  });

  it("goes back to History when opened from there, and hides amounts for someone who hides them", async () => {
    const mon = lastMonday();
    const h = await weeks(mon);
    await db().update(profiles).set({ hideAmounts: true }).where(eq(profiles.id, h.profileIds[0]));
    const body = await html(await req(`/week/${toDateInput(mon)}?from=history`, { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    expect(body).toMatch(/href="\/history"[^>]*>\s*Done/);
    expect(body).toContain("₱4,•••");
    expect(body).not.toContain("₱4,170");
  });

  it("says a week that cost more plainly, without scolding", async () => {
    const mon = lastMonday();
    const h = await seedHousehold({ createdAt: mon - 21 * DAY_MS });
    await spend(h, 10_000, mon - 3 * DAY_MS, "Groceries");
    await spend(h, 50_000, mon + DAY_MS, "Groceries");
    const body = await html(await req(`/week/${toDateInput(mon)}`, { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    expect(body).toContain("₱400 more than the week before");
    expect(body).not.toMatch(/less than the week before/);
  });

  it("404s for weeks it doesn't know, and needs a login", async () => {
    const mon = lastMonday();
    const h = await weeks(mon);
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    expect((await req(`/week/${toDateInput(mon + 7 * DAY_MS)}`, { cookie })).status).toBe(404);
    expect((await req(`/week/${toDateInput(mon + DAY_MS)}`, { cookie })).status).toBe(404);
    expect((await req("/week/nope", { cookie })).status).toBe(404);
    expect((await req(`/week/${toDateInput(mon)}`)).status).toBe(302);
  });
});

describe("popping up", () => {
  it("is due on the add screen once last week is over and had expenses", async () => {
    const now = Date.UTC(2026, 9, 21, 4);
    const mon = weekStart(now) - 7 * DAY_MS;
    const h = await weeks(mon);
    expect((await todayGarden(env, h.householdId, mon - 21 * DAY_MS, now)).weekRecap).toBe(toDateInput(mon));
    const quiet = await seedHousehold({ createdAt: mon - 21 * DAY_MS });
    expect((await todayGarden(env, quiet.householdId, mon - 21 * DAY_MS, now)).weekRecap).toBeNull();
    const fresh = await seedHousehold({ createdAt: now - DAY_MS });
    await spend(fresh, 1_000, now - 3_600_000, "Groceries");
    expect((await todayGarden(env, fresh.householdId, now - DAY_MS, now)).weekRecap).toBeNull(); // last week was before it
  });

  it("carries it on the add screen", async () => {
    const mon = weekStart(Date.now()) - 7 * DAY_MS;
    const h = await weeks(mon);
    const body = await html(await req("/", { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    expect(body).toContain(`data-week="${toDateInput(mon)}"`);
  });
});

describe("recaps in History", () => {
  it("puts a row above the newest day of each finished week and month, on Everyone only", async () => {
    const mon = weekStart(Date.now()) - 7 * DAY_MS;
    const h = await weeks(mon);
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const body = await html(await req("/history", { cookie }));
    const row = body.indexOf(`href="/week/${toDateInput(mon)}?from=history"`);
    expect(row).toBeGreaterThan(0);
    expect(body.slice(row, row + 400)).toContain("Week of");
    expect(body.match(new RegExp(`/week/${toDateInput(mon)}\\?`, "g"))).toHaveLength(1);
    expect(body).not.toContain(`/week/${toDateInput(mon + 7 * DAY_MS)}`); // this week isn't over
    const person = await html(await req(`/history?who=${h.profileIds[0]}`, { cookie }));
    expect(person).not.toContain("/week/");
  });

  it("links last month's Wrapped where the month ended", async () => {
    const h = await seedHousehold({ createdAt: Date.now() - 70 * DAY_MS });
    const thisMonth = toDateInput(Date.now()).slice(0, 7);
    const lastMonthDay = Date.parse(`${thisMonth}-01T04:00:00Z`) - 2 * DAY_MS;
    await spend(h, 10_000, lastMonthDay, "Groceries");
    const body = await html(await req("/history", { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    expect(body).toContain(`href="/wrapped/${toDateInput(lastMonthDay).slice(0, 7)}?from=history"`);
    expect(body).toContain("wrapped");
  });
});

describe("recapRows", () => {
  const now = Date.UTC(2026, 9, 21, 4); // Wed Oct 21
  const created = Date.UTC(2026, 8, 1, 4); // Sep 1
  const day = (m: number, d: number) => dayKey(Date.UTC(2026, m, d, 4));
  const mon = (m: number, d: number) => Date.UTC(2026, m, d, 4) - 12 * 3_600_000; // Manila midnight

  it("marks the newest day of each finished week and month, never this week or month", () => {
    const rows = recapRows([day(9, 20), day(9, 16), day(9, 13), day(9, 9), day(8, 30)], null, created, now);
    expect([...rows.keys()]).toEqual([day(9, 16), day(9, 9), day(8, 30)]);
    expect(rows.get(day(9, 16))).toEqual({ week: mon(9, 12) });
    expect(rows.get(day(8, 30))).toEqual({ week: mon(8, 28), month: mon(8, 1) });
  });

  it("doesn't repeat a week whose newest day was on the page before", () => {
    expect(recapRows([day(9, 13), day(9, 9)], day(9, 14), created, now).has(day(9, 13))).toBe(false);
    expect(recapRows([day(9, 9)], day(9, 13), created, now).get(day(9, 9))).toEqual({ week: mon(9, 5) });
  });
});

describe("placeRecaps", () => {
  const created = Date.UTC(2026, 8, 1, 4);
  const now = Date.UTC(2026, 9, 21, 4); // Wed Oct 21
  const day = (m: number, d: number) => dayKey(Date.UTC(2026, m, d, 4));
  const start = (m: number, d: number) => Date.UTC(2026, m, d, 4) - 12 * 3_600_000;

  it("puts each row where its period ended, splitting a quiet run that crosses it", () => {
    const items = historyItems([day(9, 17), day(9, 14)], day(9, 1), day(9, 20));
    const placed = placeRecaps(items, recapRows([day(9, 17), day(9, 14)], null, created, now));
    expect(placed).toEqual([
      { kind: "quiet", from: day(9, 19), to: day(9, 20) },
      { kind: "week", start: start(9, 12) },
      { kind: "quiet", from: day(9, 18), to: day(9, 18) },
      { kind: "day", day: day(9, 17) },
      { kind: "quiet", from: day(9, 15), to: day(9, 16) },
      { kind: "day", day: day(9, 14) },
      { kind: "quiet", from: day(9, 1), to: day(9, 13) },
    ]);
  });

  it("puts a month's row above its last day and a week running into the next month above its own", () => {
    const days = [day(9, 2), day(8, 29)];
    const placed = placeRecaps(historyItems(days, day(8, 28), day(9, 6)), recapRows(days, null, created, now));
    expect(placed.map((p) => (p.kind === "quiet" ? `quiet ${p.from}-${p.to}` : p.kind === "day" ? `day ${p.day}` : p.kind))).toEqual([
      `quiet ${day(9, 5)}-${day(9, 6)}`,
      "week", // Sep 28 – Oct 4
      `quiet ${day(9, 3)}-${day(9, 4)}`,
      `day ${day(9, 2)}`,
      `quiet ${day(9, 1)}-${day(9, 1)}`,
      "month", // September
      `quiet ${day(8, 30)}-${day(8, 30)}`,
      `day ${day(8, 29)}`,
      `quiet ${day(8, 28)}-${day(8, 28)}`,
    ]);
  });
});

describe("last month and last week together", () => {
  it("play as one story: the month's slides, the week's, then the month's Share and Done", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 70 * DAY_MS });
    const mon = weekStart(now) - 7 * DAY_MS;
    await spend(h, 20_000, mon + DAY_MS, "Groceries");
    await spend(h, 20_000, monthStart(now) - DAY_MS, "Groceries");
    const month = toDateInput(monthStart(now) - DAY_MS).slice(0, 7);
    const body = await html(await req(`/wrapped/${month}?week=${toDateInput(mon)}`, { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
    const wrappedAt = body.indexOf(", wrapped</h1>");
    const weekAt = body.indexOf("Your week");
    const shareAt = body.indexOf('id="share"');
    expect(wrappedAt).toBeGreaterThan(0);
    expect(weekAt).toBeGreaterThan(wrappedAt);
    expect(shareAt).toBeGreaterThan(weekAt);
    expect(body.match(/>Done</g)).toHaveLength(1);
  });
});

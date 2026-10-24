import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { entries, profiles } from "../src/db/schema";
import { todayGarden } from "../src/lib/garden";
import { DAY_MS, dayKey, monthStart, toDateInput, weekStart } from "../src/lib/time";
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

  it("plays it on whichever screen each person opens first", async () => {
    const mon = weekStart(Date.now()) - 7 * DAY_MS;
    const h = await weeks(mon);
    const res = await req("/api/morning", { cookie: await authCookie(h.householdId, h.profileIds[0]) });
    // Early in a month last month's Wrapped is due too, and the week plays inside it (?week=).
    expect(((await res.json()) as { recap: string }).recap).toMatch(new RegExp(`week[/=]${toDateInput(mon)}$`));
  });
});

/** History from the top, following "Show more" until `found` appears (or there's no more). */
async function historyUntil(path: string, cookie: string, found: string) {
  let body = "";
  for (let next: string | undefined = path, i = 0; next && i < 6; i++) {
    const page = await html(await req(next, { cookie }));
    body += page;
    if (page.includes(found)) break;
    next = /id="more-history" href="([^"]+)"/.exec(page)?.[1]?.replace(/&amp;/g, "&");
  }
  return body;
}

describe("recaps in History", () => {
  it("put a watering can on each finished week's shelf, on Everyone only", async () => {
    const mon = weekStart(Date.now()) - 7 * DAY_MS;
    const h = await weeks(mon);
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const body = await html(await req("/history", { cookie }));
    const can = body.indexOf(`href="/week/${toDateInput(mon)}?from=history"`);
    expect(can).toBeGreaterThan(0);
    expect(body.slice(can, can + 400)).toContain("Week of");
    expect(body.slice(can, can + 600)).toContain("₱4,170");
    expect(body.match(new RegExp(`/week/${toDateInput(mon)}\?`, "g"))).toHaveLength(1);
    expect(body).not.toContain(`/week/${toDateInput(mon + 7 * DAY_MS)}`); // this week isn't over
    const person = await html(await req(`/history?who=${h.profileIds[0]}`, { cookie }));
    expect(person).not.toContain("/week/");
  });

  it("link last month's Wrapped on its sign", async () => {
    const h = await seedHousehold({ createdAt: Date.now() - 70 * DAY_MS });
    const thisMonth = toDateInput(Date.now()).slice(0, 7);
    const lastMonthDay = Date.parse(`${thisMonth}-01T04:00:00Z`) - 2 * DAY_MS;
    await spend(h, 10_000, lastMonthDay, "Groceries");
    const link = `href="/wrapped/${toDateInput(lastMonthDay).slice(0, 7)}?from=history"`;
    const body = await historyUntil("/history", await authCookie(h.householdId, h.profileIds[0]), link);
    expect(body).toContain(link);
    expect(body).toContain(", wrapped");
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

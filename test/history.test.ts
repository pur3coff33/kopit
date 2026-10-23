import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { entries } from "../src/db/schema";
import { dayKey, dayStart, toDateInput, weekStart } from "../src/lib/time";
import { HISTORY_WEEKS, dayHeading, historyWeeks, potKind, shelfMonth } from "../src/routes/history";
// @ts-ignore plain browser module
import { nextOpen } from "../public/js/history.js";
import { addEntry, authCookie, db, html, req, seedHousehold } from "./helpers";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

async function view(path: string, h: Awaited<ReturnType<typeof seedHousehold>>) {
  return html(await req(path, { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
}

/** The receipt of the day `ms` falls on, as rendered (open or not). */
function receipt(body: string, ms: number) {
  const day = toDateInput(ms);
  const shelf = body.indexOf(`data-week="${toDateInput(weekStart(ms))}"`);
  const k = (dayKey(ms) - dayKey(weekStart(ms))) % 7;
  const at = body.indexOf(`class="g-receipt" data-k="${k}"`, shelf);
  expect(at, `receipt for ${day}`).toBeGreaterThan(0);
  return body.slice(at, body.indexOf('<div class="g-receipt"', at + 10) > 0 ? body.indexOf('<div class="g-receipt"', at + 10) : body.indexOf("</section>", at));
}

describe("dayHeading", () => {
  const now = Date.UTC(2026, 9, 19, 4); // Mon Oct 19, 12:00 Manila
  it("names today and yesterday, otherwise weekday and date", () => {
    expect(dayHeading(now - 3_600_000, now)).toBe("Today");
    expect(dayHeading(Date.UTC(2026, 9, 18, 15, 59), now)).toBe("Yesterday"); // 23:59 Manila Sun
    expect(dayHeading(Date.UTC(2026, 9, 12, 4), now)).toBe("Mon, Oct 12");
    expect(dayHeading(Date.UTC(2025, 11, 31, 4), now)).toBe("Wed, Dec 31, 2025");
  });
});

describe("the greenhouse's shelves", () => {
  const now = Date.UTC(2026, 9, 21, 4); // Wed Oct 21, 12:00 Manila
  const mon = weekStart(now); // Mon Oct 19

  it("are whole weeks, newest first, from this one down to the household's first", () => {
    expect(historyWeeks(null, mon - 10 * WEEK, now)).toEqual({ weeks: [mon, mon - WEEK, mon - 2 * WEEK, mon - 3 * WEEK], more: true });
    expect(historyWeeks(mon - 3 * WEEK, mon - 4 * WEEK + 2 * DAY, now)).toEqual({ weeks: [mon - 4 * WEEK], more: false });
    expect(historyWeeks(null, now, now)).toEqual({ weeks: [mon], more: false }); // a household that began today
    expect(historyWeeks(mon - 3 * WEEK, mon - 3 * WEEK, now)).toEqual({ weeks: [], more: false });
  });

  it("sit under the month they end in, or this month while it's this week", () => {
    const sep28 = Date.UTC(2026, 8, 27, 16); // Mon Sep 28, Manila midnight
    expect(shelfMonth(sep28, now)).toBe(Date.UTC(2026, 8, 30, 16)); // Sep 28 – Oct 4: October's
    expect(shelfMonth(Date.UTC(2026, 9, 25, 16), Date.UTC(2026, 9, 28, 4))).toBe(Date.UTC(2026, 8, 30, 16)); // Oct 26 – Nov 1, seen on Oct 28
  });

  it("show each day's pot as it went", () => {
    const today = dayKey(now);
    const good = { missions: 3, done: 2, doneTypes: [] };
    expect(potKind(today + 1, today, today - 30, false, undefined)).toBe("none"); // still to come
    expect(potKind(today, today, today - 30, true, good)).toBe("today");
    expect(potKind(today - 1, today, today - 30, false, good)).toBe("quiet"); // nothing spent
    expect(potKind(today - 40, today, today - 30, false, undefined)).toBe("none"); // before the garden began
    expect(potKind(today - 1, today, today - 30, true, { missions: 3, done: 3, doneTypes: [] })).toBe("perfect");
    expect(potKind(today - 1, today, today - 30, true, good)).toBe("good");
    expect(potKind(today - 1, today, today - 30, true, { missions: 3, done: 1, doneTypes: [] })).toBe("missed");
    expect(potKind(today - 1, today, today - 30, true, undefined)).toBe("plain");
  });

  it("open one day at a time, and close it on a second tap", () => {
    expect(nextOpen(null, 3)).toBe(3);
    expect(nextOpen(4, 2)).toBe(2);
    expect(nextOpen(2, 2)).toBeNull();
  });
});

describe("history page", () => {
  it("opens today's receipt, every expense in it newest first, with note or category", async () => {
    const h = await seedHousehold();
    const now = Date.now();
    const a = await addEntry(h, { amount: 25000, at: now - 1000, category: "Eating out" });
    await db().update(entries).set({ note: "Jollibee with Ana" }).where(eq(entries.id, a));
    await addEntry(h, { amount: 4500, at: now - DAY, category: "Transport", profile: 1 });
    await addEntry(h, { amount: 999, at: now - 2000, category: null });
    const body = await view("/history", h);
    const today = receipt(body, now).replace(/<details class="missions[\s\S]*?<\/details>/g, "");
    expect(today).not.toMatch(/^class="g-receipt"[^>]* hidden/);
    const order = ["Today", "₱259.99", "Jollibee with Ana", "₱250", "No category", "₱9.99"];
    const at = order.map((s) => today.indexOf(s));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(body).toMatch(/class="g-pot today sel"/);
    const yesterday = receipt(body, now - DAY);
    expect(yesterday).toMatch(/^class="g-receipt"[^>]* hidden/);
    for (const s of ["Yesterday", "₱45", "Transport", "Partner"]) expect(yesterday).toContain(s);
    expect(body).toMatch(/href="\/entries\/[0-9a-f-]{36}\/edit\?back=%2Fhistory/);
  });

  it("filters by person and keeps other households out", async () => {
    const h = await seedHousehold();
    const other = await seedHousehold();
    await addEntry(h, { amount: 1100, at: Date.now() - 1000, category: "Eating out", profile: 0 });
    await addEntry(h, { amount: 2200, at: Date.now() - 1000, category: "Eating out", profile: 1 });
    await addEntry(other, { amount: 7700, at: Date.now() - 1000, category: "Eating out" });
    const body = await view(`/history?who=${h.profileIds[1]}`, h);
    expect(body).toContain("₱22");
    expect(body).not.toContain("₱11");
    expect(body).not.toContain("₱77");
    expect(body).toMatch(/class="chip on"[^>]*>Partner</);
  });

  it(`loads ${HISTORY_WEEKS} weeks at a time, then the rest down to the household's first`, async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 40 * DAY });
    const ago = (k: number) => (k === 0 ? now - 1000 : dayStart(now) - k * DAY + 12 * 3_600_000);
    for (const k of [0, 1, 9, 20, 30, 38]) await addEntry(h, { amount: 100 + k, at: ago(k), category: "Eating out" });
    const ids = (s: string) => [...s.matchAll(/\/entries\/([0-9a-f-]{36})\/edit/g)].map((m) => m[1]);
    const shelves = (s: string) => [...s.matchAll(/class="g-shelf" data-week="([0-9-]+)"/g)].map((m) => m[1]);

    const first = await view("/history", h);
    expect(shelves(first)).toHaveLength(HISTORY_WEEKS);
    expect(shelves(first)[0]).toBe(toDateInput(weekStart(now)));
    const more = /id="more-history" href="([^"]+before=([0-9-]+))"/.exec(first);
    expect(more?.[2]).toBe(shelves(first).at(-1));

    const second = await view(more![1].replace(/&amp;/g, "&"), h);
    expect(shelves(second).at(-1)).toBe(toDateInput(weekStart(now - 40 * DAY)));
    expect(second).not.toContain('id="more-history"');
    expect(new Set([...ids(first), ...ids(second)]).size).toBe(6);
    expect(second).not.toContain('id="history-empty"');
  });

  it("hangs a sign for each month, once even across batches", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 70 * DAY });
    await addEntry(h, { amount: 100, at: now - 1000, category: "Eating out" });
    const first = await view("/history", h);
    const more = /id="more-history" href="([^"]+)"/.exec(first)![1].replace(/&amp;/g, "&");
    const second = await view(more, h);
    const signs = [...(first + second).matchAll(/<h2 class="m">([A-Za-z]+)<\/h2>/g)].map((m) => m[1]);
    expect(new Set(signs).size).toBe(signs.length);
    expect(signs[0]).toBe(new Date(now + 8 * 3_600_000).toLocaleString("en", { month: "long", timeZone: "UTC" }));
  });

  it("gives a day with nothing spent its butterfly, and names the person when filtered", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 9 * DAY });
    await addEntry(h, { amount: 300, at: now - 1000, category: "Eating out", profile: 1 });
    await addEntry(h, { amount: 900, at: dayStart(now) - DAY + 12 * 3_600_000, category: "Eating out", profile: 0 });
    const body = await view(`/history?who=${h.profileIds[1]}`, h);
    expect(body).toContain("nothing by Partner");
    expect(body).not.toContain("nothing spent");
    expect(body).not.toContain("₱9");
    expect(body).toContain("g-pot quiet");
  });

  it("says when there is nothing yet", async () => {
    const h = await seedHousehold();
    expect(await view("/history", h)).toContain("Nothing logged yet.");
  });

  it("needs a login", async () => {
    const res = await req("/history");
    expect(res.status).toBe(302);
  });
});

describe("history's missions", () => {
  it("fold each day's missions in its receipt, for the whole household", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 10 * DAY });
    await addEntry(h, { amount: 15_000, at: now - 3 * DAY, category: "Eating out" });
    await addEntry(h, { amount: 900_000, at: now - 2 * DAY, category: "Shopping" });
    const body = await view("/history?who=all", h);
    const lines = body.match(/<details class="missions day-missions"[^>]*>/g) ?? [];
    expect(lines).toHaveLength(2);
    expect(body).toMatch(/\d of \d missions met/);
    expect(body).toMatch(/class="m (met|missed)"/);
    // A person's history is theirs; the missions are the household's, so they stay out of it.
    const mine = await view(`/history?who=${h.profileIds[0]}`, h);
    expect(mine).not.toContain("day-missions");
  });

  it("show today's as on track so far", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 10 * DAY });
    await addEntry(h, { amount: 1_000, at: now - 60_000, category: "Eating out" });
    const body = await view("/history?who=all", h);
    expect(body).toMatch(/\d of \d missions on track so far/);
  });
});

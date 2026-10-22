import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { entries } from "../src/db/schema";
import { dayStart, toDateInput } from "../src/lib/time";
import { HISTORY_DAYS, dayHeading, historyItems } from "../src/routes/history";
import { addEntry, authCookie, db, html, req, seedHousehold } from "./helpers";

const DAY = 86_400_000;

async function view(path: string, h: Awaited<ReturnType<typeof seedHousehold>>) {
  return html(await req(path, { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
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

describe("historyItems", () => {
  it("lists spending days newest first, with the quiet days between them as runs", () => {
    expect(historyItems([10, 8, 7, 3], 3, 11)).toEqual([
      { kind: "quiet", from: 11, to: 11 },
      { kind: "day", day: 10 },
      { kind: "quiet", from: 9, to: 9 },
      { kind: "day", day: 8 },
      { kind: "day", day: 7 },
      { kind: "quiet", from: 4, to: 6 },
      { kind: "day", day: 3 },
    ]);
  });

  it("only counts quiet days inside the allowed window, but always shows spending days", () => {
    // before the household existed (low = 3) and after yesterday (high) nothing is "quiet"
    expect(historyItems([5, 1], 3, 6)).toEqual([
      { kind: "quiet", from: 6, to: 6 },
      { kind: "day", day: 5 },
      { kind: "quiet", from: 3, to: 4 },
      { kind: "day", day: 1 },
    ]);
    expect(historyItems([12, 9], 5, 10)).toEqual([
      { kind: "day", day: 12 },
      { kind: "quiet", from: 10, to: 10 },
      { kind: "day", day: 9 },
      { kind: "quiet", from: 5, to: 8 },
    ]);
    expect(historyItems([], 3, 5)).toEqual([{ kind: "quiet", from: 3, to: 5 }]);
  });
});

describe("history page", () => {
  it("lists every expense newest first, grouped by day, with note or category", async () => {
    const h = await seedHousehold();
    const now = Date.now();
    const a = await addEntry(h, { amount: 25000, at: now - 1000, category: "Food" });
    await db().update(entries).set({ note: "Jollibee with Ana" }).where(eq(entries.id, a));
    await addEntry(h, { amount: 4500, at: now - DAY, category: "Transport", profile: 1 });
    await addEntry(h, { amount: 999, at: now - 2000, category: null });
    const body = await view("/history", h);
    const order = ["Today", "₱259.99", "Jollibee with Ana", "₱250", "Uncategorized", "₱9.99", "Yesterday", "₱45", "Transport", "Partner"];
    const list = body.slice(body.indexOf('id="history"')).replace(/<details class="missions[\s\S]*?<\/details>/g, "");
    const at = order.map((s) => list.indexOf(s));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(body).toMatch(/href="\/entries\/[0-9a-f-]{36}\/edit\?back=%2Fhistory/);
  });

  it("filters by person and keeps other households out", async () => {
    const h = await seedHousehold();
    const other = await seedHousehold();
    await addEntry(h, { amount: 1100, at: Date.now() - 1000, category: "Food", profile: 0 });
    await addEntry(h, { amount: 2200, at: Date.now() - 1000, category: "Food", profile: 1 });
    await addEntry(other, { amount: 7700, at: Date.now() - 1000, category: "Food" });
    const body = await view(`/history?who=${h.profileIds[1]}`, h);
    expect(body).toContain("₱22");
    expect(body).not.toContain("₱11");
    expect(body).not.toContain("₱77");
    expect(body).toMatch(/class="chip on"[^>]*>Partner</);
  });

  it("loads 5 spending days at a time, whole days, with quiet days between them", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 20 * DAY });
    const ago = (k: number) => (k === 0 ? now - 1000 : dayStart(now) - k * DAY + 12 * 3_600_000);
    for (const k of [0, 1, 3, 4, 8, 12]) await addEntry(h, { amount: 100 + k, at: ago(k), category: "Food" });
    for (let i = 0; i < 3; i++) await addEntry(h, { amount: 700 + i, at: ago(7) + i, category: "Food" });
    const ids = (s: string) => [...s.matchAll(/\/entries\/([0-9a-f-]{36})\/edit/g)].map((m) => m[1]);
    const quiet = (s: string) => [...s.matchAll(/<p class="quiet">(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

    const first = await view("/history", h);
    expect(first.match(/<h2 class="day">/g)).toHaveLength(HISTORY_DAYS); // days 0, 1, 3, 4, 7
    expect(ids(first)).toHaveLength(7); // day 7 comes whole: all 3 of its expenses
    expect(quiet(first)).toHaveLength(2); // day 2, then days 5–6
    expect(quiet(first)[0]).toContain("nothing spent");
    expect(quiet(first)[1]).toContain("2 days");
    const more = /href="(\/history\?[^"]*before=([0-9-]+))"/.exec(first);
    expect(more?.[2]).toBe(toDateInput(ago(7)));

    const second = await view(more![1], h);
    expect(second.match(/<h2 class="day">/g)).toHaveLength(2); // days 8 and 12
    expect(ids(second)).toHaveLength(2);
    expect(new Set([...ids(first), ...ids(second)]).size).toBe(9);
    expect(quiet(second).map((q) => q.match(/(\d+) days/)?.[1])).toEqual(["3", "8"]); // days 9–11, then 13–20 back to setup
    expect(second).not.toMatch(/before=/);
  });

  it("still finds older days across a long gap", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 320 * DAY });
    const ago = (k: number) => (k === 0 ? now - 1000 : dayStart(now) - k * DAY + 12 * 3_600_000);
    for (const k of [0, 1, 2, 3, 4, 300]) await addEntry(h, { amount: 100 + k, at: ago(k), category: "Food" });
    const first = await view("/history", h);
    const more = /href="(\/history\?[^"]*before=([0-9-]+))"/.exec(first);
    expect(more?.[2]).toBe(toDateInput(ago(4)));
    const second = await view(more![1], h);
    expect(second.match(/<h2 class="day">/g)).toHaveLength(1); // day 300
    expect(second).toContain("₱4"); // ₱4.00 on day 300
    expect(second).not.toMatch(/before=/);
  });

  it("doesn't call today quiet before it's over", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 3 * DAY });
    await addEntry(h, { amount: 500, at: dayStart(now) - 2 * DAY + 12 * 3_600_000, category: "Food" });
    const body = await view("/history", h);
    expect(body).not.toContain("Today");
    expect(body).toContain("<b>Yesterday</b>");
  });

  it("names the person when filtered, and says when nothing is left", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 2 * DAY });
    await addEntry(h, { amount: 300, at: now - 1000, category: "Food", profile: 1 });
    await addEntry(h, { amount: 900, at: dayStart(now) - DAY + 12 * 3_600_000, category: "Food", profile: 0 });
    const body = await view(`/history?who=${h.profileIds[1]}`, h);
    expect(body).toContain("nothing by Partner");
    expect(body).not.toContain("nothing spent");
    expect(body).not.toContain("₱9");
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
  it("fold each day's missions under its heading, for the whole household", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: now - 10 * DAY });
    await addEntry(h, { amount: 15_000, at: now - 3 * DAY, category: "Food" });
    await addEntry(h, { amount: 900_000, at: now - 2 * DAY, category: "Shopping" });
    const body = await view("/history?who=all", h);
    const lines = body.match(/<details class="missions day-missions">/g) ?? [];
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
    await addEntry(h, { amount: 1_000, at: now - 60_000, category: "Food" });
    const body = await view("/history?who=all", h);
    expect(body).toMatch(/\d of \d missions on track so far/);
  });
});

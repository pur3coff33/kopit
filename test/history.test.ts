import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { entries } from "../src/db/schema";
import { HISTORY_PAGE, dayHeading } from "../src/routes/history";
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

describe("history page", () => {
  it("lists every expense newest first, grouped by day, with note or category", async () => {
    const h = await seedHousehold();
    const now = Date.now();
    const a = await addEntry(h, { amount: 25000, at: now - 1000, category: "Food" });
    await db().update(entries).set({ note: "Jollibee with Ana" }).where(eq(entries.id, a));
    await addEntry(h, { amount: 4500, at: now - DAY, category: "Transport", profile: 1 });
    await addEntry(h, { amount: 999, at: now - 2000, category: null });
    const body = await view("/history", h);
    expect(body).toMatch(/class="on"[^>]*>history</);
    const order = ["Today", "Jollibee with Ana", "₱250", "Uncategorized", "₱9.99", "Yesterday", "Transport", "₱45", "Partner"];
    const list = body.slice(body.indexOf('id="history"'));
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

  it("pages through older expenses without repeats", async () => {
    const h = await seedHousehold();
    const now = Date.now();
    for (let i = 0; i < HISTORY_PAGE + 5; i++) await addEntry(h, { amount: 100 + i, at: now - i * 60_000, category: "Food" });
    const first = await view("/history", h);
    const more = /href="(\/history\?[^"]*before=[^"]+)"/.exec(first);
    expect(more).not.toBeNull();
    const second = await view(more![1].replace(/&amp;/g, "&"), h);
    const ids = (s: string) => [...s.matchAll(/\/entries\/([0-9a-f-]{36})\/edit/g)].map((m) => m[1]);
    expect(ids(first)).toHaveLength(HISTORY_PAGE);
    expect(ids(second)).toHaveLength(5);
    expect(new Set([...ids(first), ...ids(second)]).size).toBe(HISTORY_PAGE + 5);
    expect(second).not.toMatch(/before=/);
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

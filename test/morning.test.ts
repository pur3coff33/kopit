import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { doneKey, manilaDate } from "../public/js/morning.js";
import { cleanSeen, recapToPlay } from "../src/lib/morning";
import { DAY_MS, dayStart, toDateInput } from "../src/lib/time";
import { addEntry, authCookie, html, req, seedHousehold } from "./helpers";

type Card = { card?: string; leaf?: string | null; note?: string | null; recap?: string; marks?: Record<string, string> };
const ask = async (cookie: string) => {
  const res = await req("/api/morning", { cookie });
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as Card) : null };
};
const seen = (cookie: string, had: unknown) =>
  req("/api/morning/seen", { method: "POST", cookie, headers: { "Content-Type": "application/json" }, body: JSON.stringify(had) });

describe("the day's start", () => {
  it("shows yesterday's leaf to each person once, on whatever phone they use", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: dayStart(now) - DAY_MS + 3_600_000 }); // started yesterday: a quiet, perfect day
    const jon = await authCookie(h.householdId, h.profileIds[0]);
    const first = await ask(jon);
    const yesterday = toDateInput(now - DAY_MS);
    expect(first.body?.leaf).toBe(yesterday);
    expect(first.body?.note).toBeNull(); // nothing spent: no note
    const card = first.body!.card!.replace(/&#39;/g, "'");
    expect(card).toContain('id="morning-card"');
    expect(card).toContain("A perfect day! 🌸");
    expect(card).toContain("That's your 1st leaf");
    expect(card).not.toContain("dn-slot");

    expect((await seen(jon, { leaf: yesterday })).status).toBe(200);
    expect((await ask(jon)).status).toBe(204);
    expect((await ask(await authCookie(h.householdId, h.profileIds[0]))).status).toBe(204); // Jon on another phone
    expect((await ask(await authCookie(h.householdId, h.profileIds[1]))).body?.leaf).toBe(yesterday); // Partner hasn't had it
  });

  it("brings yesterday's note under its own heading once its leaf has been had", async () => {
    const now = Date.now();
    const yesterday = dayStart(now) - DAY_MS;
    const h = await seedHousehold({ createdAt: yesterday - 3 * DAY_MS });
    await addEntry(h, { amount: 20_000, at: yesterday + 12 * 3_600_000, category: "Meals" });
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const { body } = await ask(cookie);
    const date = toDateInput(yesterday);
    expect(body?.note).toBe(date);
    if (body?.leaf) {
      expect(body.card).toContain("leaf-title");
      await seen(cookie, { leaf: date });
      const after = (await ask(cookie)).body!;
      expect(after.leaf).toBeNull();
      expect(after.card).toContain("Yesterday, in a few words");
    }
    await seen(cookie, { note: date });
    expect((await ask(cookie)).status).toBe(204);
  });

  it("keeps only well-formed parts of what a phone says was had", async () => {
    const h = await seedHousehold();
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    expect((await seen(cookie, { leaf: "yesterday" })).status).toBe(400);
    expect((await seen(cookie, null)).status).toBe(400);
    expect(cleanSeen({ leaf: "2026-10-23", note: "x", wrapped: "2026-10", week: "2026-10-19", other: 1 })).toEqual({
      leaf: "2026-10-23",
      wrapped: "2026-10",
      week: "2026-10-19",
    });
    expect(await html(await req("/api/morning"))).toContain("auth"); // logged out: nothing
  });
});

describe("which recap plays", () => {
  const g = { wrappedMonth: "2026-10", weekRecap: "2026-10-26", leafDay: "2026-10-31" };

  it("plays last month's and last week's once each, together as one story when both are due, instead of the leaf", () => {
    expect(recapToPlay(g, {})).toEqual({ url: "/wrapped/2026-10?week=2026-10-26", marks: { wrapped: "2026-10", week: "2026-10-26", leaf: "2026-10-31" } });
    expect(recapToPlay(g, { wrapped: "2026-10" })?.url).toBe("/week/2026-10-26");
    expect(recapToPlay({ ...g, weekRecap: null }, {})?.url).toBe("/wrapped/2026-10");
    expect(recapToPlay(g, { wrapped: "2026-10", week: "2026-10-26" })).toBeNull();
    expect(recapToPlay({ wrappedMonth: null, weekRecap: null, leafDay: null }, {})).toBeNull();
  });
});

describe("morning.js", () => {
  it("remembers a person done for the Manila day, which starts 8 hours before UTC's", () => {
    expect(manilaDate(Date.UTC(2026, 9, 20, 16, 30))).toBe("2026-10-21"); // 00:30 Manila
    expect(doneKey("Maya", Date.UTC(2026, 9, 21, 4))).toBe("Maya|2026-10-21");
  });
});

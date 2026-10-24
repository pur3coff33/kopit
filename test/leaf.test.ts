import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { isStale, manilaDate, morningCard, shouldCelebrate } from "../public/js/leaf.js";

const noonOct21 = Date.UTC(2026, 9, 21, 4); // 12:00 Manila

describe("leaf helpers (add screen)", () => {
  it("knows the Manila date, which is ahead of UTC", () => {
    expect(manilaDate(Date.UTC(2026, 9, 20, 16, 30))).toBe("2026-10-21"); // 00:30 Manila
  });

  it("knows when the screen was rendered on an earlier day", () => {
    expect(isStale("2026-10-20", noonOct21)).toBe(true);
    expect(isStale("2026-10-21", noonOct21)).toBe(false);
  });

  it("celebrates yesterday's leaf once per phone, never a stale one", () => {
    expect(shouldCelebrate("2026-10-20", noonOct21, null)).toBe(true);
    expect(shouldCelebrate("2026-10-20", noonOct21, "2026-10-20")).toBe(false);
    expect(shouldCelebrate("2026-10-19", noonOct21, null)).toBe(false);
    expect(shouldCelebrate(null, noonOct21, null)).toBe(false);
  });
});

describe("the morning card (add screen)", () => {
  it("shows yesterday's leaf and its note once per phone each", () => {
    expect(morningCard("2026-10-20", "2026-10-20", noonOct21, null, null)).toEqual({ leaf: true, note: true });
    expect(morningCard(null, "2026-10-20", noonOct21, null, null)).toEqual({ leaf: false, note: true });
    // Its recap played instead of the leaf: the note still comes, under its own heading.
    expect(morningCard("2026-10-20", "2026-10-20", noonOct21, "2026-10-20", null)).toEqual({ leaf: false, note: true });
    expect(morningCard("2026-10-20", "2026-10-20", noonOct21, "2026-10-20", "2026-10-20")).toEqual({ leaf: false, note: false });
    expect(morningCard(null, "2026-10-19", noonOct21, null, null)).toEqual({ leaf: false, note: false });
  });
});

describe("which recap plays (add screen)", () => {
  it("plays last month's and last week's once each, together as one story when both are due", async () => {
    // @ts-ignore plain browser module
    const { recapToPlay } = await import("../public/js/leaf.js");
    expect(recapToPlay("2026-10", "2026-10-26", null, null)).toBe("/wrapped/2026-10?week=2026-10-26");
    expect(recapToPlay("2026-10", "2026-10-26", "2026-10", null)).toBe("/week/2026-10-26");
    expect(recapToPlay("2026-10", null, null, null)).toBe("/wrapped/2026-10");
    expect(recapToPlay(null, "2026-10-26", null, "2026-10-19")).toBe("/week/2026-10-26");
    expect(recapToPlay("2026-10", "2026-10-26", "2026-10", "2026-10-26")).toBeNull();
    expect(recapToPlay(null, null, null, null)).toBeNull();
  });
});

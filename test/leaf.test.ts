import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module
import { isStale, manilaDate, shouldCelebrate } from "../public/js/leaf.js";

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

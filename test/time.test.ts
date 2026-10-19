import { describe, expect, it } from "vitest";
import {
  addMonths, dayKey, dayStart, fromDateInput, monthStart, rangeLabel, resolveRange, toDateInput, weekStart,
} from "../src/lib/time";

const oct31_2330 = Date.UTC(2026, 9, 31, 15, 30); // 23:30 Manila Oct 31
const nov1_0010 = Date.UTC(2026, 9, 31, 16, 10); // 00:10 Manila Nov 1
const now = Date.UTC(2026, 9, 19, 4, 0); // 12:00 Manila Mon Oct 19

describe("Manila boundaries", () => {
  it("puts late Oct 31 in October and just-after-midnight in November", () => {
    expect(monthStart(oct31_2330)).toBe(Date.UTC(2026, 8, 30, 16, 0));
    expect(monthStart(nov1_0010)).toBe(Date.UTC(2026, 9, 31, 16, 0));
    expect(toDateInput(oct31_2330)).toBe("2026-10-31");
    expect(toDateInput(nov1_0010)).toBe("2026-11-01");
    expect(dayKey(nov1_0010) - dayKey(oct31_2330)).toBe(1);
  });
  it("starts the day at Manila midnight", () => {
    expect(dayStart(oct31_2330)).toBe(Date.UTC(2026, 9, 30, 16, 0));
  });
  it("starts weeks on Monday", () => {
    expect(weekStart(Date.UTC(2026, 9, 18, 15, 0))).toBe(Date.UTC(2026, 9, 11, 16, 0)); // Sun 23:00 → Mon Oct 12
    expect(weekStart(now)).toBe(Date.UTC(2026, 9, 18, 16, 0)); // Mon Oct 19 itself
  });
  it("adds months across year ends", () => {
    expect(addMonths(Date.UTC(2026, 0, 0, 16), 1)).toBe(Date.UTC(2026, 0, 31, 16));
    expect(addMonths(Date.UTC(2026, 0, 0, 16), -1)).toBe(Date.UTC(2025, 10, 30, 16));
  });
  it("round-trips date inputs", () => {
    expect(fromDateInput("2026-10-02")).toBe(Date.UTC(2026, 9, 1, 16));
    expect(toDateInput(fromDateInput("2026-10-02")!)).toBe("2026-10-02");
    expect(fromDateInput("2026-13-01")).toBeNull();
    expect(fromDateInput("nope")).toBeNull();
    expect(fromDateInput("2026-02-30")).toBeNull();
  });
});

describe("resolveRange", () => {
  it("this and last month", () => {
    expect(resolveRange("this", now)).toEqual({ kind: "this", start: Date.UTC(2026, 8, 30, 16), end: Date.UTC(2026, 9, 31, 16) });
    expect(resolveRange("last", now)).toEqual({ kind: "last", start: Date.UTC(2026, 7, 31, 16), end: Date.UTC(2026, 8, 30, 16) });
  });
  it("custom swaps reversed dates", () => {
    expect(resolveRange("custom", now, "2026-10-10", "2026-10-03")).toEqual({
      kind: "custom", start: fromDateInput("2026-10-03"), end: fromDateInput("2026-10-11"),
    });
  });
  it("custom falls back to this month on bad input", () => {
    expect(resolveRange("custom", now, "x", "2026-10-03")).toEqual(resolveRange("this", now));
  });
});

describe("rangeLabel", () => {
  it("same month stops at today", () => {
    expect(rangeLabel(fromDateInput("2026-10-01")!, fromDateInput("2026-11-01")!, now)).toBe("Oct 1 – 19");
  });
  it("spanning months", () => {
    expect(rangeLabel(fromDateInput("2026-09-28")!, fromDateInput("2026-10-04")!, now)).toBe("Sep 28 – Oct 3");
  });
  it("single day", () => {
    expect(rangeLabel(fromDateInput("2026-10-19")!, fromDateInput("2026-10-20")!, now)).toBe("Oct 19");
  });
});

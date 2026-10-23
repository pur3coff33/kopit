import { describe, expect, it } from "vitest";
// @ts-ignore plain browser module shared with the add and edit pages
import { keypadKeyFor, press, toCentavos } from "../public/js/keypad.js";

describe("keypad press", () => {
  it("replaces the leading zero", () => {
    expect(press("0", "7")).toBe("7");
    expect(press("7", "0")).toBe("70");
  });
  it("starts decimals from zero and allows only one point", () => {
    expect(press("0", ".")).toBe("0.");
    expect(press("1.5", ".")).toBe("1.5");
  });
  it("ignores a third decimal digit", () => {
    expect(press("12.34", "5")).toBe("12.34");
    expect(press("12.3", "4")).toBe("12.34");
  });
  it("backspaces down to zero", () => {
    expect(press("0", "back")).toBe("0");
    expect(press("5", "back")).toBe("0");
    expect(press("0.", "back")).toBe("0");
    expect(press("12.5", "back")).toBe("12.");
  });
  it("refuses amounts over ₱1,000,000", () => {
    expect(press("1000000", "0")).toBe("1000000");
    expect(press("1000000.", "1")).toBe("1000000.");
    expect(press("999999", "9")).toBe("999999");
  });
  it("ignores unknown keys", () => {
    expect(press("12", "x")).toBe("12");
  });
});

describe("toCentavos", () => {
  it("converts typed strings", () => {
    expect(toCentavos("12.5")).toBe(1250);
    expect(toCentavos("0.")).toBe(0);
    expect(toCentavos("350")).toBe(35000);
    expect(toCentavos("0.05")).toBe(5);
  });
});

describe("keypadKeyFor", () => {
  it("maps the digits, the point and Backspace to the keypad's keys", () => {
    expect(keypadKeyFor("7")).toBe("7");
    expect(keypadKeyFor("0")).toBe("0");
    expect(keypadKeyFor(".")).toBe(".");
    expect(keypadKeyFor("Backspace")).toBe("back");
  });
  it("leaves every other key alone", () => {
    for (const k of ["a", "Enter", " ", "Tab", "-", "10", "Delete", ","]) expect(keypadKeyFor(k)).toBeNull();
  });
});

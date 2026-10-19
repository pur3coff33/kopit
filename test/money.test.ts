import { describe, expect, it } from "vitest";
import { MAX_CENTAVOS, formatPeso, parseAmount } from "../src/lib/money";

describe("parseAmount", () => {
  it("converts pesos to centavos", () => {
    expect(parseAmount("350")).toBe(35000);
    expect(parseAmount("350.5")).toBe(35050);
    expect(parseAmount("0.05")).toBe(5);
    expect(parseAmount("1000000")).toBe(100_000_000);
  });
  it("rejects invalid amounts", () => {
    for (const bad of ["", "0", "-5", "abc", "1.234", "1000000.01", "1e3", " "]) {
      expect(parseAmount(bad), bad).toBeNull();
    }
  });
  it("caps at MAX_CENTAVOS", () => {
    expect(MAX_CENTAVOS).toBe(100_000_000);
  });
});

describe("formatPeso", () => {
  it("drops decimals for whole pesos and uses comma thousands", () => {
    expect(formatPeso(790000)).toBe("₱7,900");
    expect(formatPeso(1842000)).toBe("₱18,420");
    expect(formatPeso(0)).toBe("₱0");
  });
  it("shows two decimals otherwise", () => {
    expect(formatPeso(35050)).toBe("₱350.50");
    expect(formatPeso(45050)).toBe("₱450.50");
    expect(formatPeso(5)).toBe("₱0.05");
  });
});

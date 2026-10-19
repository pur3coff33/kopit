import { describe, expect, it } from "vitest";
import { hashPin, isValidPin, verifyPin } from "../src/lib/pin";

describe("pin", () => {
  it("validates exactly six digits", () => {
    expect(isValidPin("482913")).toBe(true);
    for (const bad of ["12345", "1234567", "12a456", "", " 48291"]) expect(isValidPin(bad), bad).toBe(false);
  });
  it("hashes deterministically for a salt and verifies", async () => {
    const { hash, salt } = await hashPin("pepper", "482913");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(await verifyPin("pepper", "482913", salt, hash)).toBe(true);
    expect(await verifyPin("pepper", "482914", salt, hash)).toBe(false);
    expect(await verifyPin("other-pepper", "482913", salt, hash)).toBe(false);
  });
  it("uses a fresh salt each time", async () => {
    const a = await hashPin("pepper", "482913");
    const b = await hashPin("pepper", "482913");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

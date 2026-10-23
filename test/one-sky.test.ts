import { describe, expect, it } from "vitest";
import { addEntry, authCookie, html, req, seedHousehold } from "./helpers";

describe("one sky over add, the garden and history", () => {
  it("shows the same live sky on all three, and only the garden asks where the phone is", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 1000, at: Date.now() - 60_000, category: "Groceries" });
    const cookie = await authCookie(h.householdId, h.profileIds[0]);
    const [add, garden, history] = await Promise.all(["/", "/spending", "/history"].map(async (p) => html(await req(p, { cookie }))));
    for (const body of [add, garden, history]) {
      expect(body).toContain('src="/js/sky.js"');
      expect(body.match(/data-sky="[^"]*"/g)).toHaveLength(1); // the one sky /js/sky.js paints
      expect(body).toMatch(/data-sky="[^"]*" data-phase="(day|night)" data-weather="clear"/);
      expect(body).toContain("data-sky-label");
    }
    expect(garden).toContain('data-sky=""');
    expect(add).toMatch(/class="sky add-sky" data-sky="quiet"/);
    expect(history).toMatch(/<div class="g-roof" aria-hidden="true"><div class="sky roof-sky" data-sky="quiet"/);
  });
});

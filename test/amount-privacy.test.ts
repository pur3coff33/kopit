import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { profiles } from "../src/db/schema";
import { MASKED, amounts, maskAmounts } from "../src/lib/money";
import { addEntry, authCookie, db, form, html, req, seedHousehold } from "./helpers";

async function setup() {
  const now = Date.now();
  const h = await seedHousehold();
  await addEntry(h, { amount: 435000, at: now - 2000, category: "Food" });
  await addEntry(h, { amount: 790000, at: now - 1000, category: "Groceries", profile: 1 });
  const jon = await authCookie(h.householdId, h.profileIds[0]);
  const partner = await authCookie(h.householdId, h.profileIds[1]);
  return { h, jon, partner };
}

const hide = (cookie: string, hidden: boolean, back = "/spending") =>
  req("/settings/amounts", { ...form({ hide: hidden ? "1" : "0", back }), cookie });

describe("masking amounts", () => {
  it("masks every peso amount in a line, keeping the words", () => {
    expect(maskAmounts("Keep 🍔 Food under ₱200")).toBe(`Keep 🍔 Food under ${MASKED}`);
    expect(maskAmounts("₱1,250.50 vs ₱900")).toBe(`${MASKED} vs ${MASKED}`);
    expect(maskAmounts("-₱5 · 3 of 4 on track")).toBe(`${MASKED} · 3 of 4 on track`);
    expect(maskAmounts("no amounts here")).toBe("no amounts here");
  });

  it("formats as usual when amounts are shown", () => {
    expect(amounts(false).peso(123456)).toBe("₱1,234.56");
    expect(amounts(true).peso(123456)).toBe(MASKED);
  });
});

describe("the eye", () => {
  it("sits by the totals, ready to hide amounts", async () => {
    const { h, jon } = await setup();
    for (const path of ["/spending", `/spending/category/${h.categoryIds.Food}`, "/history?who=all"]) {
      const body = await html(await req(path, { cookie: jon }));
      expect(body, path).toContain('action="/settings/amounts"');
      expect(body, path).toContain('aria-label="Hide amounts"');
      expect(body, path).toContain(`name="back" value="${path}"`);
    }
  });

  it("hides every amount on every screen for that person only, and shows them again", async () => {
    const { h, jon, partner } = await setup();
    const res = await hide(jon, true, "/history?who=all");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/history?who=all");

    for (const path of ["/spending", `/spending/category/${h.categoryIds.Food}`, "/history"]) {
      const body = await html(await req(path, { cookie: jon }));
      expect(body, path).not.toMatch(/₱\d/);
      expect(body, path).toContain(MASKED);
      expect(body, path).toContain('aria-label="Show amounts"');
    }
    // The other person in the household still sees theirs.
    expect(await html(await req("/spending", { cookie: partner }))).toContain("₱12,250");

    await hide(jon, false);
    const shown = await html(await req("/spending", { cookie: jon }));
    expect(shown).toContain("₱12,250");
    expect(shown).not.toContain(MASKED);
  });

  it("keeps the setting on the person, so it follows them to another phone", async () => {
    const { h, jon } = await setup();
    await hide(jon, true);
    const row = await db().query.profiles.findFirst({ where: eq(profiles.id, h.profileIds[0]) });
    expect(row?.hideAmounts).toBe(true);
    const otherPhone = await authCookie(h.householdId, h.profileIds[0]);
    expect(await html(await req("/history", { cookie: otherPhone }))).not.toMatch(/₱\d/);
  });

  it("masks the week's total in the note after saving", async () => {
    const { h, jon } = await setup();
    await hide(jon, true);
    const res = await req("/api/entries", {
      method: "POST",
      cookie: jon,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), profileId: h.profileIds[0], categoryId: h.categoryIds.Groceries, amountCentavos: 35000, spentAt: Date.now() }),
    });
    expect(((await res.json()) as { note: string }).note).toBe(`Saved ✓ · Groceries this week: ${MASKED}`);
  });

  it("only goes back to a screen of kop.it", async () => {
    const { jon } = await setup();
    const res = await hide(jon, true, "//evil.example/");
    expect(res.headers.get("Location")).toBe("/spending");
  });
});

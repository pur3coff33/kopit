import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { profiles } from "../src/db/schema";
import { maskPeso } from "../src/lib/money";
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

/** The big total's text, without the eye beside it. */
const total = (body: string) => body.match(/<div class="total"[^>]*>([^<]*)</)?.[1];

describe("a hidden total", () => {
  it("keeps the first digit and the shape, and drops the centavos", () => {
    expect(maskPeso(1_225_050)).toBe("₱1•,•••");
    expect(maskPeso(435_000)).toBe("₱4,•••");
    expect(maskPeso(123_456_700)).toBe("₱1,•••,•••");
    expect(maskPeso(99_000)).toBe("₱9••");
    expect(maskPeso(500)).toBe("₱5");
    expect(maskPeso(0)).toBe("₱0");
  });
});

describe("the eye by the total", () => {
  it("sits by the garden's total and each category's total, ready to hide it", async () => {
    const { h, jon } = await setup();
    for (const path of ["/spending", `/spending/category/${h.categoryIds.Food}`]) {
      const body = await html(await req(path, { cookie: jon }));
      expect(body, path).toContain('action="/settings/amounts"');
      expect(body, path).toContain('aria-label="Hide total"');
      expect(body, path).toContain(`name="back" value="${path}"`);
    }
  });

  it("hides only the total, for that person only, and shows it again", async () => {
    const { h, jon, partner } = await setup();
    const res = await hide(jon, true, `/spending/category/${h.categoryIds.Food}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/spending/category/${h.categoryIds.Food}`);

    const garden = await html(await req("/spending", { cookie: jon }));
    expect(total(garden)).toBe("₱1•,•••");
    // Missions keep their amounts too ("Keep today under ₱1,500 · ₱12,250 spent" here, all of it spent today).
    expect(garden.slice(0, garden.indexOf('class="missions"'))).not.toContain("₱12,250");
    expect(garden).toContain('aria-label="Show total"');
    // Everything else keeps its amounts: the rows, and history.
    expect(garden).toContain("₱7,900");
    expect(garden).toContain("₱4,350");
    expect(await html(await req("/history", { cookie: jon }))).toContain("₱4,350");
    const food = await html(await req(`/spending/category/${h.categoryIds.Food}`, { cookie: jon }));
    expect(total(food)).toBe("₱4,•••");

    // The other person in the household still sees it.
    expect(total(await html(await req("/spending", { cookie: partner })))).toBe("₱12,250");

    await hide(jon, false);
    const shown = await html(await req("/spending", { cookie: jon }));
    expect(total(shown)).toBe("₱12,250");
    expect(shown).not.toContain("•");
  });

  it("keeps the setting on the person, so it follows them to another phone", async () => {
    const { h, jon } = await setup();
    await hide(jon, true);
    const row = await db().query.profiles.findFirst({ where: eq(profiles.id, h.profileIds[0]) });
    expect(row?.hideAmounts).toBe(true);
    const otherPhone = await authCookie(h.householdId, h.profileIds[0]);
    expect(total(await html(await req("/spending", { cookie: otherPhone })))).toBe("₱1•,•••");
  });

  it("only goes back to a screen of kop.it", async () => {
    const { jon } = await setup();
    const res = await hide(jon, true, "//evil.example/");
    expect(res.headers.get("Location")).toBe("/spending");
  });
});

import { describe, expect, it } from "vitest";
import { addMonths, dayStart, fromDateInput, monthStart } from "../src/lib/time";
import { addEntry, authCookie, html, req, seedHousehold } from "./helpers";

const DAY = 86_400_000;

async function page(path: string, h: Awaited<ReturnType<typeof seedHousehold>>) {
  return html(await req(path, { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
}

describe("spending screen", () => {
  it("shows this month's total, rows by amount, pace and no-spend days", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: addMonths(now, -2) });
    await addEntry(h, { amount: 435000, at: now - 2000, category: "Food" });
    await addEntry(h, { amount: 790000, at: now - 1000, category: "Groceries" });
    await addEntry(h, { amount: 2000000, at: addMonths(now, -1) + 60_000, category: "Bills" });
    const body = await page("/spending", h);
    expect(body).toMatch(/class="chip on"[^>]*>This month</);
    expect(body).toMatch(/class="chip on"[^>]*>Everyone</);
    expect(body).toContain("₱12,250");
    expect(body).toContain("2 expenses");
    expect(body.indexOf("Groceries")).toBeLessThan(body.indexOf("Food"));
    expect(body).toContain("🌱 ₱7,750 less than this time last month");
    if (dayStart(now) > monthStart(now)) expect(body).toContain("no-spend day");
    expect(body).toMatch(/href="\/spending\/category\/\d+\?range=this&amp;who=all"|href="\/spending\/category\/\d+\?range=this&who=all"/);
  });

  it("treats a reversed custom range as the right way round", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 1000, at: fromDateInput("2026-10-05")! + 4 * 3_600_000, category: "Food" });
    await addEntry(h, { amount: 5000, at: fromDateInput("2026-10-12")! + 4 * 3_600_000, category: "Food" });
    const body = await page("/spending?range=custom&from=2026-10-10&to=2026-10-03", h);
    expect(body).toContain("₱10");
    expect(body).not.toContain("₱60");
    expect(body).toContain("Oct 3 – 10");
  });

  it("filters by person", async () => {
    const now = Date.now();
    const h = await seedHousehold();
    await addEntry(h, { amount: 1000, at: now - 1000, category: "Food", profile: 0 });
    await addEntry(h, { amount: 2000, at: now - 1000, category: "Food", profile: 1 });
    const body = await page(`/spending?who=${h.profileIds[1]}`, h);
    expect(body).toContain("₱20");
    expect(body).toMatch(/1 expense(?!s)/);
    expect(body).toMatch(/class="chip on"[^>]*>Partner</);
  });

  it("says when nothing is logged", async () => {
    const h = await seedHousehold();
    expect(await page("/spending", h)).toContain("Nothing logged yet.");
  });
});

describe("category detail", () => {
  it("lists that category's expenses newest first with who logged them", async () => {
    const now = Date.now();
    const h = await seedHousehold();
    await addEntry(h, { amount: 1100, at: now - 5000, category: "Food", profile: 0 });
    await addEntry(h, { amount: 2200, at: now - 1000, category: "Food", profile: 1 });
    await addEntry(h, { amount: 7700, at: now - 1000, category: "Bills" });
    const body = await page(`/spending/category/${h.categoryIds.Food}`, h);
    expect(body.indexOf("₱22")).toBeGreaterThan(-1);
    expect(body.indexOf("₱22")).toBeLessThan(body.indexOf("₱11"));
    expect(body).toContain("Partner");
    expect(body).not.toContain("₱77");
    expect(body).toContain("₱33");
    expect(body).toMatch(/href="\/entries\/[0-9a-f-]{36}\/edit"/);
  });

  it("shows uncategorized expenses under /none", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 4400, at: Date.now() - 1000, category: null });
    const body = await page("/spending/category/none", h);
    expect(body).toContain("Uncategorized");
    expect(body).toContain("₱44");
  });

  it("is a 404 for another household's category", async () => {
    const h = await seedHousehold();
    const other = await seedHousehold();
    const res = await req(`/spending/category/${other.categoryIds.Food}`, { cookie: await authCookie(h.householdId, h.profileIds[0]) });
    expect(res.status).toBe(404);
  });
});

export { DAY };

import { describe, expect, it } from "vitest";
import { addMonths, dayStart, fromDateInput, monthStart } from "../src/lib/time";
import { eq } from "drizzle-orm";
import { entries } from "../src/db/schema";
import { addEntry, authCookie, db, html, req, seedHousehold } from "./helpers";

const DAY = 86_400_000;

/** The page with the eye's hideable totals unwrapped, to read sentences that have one in them. */
const text = (body: string) => body.replace(/<span data-amount="\d+">([^<]*)<\/span>/g, "$1");

async function page(path: string, h: Awaited<ReturnType<typeof seedHousehold>>) {
  return html(await req(path, { cookie: await authCookie(h.householdId, h.profileIds[0]) }));
}

describe("spending screen", () => {
  it("adds up needs and wants separately, biggest first in each, with no category last", async () => {
    const now = Date.now();
    const h = await seedHousehold();
    await addEntry(h, { amount: 80_000, at: now - 4000, category: "Groceries" });
    await addEntry(h, { amount: 150_000, at: now - 3000, category: "Bills" });
    await addEntry(h, { amount: 25_000, at: now - 2000, category: "Eating out" });
    await addEntry(h, { amount: 10_000, at: now - 1000, category: null });
    const body = await page("/spending", h);
    const list = body.slice(body.indexOf('class="rows'));
    const order = ["Needs", "₱2,300", "Bills", "Groceries", "Wants", "₱250", "Eating out", "No category"];
    const at = order.map((s) => list.indexOf(s));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });


  it("shows this month's total, rows by amount, pace and no-spend days", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: addMonths(now, -2) });
    await addEntry(h, { amount: 435000, at: now - 2000, category: "Eating out" });
    await addEntry(h, { amount: 790000, at: now - 1000, category: "Groceries" });
    await addEntry(h, { amount: 2000000, at: addMonths(now, -1) + 60_000, category: "Bills" });
    const body = await page("/spending", h);
    expect(body).toContain("₱12,250");
    expect(body).toContain("2 expenses");
    expect(body.indexOf("Groceries")).toBeLessThan(body.indexOf("Eating out"));
    expect(body).toContain("↓ ₱7,750 · 🌸 on track");
    expect(body).toContain('class="bud"');
    expect(body).toMatch(/🍃 \d+ good days? · \d+ perfect · 2 expenses/);
    expect(body).toContain("Today's missions");
    expect(body).toMatch(/\d of \d on track/);
    expect(body).toContain("data-sky"); // today's weather; a finished month has none
  });

  it("treats a reversed custom range as the right way round", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 1000, at: fromDateInput("2026-10-05")! + 4 * 3_600_000, category: "Eating out" });
    await addEntry(h, { amount: 5000, at: fromDateInput("2026-10-12")! + 4 * 3_600_000, category: "Eating out" });
    const body = await page("/spending?range=custom&from=2026-10-10&to=2026-10-03", h);
    expect(body).toContain("₱10");
    expect(body).not.toContain("₱60");
    expect(body).toContain("Oct 3 – 10");
  });

  it("filters by person", async () => {
    const now = Date.now();
    const h = await seedHousehold();
    await addEntry(h, { amount: 1000, at: now - 1000, category: "Eating out", profile: 0 });
    await addEntry(h, { amount: 2000, at: now - 1000, category: "Eating out", profile: 1 });
    const body = await page(`/spending?who=${h.profileIds[1]}`, h);
    expect(body).toContain("₱20");
    expect(body).toMatch(/1 expense(?!s)/);
    expect(body).toMatch(/class="chip on"[^>]*>Partner</);
  });

  it("says when nothing is logged, with a sprout", async () => {
    const h = await seedHousehold();
    const body = await page("/spending", h);
    expect(body).toContain("Nothing logged yet.");
    expect(body).toContain('class="sprout"');
  });

  it("keeps it neutral when spending runs ahead of last month", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: addMonths(now, -2) });
    await addEntry(h, { amount: 1000, at: addMonths(now, -1) + 60_000, category: "Bills" });
    await addEntry(h, { amount: 9000, at: now - 1000, category: "Eating out" });
    const body = await page("/spending", h);
    expect(body).toMatch(/class="pill neutral">₱80 more than this time last month</);
    expect(body).not.toContain('class="bud"');
  });

  it("shows last month in bloom when it ended lower than the month before", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: addMonths(now, -3) });
    await addEntry(h, { amount: 50000, at: addMonths(now, -2) + DAY, category: "Bills" });
    await addEntry(h, { amount: 40000, at: addMonths(now, -1) + DAY, category: "Bills" });
    const body = await page("/spending?range=last", h);
    expect(body).toContain("bloomed 🌸");
    expect(body).toContain('class="flower"');
    expect(text(body)).toContain("₱400 spent, ₱100 less than");
    expect(body).not.toContain("Replay Wrapped"); // recaps are replayed from History now
    expect(body).not.toContain("Today's missions"); // only this month has missions
    expect(body).not.toContain("data-sky"); // the weather is today's: a finished month has none
  });

  it("lets a month that ended higher just stay green", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: addMonths(now, -3) });
    await addEntry(h, { amount: 40000, at: addMonths(now, -2) + DAY, category: "Bills" });
    await addEntry(h, { amount: 50000, at: addMonths(now, -1) + DAY, category: "Bills" });
    const body = await page("/spending?range=last", h);
    expect(body).not.toContain("bloomed");
    expect(body).not.toContain('class="flower"');
    expect(body).toMatch(/grew \d+ lea(f|ves)|stayed a sprout/);
  });

  it("shows the picked person's own pace, while the bud stays the household's", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: addMonths(now, -2) });
    await addEntry(h, { amount: 10000, at: addMonths(now, -1) + 60_000, category: "Bills", profile: 0 });
    await addEntry(h, { amount: 1000, at: addMonths(now, -1) + 60_000, category: "Eating out", profile: 1 });
    await addEntry(h, { amount: 5000, at: now - 1000, category: "Eating out", profile: 1 });
    const body = await page(`/spending?who=${h.profileIds[1]}`, h);
    expect(body).toContain('class="bud"'); // the household is ₱60 under last month
    expect(body).toMatch(/class="pill neutral">₱40 more than this time last month</); // Partner alone is ₱40 over
  });

  it("calls a finished month's comparison the household's when one person is picked", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: addMonths(now, -3) });
    await addEntry(h, { amount: 50000, at: addMonths(now, -2) + DAY, category: "Bills" });
    await addEntry(h, { amount: 40000, at: addMonths(now, -1) + DAY, category: "Bills" });
    const body = await page(`/spending?range=last&who=${h.profileIds[1]}`, h);
    expect(text(body)).toContain("The household spent ₱400, ₱100 less than");
  });

  it("doesn't grade a month from before the household began", async () => {
    const h = await seedHousehold({ createdAt: Date.now() });
    const body = await page("/spending?range=last", h);
    expect(body).toContain("Before your garden began");
    expect(body).not.toContain("stayed a sprout");
  });

  it("labels the plant as the household's when one person is picked", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 2000, at: Date.now() - 1000, category: "Eating out", profile: 1 });
    expect(await page(`/spending?who=${h.profileIds[1]}`, h)).toContain("the household's garden");
  });
});

describe("category detail", () => {
  it("lists that category's expenses newest first with who logged them", async () => {
    const now = Date.now();
    const h = await seedHousehold();
    await addEntry(h, { amount: 1100, at: now - 5000, category: "Eating out", profile: 0 });
    await addEntry(h, { amount: 2200, at: now - 1000, category: "Eating out", profile: 1 });
    await addEntry(h, { amount: 7700, at: now - 1000, category: "Bills" });
    const body = await page(`/spending/category/${h.categoryIds["Eating out"]}`, h);
    expect(body.indexOf("₱22")).toBeGreaterThan(-1);
    expect(body.indexOf("₱22")).toBeLessThan(body.indexOf("₱11"));
    expect(body).toContain("Partner");
    expect(body).not.toContain("₱77");
    expect(body).toContain("₱33");
    expect(body).toMatch(/href="\/entries\/[0-9a-f-]{36}\/edit\?back=%2Fspending%2Fcategory%2F/);
  });

  it("shows each expense's note", async () => {
    const h = await seedHousehold();
    const id = await addEntry(h, { amount: 1100, at: Date.now() - 1000, category: "Eating out" });
    await db().update(entries).set({ note: "Jollibee with Ana" }).where(eq(entries.id, id));
    expect(await page(`/spending/category/${h.categoryIds["Eating out"]}`, h)).toContain("Jollibee with Ana");
  });

  it("shows uncategorized expenses under /none", async () => {
    const h = await seedHousehold();
    await addEntry(h, { amount: 4400, at: Date.now() - 1000, category: null });
    const body = await page("/spending/category/none", h);
    expect(body).toContain("No category");
    expect(body).toContain("₱44");
  });

  it("shows its share of everything, its change against last month, and its weeks", async () => {
    const now = Date.now();
    const h = await seedHousehold({ createdAt: addMonths(now, -2) });
    await addEntry(h, { amount: 1000, at: addMonths(now, -1) + 60_000, category: "Eating out" });
    await addEntry(h, { amount: 3000, at: monthStart(now) + 60_000, category: "Eating out" });
    await addEntry(h, { amount: 1000, at: monthStart(now) + 120_000, category: "Bills" });
    const body = await page(`/spending/category/${h.categoryIds["Eating out"]}`, h);
    expect(body).toMatch(/<a class="back" href="\/spending\?[^"]*">Garden<\/a>/);
    expect(body).toMatch(/<h1>Eating out<\/h1>/);
    expect(body).toContain("1 expense<");
    expect(body).toContain("75% of everything");
    expect(body).toContain("↑ ₱20 vs");

    const from = new Date(now - 20 * DAY + 8 * 3_600_000).toISOString().slice(0, 10);
    const to = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
    await addEntry(h, { amount: 500, at: now - 15 * DAY, category: "Eating out" });
    expect(await page(`/spending/category/${h.categoryIds["Eating out"]}?range=custom&from=${from}&to=${to}`, h)).toContain('class="weeks"');
  });

  it("is a 404 for another household's category", async () => {
    const h = await seedHousehold();
    const other = await seedHousehold();
    const res = await req(`/spending/category/${other.categoryIds["Eating out"]}`, { cookie: await authCookie(h.householdId, h.profileIds[0]) });
    expect(res.status).toBe(404);
  });
});
